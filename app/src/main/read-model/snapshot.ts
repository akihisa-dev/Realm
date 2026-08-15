import type { DatabaseSync } from "node:sqlite";
import type { AssetManifest, CellAttributeSnapshot, CellViewportInput, FeatureProperties, MapShape, RealmFeature, RealmSnapshot } from "../../shared/realmContract";
import { validateGeometry, validateProperties } from "../domain/geometry";
import { MAX_ASSET_BYTES, sha256Hex, validateAsset } from "../domain/assets";
import { parseStoredSettings } from "../domain/settings";
import { EDITOR_GRID_COLUMNS, EDITOR_GRID_ROWS } from "../domain/cell";
import { mapShapesToCellAttributes, validateMapShapes } from "../../shared/mapShapeGeometry";
import type { OpenProjectSession } from "../state/session";
import { corrupt, invalid } from "../domain/errors";

function json(value: unknown, label: string): unknown { try { return JSON.parse(String(value)); } catch { throw corrupt("A project contains invalid " + label + "."); } }
export function projectSnapshot(session: OpenProjectSession): RealmSnapshot {
  const world = session.database.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!world) throw corrupt("The project does not contain a world record.");
  const features = (session.database.prepare("SELECT id,feature_type AS featureType,name,geometry_json AS geometryJson,properties_json AS propertiesJson FROM features ORDER BY feature_type,name,id").all() as Record<string, unknown>[]).map((row) => {
    const featureType = String(row.featureType) as RealmFeature["featureType"]; const geometry = json(row.geometryJson, "geometry"); const properties = json(row.propertiesJson, "properties");
    try { validateGeometry(featureType, geometry, true); validateProperties(properties); } catch { throw corrupt("A feature contains invalid geometry or properties."); }
    return { id: String(row.id), featureType, name: String(row.name), geometry: geometry as RealmFeature["geometry"], properties: properties as FeatureProperties };
  });
  const settings = parseStoredSettings(String(world.settingsJson));
  const assets = (session.database.prepare("SELECT id,sha256,mime,length(bytes) AS byteLength,bytes,width,height,metadata_json AS metadataJson FROM assets ORDER BY id").all() as Record<string, unknown>[]).map((row): AssetManifest => {
    const sha256 = String(row.sha256).toLowerCase();
    const bytes = row.bytes instanceof Uint8Array ? [...row.bytes] : Array.isArray(row.bytes) ? row.bytes : [];
    if (!/^[0-9a-f]{64}$/u.test(sha256) || bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) || sha256Hex(Uint8Array.from(bytes)) !== sha256) throw corrupt("An asset contains an invalid hash or bytes.");
    const metadata = json(row.metadataJson, "asset metadata");
    try { const checked = validateAsset({ sha256, mime: String(row.mime), bytes, width: Number(row.width), height: Number(row.height), metadata: metadata as FeatureProperties }); return { id: String(row.id), sha256, mime: checked.mime, byteLength: bytes.length, width: checked.width, height: checked.height, metadata: checked.metadata }; } catch { throw corrupt("An asset contains invalid contents."); }
  });
  const mapShapes = (session.database.prepare("SELECT id,layer,region_id AS regionId,value,geometry_version AS geometryVersion,snap_grid_version AS snapGridVersion,geometry_json AS geometryJson FROM map_shapes ORDER BY layer,region_id,id").all() as Record<string, unknown>[]).map((row): MapShape => {
    let geometry: unknown;
    try { geometry = JSON.parse(String(row.geometryJson)); } catch { throw corrupt("A map shape contains invalid JSON."); }
    return { id: String(row.id), layer: String(row.layer) as MapShape["layer"], ...(row.regionId === null || row.regionId === undefined ? {} : { regionId: String(row.regionId) }), value: String(row.value), geometryVersion: Number(row.geometryVersion), snapGridVersion: Number(row.snapGridVersion), geometry: geometry as MapShape["geometry"] };
  });
  try { validateMapShapes(mapShapes); } catch { throw corrupt("A map shape is invalid or overlaps another shape."); }
  return { formatVersion: 11, path: session.path, world: { id: String(world.id), name: String(world.name) }, settings, features, mapShapes, assets, featureCount: features.length, canUndo: session.canUndo, canRedo: session.canRedo };
}

export function cellAttributesSnapshot(session: OpenProjectSession, input: CellViewportInput = {}): CellAttributeSnapshot[] {
  const bound = (value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) throw invalid("The cell viewport is invalid.");
    return value;
  };
  const minX = Math.max(0, Math.min(EDITOR_GRID_COLUMNS - 1, bound(input.minX, 0))); const maxX = Math.max(0, Math.min(EDITOR_GRID_COLUMNS - 1, bound(input.maxX, EDITOR_GRID_COLUMNS - 1)));
  const minY = Math.max(0, Math.min(EDITOR_GRID_ROWS - 1, bound(input.minY, 0))); const maxY = Math.max(0, Math.min(EDITOR_GRID_ROWS - 1, bound(input.maxY, EDITOR_GRID_ROWS - 1)));
  if (minX > maxX || minY > maxY) throw invalid("The cell viewport is invalid.");
  const mapShapes = projectSnapshot(session).mapShapes;
  return mapShapesToCellAttributes(mapShapes).filter((row) => {
    const [x = -1, y = -1] = row.cellId.split(":").map(Number);
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }).map((row): CellAttributeSnapshot => ({ cellId: row.cellId, attribute: row.attribute, value: row.value, ...(row.regionId ? { regionId: row.regionId } : {}) }));
}

export function rawDatabase(session: OpenProjectSession): DatabaseSync { return session.database; }
