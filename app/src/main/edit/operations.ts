import type { DatabaseSync } from "node:sqlite";
import type { FeatureType, MapShapeLayer } from "../../shared/realmContract";
import { transaction } from "../storage/schema";

export type FeatureRow = { id: string; featureType: FeatureType; name: string; geometryJson: string; propertiesJson: string };
export type AssetRow = { id: string; sha256: string; mime: string; bytes?: Uint8Array; width: number; height: number; metadataJson: string };
export type MapShapeRow = { id: string; layer: MapShapeLayer; regionId: string | null; value: string; geometryVersion: number; snapGridVersion: number; geometryJson: string };
export type PersistentState = { world: { id: string; name: string; settingsJson: string }; features: FeatureRow[]; mapShapes: MapShapeRow[]; assets: AssetRow[] };
export type EditOperation = { before: PersistentState; after: PersistentState; label: string };
export type CaptureStateOptions = { assetBytesFor?: readonly string[] };
function rows<T>(db: DatabaseSync, sql: string, mapper: (row: Record<string, unknown>) => T, ...params: (string | number | Uint8Array | null)[]): T[] { return db.prepare(sql).all(...params).map((row) => mapper(row as Record<string, unknown>)); }
const bytesFromRow = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error("The asset bytes could not be captured.");
};

export function captureState(db: DatabaseSync, options: CaptureStateOptions = {}): PersistentState {
  const world = db.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown>;
  const state: PersistentState = {
    world: { id: String(world.id), name: String(world.name), settingsJson: String(world.settingsJson) },
    features: rows(db, "SELECT id,feature_type AS featureType,name,geometry_json AS geometryJson,properties_json AS propertiesJson FROM features ORDER BY id", (row) => ({ id: String(row.id), featureType: String(row.featureType) as FeatureType, name: String(row.name), geometryJson: String(row.geometryJson), propertiesJson: String(row.propertiesJson) })),
    mapShapes: rows(db, "SELECT id,layer,region_id AS regionId,value,geometry_version AS geometryVersion,snap_grid_version AS snapGridVersion,geometry_json AS geometryJson FROM map_shapes ORDER BY layer,region_id,id", (row) => ({ id: String(row.id), layer: String(row.layer) as MapShapeLayer, regionId: row.regionId === null || row.regionId === undefined ? null : String(row.regionId), value: String(row.value), geometryVersion: Number(row.geometryVersion), snapGridVersion: Number(row.snapGridVersion), geometryJson: String(row.geometryJson) })),
    assets: rows(db, "SELECT id,sha256,mime,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) })),
  };
  captureAssetBytes(db, state, options.assetBytesFor ?? []);
  return state;
}

export function captureAssetBytes(db: DatabaseSync, state: PersistentState, ids: readonly string[]): void {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  const statement = db.prepare("SELECT bytes FROM assets WHERE id=?");
  for (const row of state.assets) {
    if (!wanted.has(row.id)) continue;
    const result = statement.get(row.id) as Record<string, unknown> | undefined;
    if (!result) throw new Error("The asset bytes could not be captured.");
    row.bytes = bytesFromRow(result.bytes);
  }
  if ([...wanted].some((id) => !state.assets.some((row) => row.id === id && row.bytes !== undefined))) throw new Error("The asset bytes could not be captured.");
}

const sameAssetDescriptor = (left: AssetRow, right: AssetRow): boolean =>
  left.id === right.id && left.sha256 === right.sha256 && left.mime === right.mime && left.width === right.width
  && left.height === right.height && left.metadataJson === right.metadataJson;

function restoreAssets(db: DatabaseSync, target: readonly AssetRow[]): void {
  const current = rows(db, "SELECT id,sha256,mime,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) }));
  const currentById = new Map(current.map((row) => [row.id, row]));
  const targetIds = new Set(target.map((row) => row.id));
  const remove = db.prepare("DELETE FROM assets WHERE id=?");
  for (const row of current) if (!targetIds.has(row.id)) remove.run(row.id);
  const update = db.prepare("UPDATE assets SET sha256=?,mime=?,bytes=?,width=?,height=?,metadata_json=? WHERE id=?");
  const insert = db.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)");
  for (const row of target) {
    const previous = currentById.get(row.id);
    if (previous && sameAssetDescriptor(previous, row)) continue;
    if (row.bytes === undefined) throw new Error("The asset bytes required for undo are unavailable.");
    if (previous) update.run(row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson, row.id);
    else insert.run(row.id, row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson);
  }
}

export function restoreState(db: DatabaseSync, state: PersistentState): void {
  transaction(db, () => {
    db.prepare("UPDATE world SET id=?,name=?,settings_json=?").run(state.world.id, state.world.name, state.world.settingsJson);
    db.exec("DELETE FROM features; DELETE FROM map_shapes;");
    const feature = db.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)"); for (const row of state.features) feature.run(row.id, row.featureType, row.name, row.geometryJson, row.propertiesJson);
    const shape = db.prepare("INSERT INTO map_shapes(id,layer,region_id,value,geometry_version,snap_grid_version,geometry_json) VALUES (?,?,?,?,?,?,?)"); for (const row of state.mapShapes) shape.run(row.id, row.layer, row.regionId, row.value, row.geometryVersion, row.snapGridVersion, row.geometryJson);
    restoreAssets(db, state.assets);
  });
}
export function equalState(a: PersistentState, b: PersistentState): boolean { return JSON.stringify(a, (_key, value) => value instanceof Uint8Array ? [...value] : value) === JSON.stringify(b, (_key, value) => value instanceof Uint8Array ? [...value] : value); }
