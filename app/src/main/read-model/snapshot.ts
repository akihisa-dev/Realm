import type { DatabaseSync } from "node:sqlite";
import type { AssetManifest, LayerNode, LayerTree, MapObject, Properties, RealmSnapshot, Region, RegionShape, TerrainShape } from "../../shared/realmContract";
import { validateObjectGeometry, validateProperties } from "../domain/geometry";
import { MAX_ASSET_BYTES, MAX_ASSET_DIMENSION, validateAsset } from "../domain/assets";
import { parseStoredSettings } from "../domain/settings";
import { mapShapesFromLayers } from "../../shared/layerProjection";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import type { PersistentState, AssetRow } from "../storage/projectStore";
import type { OpenProjectSession } from "../state/session";
import { corrupt } from "../domain/errors";

function json(value: string, label: string): unknown {
  try { return JSON.parse(value); } catch { throw corrupt("A project contains invalid " + label + "."); }
}

function assetManifest(row: AssetRow): AssetManifest {
  const sha256 = row.sha256.toLowerCase(); const mime = row.mime.toLowerCase();
  try {
    if (row.bytes !== undefined) {
      const checked = validateAsset({ sha256, mime, bytes: [...row.bytes], width: row.width, height: row.height, metadata: json(row.metadataJson, "asset metadata") as Properties });
      return { id: row.id, sha256, mime: checked.mime, byteLength: checked.bytes.length, width: checked.width, height: checked.height, metadata: checked.metadata };
    }
    const byteLength = row.byteLength ?? -1;
    if (!/^[0-9a-f]{64}$/u.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ASSET_BYTES) throw new Error("invalid asset size");
    if (!Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height)) throw new Error("invalid asset dimensions");
    if (row.width < 1 || row.width > MAX_ASSET_DIMENSION || row.height < 1 || row.height > MAX_ASSET_DIMENSION) throw new Error("invalid asset dimensions");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("invalid asset mime");
    const metadata = validateProperties(json(row.metadataJson, "asset metadata"));
    return { id: row.id, sha256, mime, byteLength, width: row.width, height: row.height, metadata };
  } catch { throw corrupt("An asset contains invalid contents."); }
}

function layerTree(state: PersistentState): LayerTree {
  return { nodes: state.layerNodes.map((row): LayerNode => ({ id: row.id, parentId: row.parentId, kind: row.kind, name: row.name, order: row.sortOrder, visible: row.visible === 1, locked: row.locked === 1 })) };
}

function layersFromState(state: PersistentState): { terrain: TerrainShape[]; regions: Region[]; objects: MapObject[] } {
  const terrain = state.terrainShapes.map((row): TerrainShape => ({ id: row.id, layerId: row.layerId, geometry: json(row.geometryJson, "terrain geometry") as TerrainShape["geometry"] }));
  const shapesByRegion = new Map<string, RegionShape[]>();
  for (const row of state.regionShapes) {
    const shapes = shapesByRegion.get(row.regionId) ?? [];
    shapes.push({ id: row.id, layerId: row.layerId, geometry: json(row.geometryJson, "region geometry") as RegionShape["geometry"] });
    shapesByRegion.set(row.regionId, shapes);
  }
  const regions = state.regions.map((row): Region => ({ id: row.id, layerId: row.layerId, name: row.name, color: row.color, shapes: shapesByRegion.get(row.id) ?? [] }));
  if ([...shapesByRegion.keys()].some((id) => !regions.some((region) => region.id === id))) throw corrupt("A region shape refers to a missing region.");
  const objects = state.objects.map((row): MapObject => {
    const geometry = json(row.geometryJson, "object geometry"); const properties = json(row.propertiesJson, "object properties");
    try { validateObjectGeometry(row.kind, geometry, true); validateProperties(properties); } catch { throw corrupt("An object contains invalid geometry or properties."); }
    return { id: row.id, layerId: row.layerId, kind: row.kind, label: row.label, geometry: geometry as MapObject["geometry"], properties: properties as Properties, zIndex: row.zIndex, locked: row.locked === 1, ...(row.assetId === null ? {} : { assetId: row.assetId }) };
  });
  try { validateMapShapes(mapShapesFromLayers({ terrain, regions })); } catch { throw corrupt("A terrain or region shape is invalid or overlaps another shape in its layer."); }
  return { terrain, regions, objects };
}

export function projectSnapshot(session: OpenProjectSession): RealmSnapshot {
  const needsAssetIntegrityCheck = !session.isAssetIntegrityVerified;
  const state = session.readConsistent(() => session.store.readState({ includeAssetBytes: needsAssetIntegrityCheck, includeAssetByteLength: true, regionOrder: "name" }));
  if (state.world.id === "undefined") throw corrupt("The project does not contain a world record.");
  const layers = layersFromState(state);
  const assets = state.assets.map(assetManifest);
  if (needsAssetIntegrityCheck) session.markAssetIntegrityVerified();
  return {
    formatVersion: 13, path: session.path, world: { id: state.world.id, name: state.world.name }, layerTree: layerTree(state),
    layers, assets, settings: parseStoredSettings(state.world.settingsJson), canUndo: session.canUndo, canRedo: session.canRedo,
  };
}

export function rawDatabase(session: OpenProjectSession): DatabaseSync { return session.database; }
