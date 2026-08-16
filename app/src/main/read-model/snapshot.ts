import type { DatabaseSync } from "node:sqlite";
import type { AssetManifest, MapObject, Properties, RealmSnapshot, Region, RegionShape, TerrainShape } from "../../shared/realmContract";
import { validateObjectGeometry, validateProperties } from "../domain/geometry";
import { MAX_ASSET_BYTES, MAX_ASSET_DIMENSION, validateAsset } from "../domain/assets";
import { parseStoredSettings } from "../domain/settings";
import { mapShapesFromLayers } from "../../shared/layerProjection";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import type { OpenProjectSession } from "../state/session";
import { corrupt } from "../domain/errors";

function json(value: unknown, label: string): unknown { try { return JSON.parse(String(value)); } catch { throw corrupt("A project contains invalid " + label + "."); } }
type StoredAssetRow = Record<string, unknown>;
const bytesFromRow = (value: unknown): number[] => value instanceof Uint8Array ? [...value] : Array.isArray(value) ? value : [];

function assetManifest(row: StoredAssetRow, bytes?: number[]): AssetManifest {
  const sha256 = String(row.sha256).toLowerCase();
  const mime = String(row.mime).toLowerCase();
  const width = Number(row.width); const height = Number(row.height); const byteLength = Number(row.byteLength);
  const metadata = json(row.metadataJson, "asset metadata");
  try {
    if (bytes !== undefined) {
      const checked = validateAsset({ sha256, mime, bytes, width, height, metadata: metadata as Properties });
      return { id: String(row.id), sha256, mime: checked.mime, byteLength: checked.bytes.length, width: checked.width, height: checked.height, metadata: checked.metadata };
    }
    if (!/^[0-9a-f]{64}$/u.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ASSET_BYTES) throw new Error("invalid asset size");
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || width > MAX_ASSET_DIMENSION || height < 1 || height > MAX_ASSET_DIMENSION) throw new Error("invalid asset dimensions");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("invalid asset mime");
    const checkedMetadata = validateProperties(metadata);
    return { id: String(row.id), sha256, mime, byteLength, width, height, metadata: checkedMetadata };
  } catch { throw corrupt("An asset contains invalid contents."); }
}

function readLayers(session: OpenProjectSession): { terrain: TerrainShape[]; regions: Region[]; objects: MapObject[] } {
  const terrain = (session.database.prepare("SELECT id,geometry_json AS geometryJson FROM terrain_shapes ORDER BY id").all() as Record<string, unknown>[]).map((row): TerrainShape => ({ id: String(row.id), geometry: json(row.geometryJson, "terrain geometry") as TerrainShape["geometry"] }));
  const regionRows = session.database.prepare("SELECT id,name,color FROM regions ORDER BY name,id").all() as Record<string, unknown>[];
  const shapeRows = session.database.prepare("SELECT id,region_id AS regionId,geometry_json AS geometryJson FROM region_shapes ORDER BY region_id,id").all() as Record<string, unknown>[];
  const shapesByRegion = new Map<string, RegionShape[]>();
  for (const row of shapeRows) {
    const regionId = String(row.regionId); const shapes = shapesByRegion.get(regionId) ?? [];
    shapes.push({ id: String(row.id), geometry: json(row.geometryJson, "region geometry") as RegionShape["geometry"] }); shapesByRegion.set(regionId, shapes);
  }
  const regions = regionRows.map((row): Region => ({ id: String(row.id), name: String(row.name), color: String(row.color), shapes: shapesByRegion.get(String(row.id)) ?? [] }));
  if ([...shapesByRegion.keys()].some((id) => !regions.some((region) => region.id === id))) throw corrupt("A region shape refers to a missing region.");
  const objects = (session.database.prepare("SELECT id,kind,label,geometry_json AS geometryJson,properties_json AS propertiesJson,z_index AS zIndex,locked,asset_id AS assetId FROM objects ORDER BY z_index,id").all() as Record<string, unknown>[]).map((row): MapObject => {
    const geometry = json(row.geometryJson, "object geometry"); const properties = json(row.propertiesJson, "object properties");
    const kind = String(row.kind) as MapObject["kind"];
    try { validateObjectGeometry(kind, geometry, true); validateProperties(properties); } catch { throw corrupt("An object contains invalid geometry or properties."); }
    return { id: String(row.id), kind, label: String(row.label), geometry: geometry as MapObject["geometry"], properties: properties as Properties, zIndex: Number(row.zIndex), locked: Number(row.locked) === 1, ...(row.assetId === null || row.assetId === undefined ? {} : { assetId: String(row.assetId) }) };
  });
  const mapShapes = mapShapesFromLayers({ terrain, regions });
  try { validateMapShapes(mapShapes); } catch { throw corrupt("A terrain or region shape is invalid or overlaps another shape in its layer."); }
  return { terrain, regions, objects };
}

export function projectSnapshot(session: OpenProjectSession): RealmSnapshot {
  session.ensureCurrent();
  const world = session.database.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!world) throw corrupt("The project does not contain a world record.");
  const layers = readLayers(session);
  const assetRows = session.database.prepare("SELECT id,sha256,mime,length(bytes) AS byteLength,width,height,metadata_json AS metadataJson FROM assets ORDER BY id").all() as StoredAssetRow[];
  const needsAssetIntegrityCheck = !session.isAssetIntegrityVerified;
  const bytesById = needsAssetIntegrityCheck
    ? new Map((session.database.prepare("SELECT id,bytes FROM assets ORDER BY id").all() as StoredAssetRow[]).map((row) => [String(row.id), bytesFromRow(row.bytes)]))
    : new Map<string, number[]>();
  const assets = assetRows.map((row): AssetManifest => assetManifest(row, needsAssetIntegrityCheck ? bytesById.get(String(row.id)) ?? [] : undefined));
  if (needsAssetIntegrityCheck) session.markAssetIntegrityVerified();
  return {
    formatVersion: 12, path: session.path, world: { id: String(world.id), name: String(world.name) },
    layers: { terrain: layers.terrain, regions: layers.regions, objects: layers.objects }, assets,
    settings: parseStoredSettings(String(world.settingsJson)), canUndo: session.canUndo, canRedo: session.canRedo,
  };
}

export function rawDatabase(session: OpenProjectSession): DatabaseSync { return session.database; }
