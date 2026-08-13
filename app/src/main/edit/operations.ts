import type { DatabaseSync } from "node:sqlite";
import type { CellAttribute, FeatureType } from "../../shared/realmContract";
import { transaction } from "../storage/schema";

export type FeatureRow = { id: string; featureType: FeatureType; name: string; geometryJson: string; propertiesJson: string };
export type AssetRow = { id: string; sha256: string; mime: string; bytes: Uint8Array; width: number; height: number; metadataJson: string };
export type CellRow = { id: number; gridVersion: number; cellX: number; cellY: number; layer: CellAttribute; value: string };
export type PersistentState = { world: { id: string; name: string; settingsJson: string }; features: FeatureRow[]; assets: AssetRow[]; cells: CellRow[] };
export type EditOperation = { before: PersistentState; after: PersistentState; label: string };
function rows<T>(db: DatabaseSync, sql: string, mapper: (row: Record<string, unknown>) => T, ...params: (string | number | Uint8Array | null)[]): T[] { return db.prepare(sql).all(...params).map((row) => mapper(row as Record<string, unknown>)); }
export function captureState(db: DatabaseSync): PersistentState {
  const world = db.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown>;
  return {
    world: { id: String(world.id), name: String(world.name), settingsJson: String(world.settingsJson) },
    features: rows(db, "SELECT id,feature_type AS featureType,name,geometry_json AS geometryJson,properties_json AS propertiesJson FROM features ORDER BY id", (row) => ({ id: String(row.id), featureType: String(row.featureType) as FeatureType, name: String(row.name), geometryJson: String(row.geometryJson), propertiesJson: String(row.propertiesJson) })),
    assets: rows(db, "SELECT id,sha256,mime,bytes,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), bytes: Uint8Array.from(row.bytes as Uint8Array), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) })),
    cells: rows(db, "SELECT id,grid_version AS gridVersion,cell_x AS cellX,cell_y AS cellY,layer,value FROM cell_attributes ORDER BY id", (row) => ({ id: Number(row.id), gridVersion: Number(row.gridVersion), cellX: Number(row.cellX), cellY: Number(row.cellY), layer: String(row.layer) as CellAttribute, value: String(row.value) })),
  };
}
export function restoreState(db: DatabaseSync, state: PersistentState): void {
  transaction(db, () => {
    db.prepare("UPDATE world SET id=?,name=?,settings_json=?").run(state.world.id, state.world.name, state.world.settingsJson);
    db.exec("DELETE FROM features; DELETE FROM assets; DELETE FROM cell_attributes;");
    const feature = db.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)"); for (const row of state.features) feature.run(row.id, row.featureType, row.name, row.geometryJson, row.propertiesJson);
    const asset = db.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)"); for (const row of state.assets) asset.run(row.id, row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson);
    const cell = db.prepare("INSERT INTO cell_attributes(id,grid_version,cell_x,cell_y,layer,value) VALUES (?,?,?,?,?,?)"); for (const row of state.cells) cell.run(row.id, row.gridVersion, row.cellX, row.cellY, row.layer, row.value);
  });
}
export function equalState(a: PersistentState, b: PersistentState): boolean { return JSON.stringify(a, (_key, value) => value instanceof Uint8Array ? [...value] : value) === JSON.stringify(b, (_key, value) => value instanceof Uint8Array ? [...value] : value); }
