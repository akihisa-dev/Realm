import type { DatabaseSync } from "node:sqlite";
import type { FeatureType, MapShapeLayer } from "../../shared/realmContract";
import { transaction } from "../storage/schema";

export type FeatureRow = { id: string; featureType: FeatureType; name: string; geometryJson: string; propertiesJson: string };
export type AssetRow = { id: string; sha256: string; mime: string; bytes: Uint8Array; width: number; height: number; metadataJson: string };
export type MapShapeRow = { id: string; layer: MapShapeLayer; regionId: string | null; value: string; geometryVersion: number; snapGridVersion: number; geometryJson: string };
export type PersistentState = { world: { id: string; name: string; settingsJson: string }; features: FeatureRow[]; mapShapes: MapShapeRow[]; assets: AssetRow[] };
export type EditOperation = { before: PersistentState; after: PersistentState; label: string };
function rows<T>(db: DatabaseSync, sql: string, mapper: (row: Record<string, unknown>) => T, ...params: (string | number | Uint8Array | null)[]): T[] { return db.prepare(sql).all(...params).map((row) => mapper(row as Record<string, unknown>)); }
export function captureState(db: DatabaseSync): PersistentState {
  const world = db.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown>;
  return {
    world: { id: String(world.id), name: String(world.name), settingsJson: String(world.settingsJson) },
    features: rows(db, "SELECT id,feature_type AS featureType,name,geometry_json AS geometryJson,properties_json AS propertiesJson FROM features ORDER BY id", (row) => ({ id: String(row.id), featureType: String(row.featureType) as FeatureType, name: String(row.name), geometryJson: String(row.geometryJson), propertiesJson: String(row.propertiesJson) })),
    mapShapes: rows(db, "SELECT id,layer,region_id AS regionId,value,geometry_version AS geometryVersion,snap_grid_version AS snapGridVersion,geometry_json AS geometryJson FROM map_shapes ORDER BY layer,region_id,id", (row) => ({ id: String(row.id), layer: String(row.layer) as MapShapeLayer, regionId: row.regionId === null || row.regionId === undefined ? null : String(row.regionId), value: String(row.value), geometryVersion: Number(row.geometryVersion), snapGridVersion: Number(row.snapGridVersion), geometryJson: String(row.geometryJson) })),
    assets: rows(db, "SELECT id,sha256,mime,bytes,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), bytes: Uint8Array.from(row.bytes as Uint8Array), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) })),
  };
}
export function restoreState(db: DatabaseSync, state: PersistentState): void {
  transaction(db, () => {
    db.prepare("UPDATE world SET id=?,name=?,settings_json=?").run(state.world.id, state.world.name, state.world.settingsJson);
    db.exec("DELETE FROM features; DELETE FROM map_shapes; DELETE FROM assets;");
    const feature = db.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)"); for (const row of state.features) feature.run(row.id, row.featureType, row.name, row.geometryJson, row.propertiesJson);
    const shape = db.prepare("INSERT INTO map_shapes(id,layer,region_id,value,geometry_version,snap_grid_version,geometry_json) VALUES (?,?,?,?,?,?,?)"); for (const row of state.mapShapes) shape.run(row.id, row.layer, row.regionId, row.value, row.geometryVersion, row.snapGridVersion, row.geometryJson);
    const asset = db.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)"); for (const row of state.assets) asset.run(row.id, row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson);
  });
}
export function equalState(a: PersistentState, b: PersistentState): boolean { return JSON.stringify(a, (_key, value) => value instanceof Uint8Array ? [...value] : value) === JSON.stringify(b, (_key, value) => value instanceof Uint8Array ? [...value] : value); }
