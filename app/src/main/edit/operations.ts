import type { DatabaseSync } from "node:sqlite";
import type { ObjectKind } from "../../shared/realmContract";
import { transaction } from "../storage/schema";

export type TerrainShapeRow = { id: string; geometryJson: string };
export type RegionRow = { id: string; name: string; color: string };
export type RegionShapeRow = { id: string; regionId: string; geometryJson: string };
export type ObjectRow = { id: string; kind: ObjectKind; label: string; geometryJson: string; propertiesJson: string; zIndex: number; locked: number; assetId: string | null };
export type AssetRow = { id: string; sha256: string; mime: string; bytes?: Uint8Array; width: number; height: number; metadataJson: string };
export type PersistentState = { world: { id: string; name: string; settingsJson: string }; terrainShapes: TerrainShapeRow[]; regions: RegionRow[]; regionShapes: RegionShapeRow[]; objects: ObjectRow[]; assets: AssetRow[] };
export type EditOperation = { before: PersistentState; after: PersistentState; label: string };
export type CaptureStateOptions = { assetBytesFor?: readonly string[] };
function rows<T>(db: DatabaseSync, sql: string, mapper: (row: Record<string, unknown>) => T, ...params: (string | number | Uint8Array | null)[]): T[] { return db.prepare(sql).all(...params).map((row) => mapper(row as Record<string, unknown>)); }
const bytesFromRow = (value: unknown): Uint8Array => value instanceof Uint8Array ? Uint8Array.from(value) : Array.isArray(value) ? Uint8Array.from(value) : (() => { throw new Error("The asset bytes could not be captured."); })();

export function captureState(db: DatabaseSync, options: CaptureStateOptions = {}): PersistentState {
  const world = db.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Record<string, unknown>;
  const state: PersistentState = {
    world: { id: String(world.id), name: String(world.name), settingsJson: String(world.settingsJson) },
    terrainShapes: rows(db, "SELECT id,geometry_json AS geometryJson FROM terrain_shapes ORDER BY id", (row) => ({ id: String(row.id), geometryJson: String(row.geometryJson) })),
    regions: rows(db, "SELECT id,name,color FROM regions ORDER BY id", (row) => ({ id: String(row.id), name: String(row.name), color: String(row.color) })),
    regionShapes: rows(db, "SELECT id,region_id AS regionId,geometry_json AS geometryJson FROM region_shapes ORDER BY region_id,id", (row) => ({ id: String(row.id), regionId: String(row.regionId), geometryJson: String(row.geometryJson) })),
    objects: rows(db, "SELECT id,kind,label,geometry_json AS geometryJson,properties_json AS propertiesJson,z_index AS zIndex,locked,asset_id AS assetId FROM objects ORDER BY id", (row) => ({ id: String(row.id), kind: String(row.kind) as ObjectKind, label: String(row.label), geometryJson: String(row.geometryJson), propertiesJson: String(row.propertiesJson), zIndex: Number(row.zIndex), locked: Number(row.locked), assetId: row.assetId === null || row.assetId === undefined ? null : String(row.assetId) })),
    assets: rows(db, "SELECT id,sha256,mime,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) })),
  };
  captureAssetBytes(db, state, options.assetBytesFor ?? []);
  return state;
}

export function captureAssetBytes(db: DatabaseSync, state: PersistentState, ids: readonly string[]): void {
  const wanted = new Set(ids); if (wanted.size === 0) return;
  const statement = db.prepare("SELECT bytes FROM assets WHERE id=?");
  for (const row of state.assets) {
    if (!wanted.has(row.id)) continue;
    const result = statement.get(row.id) as Record<string, unknown> | undefined;
    if (!result) throw new Error("The asset bytes could not be captured.");
    row.bytes = bytesFromRow(result.bytes);
  }
  if ([...wanted].some((id) => !state.assets.some((row) => row.id === id && row.bytes !== undefined))) throw new Error("The asset bytes could not be captured.");
}

const sameAssetDescriptor = (left: AssetRow, right: AssetRow): boolean => left.id === right.id && left.sha256 === right.sha256 && left.mime === right.mime && left.width === right.width && left.height === right.height && left.metadataJson === right.metadataJson;
function restoreAssets(db: DatabaseSync, target: readonly AssetRow[]): void {
  const current = rows(db, "SELECT id,sha256,mime,width,height,metadata_json AS metadataJson FROM assets ORDER BY id", (row) => ({ id: String(row.id), sha256: String(row.sha256), mime: String(row.mime), width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson) }));
  const currentById = new Map(current.map((row) => [row.id, row])); const targetIds = new Set(target.map((row) => row.id));
  const remove = db.prepare("DELETE FROM assets WHERE id=?"); for (const row of current) if (!targetIds.has(row.id)) remove.run(row.id);
  const update = db.prepare("UPDATE assets SET sha256=?,mime=?,bytes=?,width=?,height=?,metadata_json=? WHERE id=?");
  const insert = db.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)");
  for (const row of target) {
    const previous = currentById.get(row.id); if (previous && sameAssetDescriptor(previous, row)) continue;
    if (row.bytes === undefined) throw new Error("The asset bytes required for undo are unavailable.");
    if (previous) update.run(row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson, row.id);
    else insert.run(row.id, row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson);
  }
}

export function restoreState(db: DatabaseSync, state: PersistentState): void {
  transaction(db, () => {
    db.prepare("UPDATE world SET id=?,name=?,settings_json=?").run(state.world.id, state.world.name, state.world.settingsJson);
    db.exec("DELETE FROM objects; DELETE FROM region_shapes; DELETE FROM regions; DELETE FROM terrain_shapes;");
    const terrain = db.prepare("INSERT INTO terrain_shapes(id,geometry_json) VALUES (?,?)"); for (const row of state.terrainShapes) terrain.run(row.id, row.geometryJson);
    const region = db.prepare("INSERT INTO regions(id,name,color) VALUES (?,?,?)"); for (const row of state.regions) region.run(row.id, row.name, row.color);
    const regionShape = db.prepare("INSERT INTO region_shapes(id,region_id,geometry_json) VALUES (?,?,?)"); for (const row of state.regionShapes) regionShape.run(row.id, row.regionId, row.geometryJson);
    restoreAssets(db, state.assets);
    const object = db.prepare("INSERT INTO objects(id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?)"); for (const row of state.objects) object.run(row.id, row.kind, row.label, row.geometryJson, row.propertiesJson, row.zIndex, row.locked, row.assetId);
  });
}
export function equalState(a: PersistentState, b: PersistentState): boolean { return JSON.stringify(a, (_key, value) => value instanceof Uint8Array ? [...value] : value) === JSON.stringify(b, (_key, value) => value instanceof Uint8Array ? [...value] : value); }
