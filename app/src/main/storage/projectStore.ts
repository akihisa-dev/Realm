import type { DatabaseSync } from "node:sqlite";
import type { ObjectKind } from "../../shared/realmContract";
import { RealmError } from "../domain/errors";
import { transaction } from "./schema";

export type LayerNodeRow = { id: string; parentId: string | null; kind: "group" | "leaf"; name: string; sortOrder: number; visible: number; locked: number };
export type TerrainShapeRow = { id: string; layerId: string; geometryJson: string };
export type RegionRow = { id: string; layerId: string; name: string; color: string };
export type RegionShapeRow = { id: string; regionId: string; layerId: string; geometryJson: string };
export type ObjectRow = { id: string; layerId: string; kind: ObjectKind; label: string; geometryJson: string; propertiesJson: string; zIndex: number; locked: number; assetId: string | null };
export type AssetRow = { id: string; sha256: string; mime: string; bytes?: Uint8Array; width: number; height: number; metadataJson: string; byteLength?: number };
export type PersistentState = { world: { id: string; name: string; settingsJson: string }; layerNodes: LayerNodeRow[]; terrainShapes: TerrainShapeRow[]; regions: RegionRow[]; regionShapes: RegionShapeRow[]; objects: ObjectRow[]; assets: AssetRow[] };
export type EditOperation = { before: PersistentState; after: PersistentState; label: string };
export type CaptureStateOptions = { assetBytesFor?: readonly string[]; includeAssetBytes?: boolean; includeAssetByteLength?: boolean; regionOrder?: "id" | "name" };

type Row = Record<string, unknown>;
export type PreparedTerrain = { id: string; layerId: string; geometry: unknown };
export type PreparedRegion = { id: string; layerId: string; name: string; color: string; shapes: Array<{ id: string; layerId: string; geometry: unknown }> };
export type PreparedObject = { id: string; layerId: string; kind: ObjectKind; label: string; geometry: unknown; properties: unknown; zIndex: number; locked: boolean; assetId?: string };

function rows<T>(db: DatabaseSync, sql: string, mapper: (row: Row) => T): T[] {
  return db.prepare(sql).all().map((row) => mapper(row as Row));
}

function bytesFromRow(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error("The asset bytes could not be captured.");
}

function bytesFromSnapshotRow(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array();
}

function readAssetRows(db: DatabaseSync, includeBytes: boolean, includeByteLength = false): AssetRow[] {
  const columns = ["id", "sha256", "mime", ...(includeByteLength ? ["length(bytes) AS byteLength"] : []), ...(includeBytes ? ["bytes"] : []), "width", "height", "metadata_json AS metadataJson"].join(",");
  return rows(db, `SELECT ${columns} FROM assets ORDER BY id`, (row) => ({
    id: String(row.id), sha256: String(row.sha256), mime: String(row.mime),
    ...(includeByteLength ? { byteLength: Number(row.byteLength) } : {}),
    ...(includeBytes ? { bytes: bytesFromSnapshotRow(row.bytes) } : {}),
    width: Number(row.width), height: Number(row.height), metadataJson: String(row.metadataJson),
  }));
}

/** The one row codec used by snapshots, history, restore, and mutations. */
export class ProjectStore {
  constructor(readonly database: DatabaseSync) {}

  readState(options: CaptureStateOptions = {}): PersistentState {
    const regionOrder = options.regionOrder === "name" ? "layer_id,name,id" : "layer_id,id";
    const worldRow = this.database.prepare("SELECT id,name,settings_json AS settingsJson FROM world LIMIT 1").get() as Row | undefined;
    if (!worldRow) throw new RealmError("corrupt_project", "The project must contain exactly one world record.");
    const state: PersistentState = {
      world: { id: String(worldRow.id), name: String(worldRow.name), settingsJson: String(worldRow.settingsJson) },
      layerNodes: rows(this.database, "SELECT id,parent_id AS parentId,kind,name,sort_order AS sortOrder,visible,locked FROM layer_nodes ORDER BY parent_id,sort_order,id", (row) => ({
        id: String(row.id), parentId: row.parentId === null || row.parentId === undefined ? null : String(row.parentId), kind: String(row.kind) as LayerNodeRow["kind"], name: String(row.name), sortOrder: Number(row.sortOrder), visible: Number(row.visible), locked: Number(row.locked),
      })),
      terrainShapes: rows(this.database, "SELECT id,layer_id AS layerId,geometry_json AS geometryJson FROM terrain_shapes ORDER BY layer_id,id", (row) => ({ id: String(row.id), layerId: String(row.layerId), geometryJson: String(row.geometryJson) })),
      regions: rows(this.database, `SELECT id,layer_id AS layerId,name,color FROM regions ORDER BY ${regionOrder}`, (row) => ({ id: String(row.id), layerId: String(row.layerId), name: String(row.name), color: String(row.color) })),
      regionShapes: rows(this.database, "SELECT id,region_id AS regionId,layer_id AS layerId,geometry_json AS geometryJson FROM region_shapes ORDER BY layer_id,region_id,id", (row) => ({ id: String(row.id), regionId: String(row.regionId), layerId: String(row.layerId), geometryJson: String(row.geometryJson) })),
      objects: rows(this.database, "SELECT id,layer_id AS layerId,kind,label,geometry_json AS geometryJson,properties_json AS propertiesJson,z_index AS zIndex,locked,asset_id AS assetId FROM objects ORDER BY layer_id,z_index,id", (row) => ({
        id: String(row.id), layerId: String(row.layerId), kind: String(row.kind) as ObjectKind, label: String(row.label), geometryJson: String(row.geometryJson), propertiesJson: String(row.propertiesJson), zIndex: Number(row.zIndex), locked: Number(row.locked), assetId: row.assetId === null || row.assetId === undefined ? null : String(row.assetId),
      })),
      assets: readAssetRows(this.database, options.includeAssetBytes === true, options.includeAssetByteLength === true),
    };
    this.captureAssetBytes(state, options.assetBytesFor ?? []);
    return state;
  }

  readLayerNodes(): LayerNodeRow[] {
    return rows(this.database, "SELECT id,parent_id AS parentId,kind,name,sort_order AS sortOrder,visible,locked FROM layer_nodes ORDER BY parent_id,sort_order,id", (row) => ({
      id: String(row.id), parentId: row.parentId === null || row.parentId === undefined ? null : String(row.parentId), kind: String(row.kind) as LayerNodeRow["kind"], name: String(row.name), sortOrder: Number(row.sortOrder), visible: Number(row.visible), locked: Number(row.locked),
    }));
  }

  contentCount(layerId: string): number {
    return ["terrain_shapes", "regions", "objects"].reduce((total, table) => total + Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE layer_id=?`).get(layerId) as Row).count), 0);
  }

  captureAssetBytes(state: PersistentState, ids: readonly string[]): void {
    const wanted = new Set(ids);
    if (wanted.size === 0) return;
    const statement = this.database.prepare("SELECT bytes FROM assets WHERE id=?");
    for (const asset of state.assets) {
      if (!wanted.has(asset.id) || asset.bytes !== undefined) continue;
      const row = statement.get(asset.id) as Row | undefined;
      if (!row) throw new Error("The asset bytes could not be captured.");
      asset.bytes = bytesFromRow(row.bytes);
    }
    if ([...wanted].some((id) => !state.assets.some((asset) => asset.id === id && asset.bytes !== undefined))) throw new Error("The asset bytes could not be captured.");
  }

  changedAssetIds(before: PersistentState, after: PersistentState): string[] {
    const beforeById = new Map(before.assets.map((asset) => [asset.id, asset]));
    return after.assets.filter((asset) => {
      const previous = beforeById.get(asset.id);
      return !previous || previous.sha256 !== asset.sha256 || previous.mime !== asset.mime || previous.width !== asset.width || previous.height !== asset.height || previous.metadataJson !== asset.metadataJson;
    }).map((asset) => asset.id);
  }

  replaceTerrainLayer(terrain: readonly PreparedTerrain[]): void {
    this.database.exec("DELETE FROM terrain_shapes");
    this.insertTerrainLayer(terrain);
  }

  private insertTerrainLayer(terrain: readonly PreparedTerrain[]): void {
    const statement = this.database.prepare("INSERT INTO terrain_shapes(id,layer_id,geometry_json) VALUES (?,?,?)");
    for (const shape of terrain) statement.run(shape.id, shape.layerId, JSON.stringify(shape.geometry));
  }

  replaceRegionLayer(regions: readonly PreparedRegion[]): void {
    this.database.exec("DELETE FROM region_shapes; DELETE FROM regions;");
    this.insertRegionLayer(regions);
  }

  private insertRegionLayer(regions: readonly PreparedRegion[]): void {
    const region = this.database.prepare("INSERT INTO regions(id,layer_id,name,color) VALUES (?,?,?,?)");
    const shape = this.database.prepare("INSERT INTO region_shapes(id,region_id,layer_id,geometry_json) VALUES (?,?,?,?)");
    for (const item of regions) {
      region.run(item.id, item.layerId, item.name, item.color);
      for (const child of item.shapes) shape.run(child.id, item.id, child.layerId, JSON.stringify(child.geometry));
    }
  }

  replaceObjectLayer(objects: readonly PreparedObject[]): void {
    this.database.exec("DELETE FROM objects");
    this.insertObjectLayer(objects);
  }

  private insertObjectLayer(objects: readonly PreparedObject[]): void {
    const statement = this.database.prepare("INSERT INTO objects(id,layer_id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const object of objects) statement.run(object.id, object.layerId, object.kind, object.label, JSON.stringify(object.geometry), JSON.stringify(object.properties), object.zIndex, object.locked ? 1 : 0, object.assetId ?? null);
  }

  replaceMapContent(terrain: readonly PreparedTerrain[], regions: readonly PreparedRegion[], objects: readonly PreparedObject[]): void {
    this.database.exec("DELETE FROM objects; DELETE FROM region_shapes; DELETE FROM regions; DELETE FROM terrain_shapes;");
    this.insertTerrainLayer(terrain);
    this.insertRegionLayer(regions);
    this.insertObjectLayer(objects);
  }

  replaceLayerTree(tree: readonly LayerNodeRow[]): void {
    const existing = this.readLayerNodes();
    const nextIds = new Set(tree.map((node) => node.id));
    const temporary = this.database.prepare("UPDATE layer_nodes SET sort_order=? WHERE id=?");
    existing.forEach((row, index) => temporary.run(-1000000 + index, row.id));
    const insert = this.database.prepare("INSERT OR IGNORE INTO layer_nodes(id,parent_id,kind,name,sort_order,visible,locked) VALUES (?,NULL,?,'一時layer',?,?,?)");
    tree.forEach((node, index) => insert.run(node.id, node.kind, -1000000 + existing.length + index, node.visible, node.locked));
    const update = this.database.prepare("UPDATE layer_nodes SET parent_id=?,kind=?,name=?,sort_order=?,visible=?,locked=? WHERE id=?");
    for (const node of tree) update.run(node.parentId, node.kind, node.name, node.sortOrder, node.visible, node.locked, node.id);
    const oldParents = new Map(existing.map((row) => [row.id, row.parentId]));
    const depthOf = (id: string): number => {
      let depth = 0; let parent = oldParents.get(id) ?? null; const seen = new Set<string>();
      while (parent !== null && !seen.has(parent)) { seen.add(parent); depth += 1; parent = oldParents.get(parent) ?? null; }
      return depth;
    };
    const oldIds = existing.map((row) => row.id).filter((id) => !nextIds.has(id)).sort((left, right) => depthOf(right) - depthOf(left));
    const remove = this.database.prepare("DELETE FROM layer_nodes WHERE id=?");
    for (const id of oldIds) remove.run(id);
  }

  updateProjectName(name: string): void {
    if (this.database.prepare("UPDATE world SET name=?").run(name).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record.");
  }

  updateProjectSettings(settingsJson: string): void {
    if (this.database.prepare("UPDATE world SET settings_json=?").run(settingsJson).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record.");
  }

  importAsset(id: string, asset: { sha256: string; mime: string; bytes: Uint8Array; width: number; height: number; metadataJson: string }): void {
    this.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)").run(id, asset.sha256, asset.mime, asset.bytes, asset.width, asset.height, asset.metadataJson);
  }

  importAssets(assets: readonly { id: string; sha256: string; mime: string; bytes: Uint8Array; width: number; height: number; metadataJson: string }[]): void {
    const statement = this.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)");
    for (const asset of assets) statement.run(asset.id, asset.sha256, asset.mime, asset.bytes, asset.width, asset.height, asset.metadataJson);
  }

  deleteAssets(ids: readonly string[]): void {
    const statement = this.database.prepare("DELETE FROM assets WHERE id=?");
    for (const id of ids) statement.run(id);
  }

  restoreState(state: PersistentState): void {
    transaction(this.database, () => this.restoreStateInTransaction(state));
  }

  restoreStateInTransaction(state: PersistentState): void {
    this.database.prepare("UPDATE world SET id=?,name=?,settings_json=?").run(state.world.id, state.world.name, state.world.settingsJson);
    this.database.exec("DELETE FROM objects; DELETE FROM region_shapes; DELETE FROM regions; DELETE FROM terrain_shapes; DELETE FROM layer_nodes;");
    const node = this.database.prepare("INSERT INTO layer_nodes(id,parent_id,kind,name,sort_order,visible,locked) VALUES (?,?,?,?,?,?,?)");
    for (const row of state.layerNodes) node.run(row.id, row.parentId, row.kind, row.name, row.sortOrder, row.visible, row.locked);
    const terrain = this.database.prepare("INSERT INTO terrain_shapes(id,layer_id,geometry_json) VALUES (?,?,?)");
    for (const row of state.terrainShapes) terrain.run(row.id, row.layerId, row.geometryJson);
    const region = this.database.prepare("INSERT INTO regions(id,layer_id,name,color) VALUES (?,?,?,?)");
    for (const row of state.regions) region.run(row.id, row.layerId, row.name, row.color);
    const regionShape = this.database.prepare("INSERT INTO region_shapes(id,region_id,layer_id,geometry_json) VALUES (?,?,?,?)");
    for (const row of state.regionShapes) regionShape.run(row.id, row.regionId, row.layerId, row.geometryJson);
    this.restoreAssetsInTransaction(state.assets);
    const object = this.database.prepare("INSERT INTO objects(id,layer_id,kind,label,geometry_json,properties_json,z_index,locked,asset_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const row of state.objects) object.run(row.id, row.layerId, row.kind, row.label, row.geometryJson, row.propertiesJson, row.zIndex, row.locked, row.assetId);
  }

  private restoreAssetsInTransaction(target: readonly AssetRow[]): void {
    const current = readAssetRows(this.database, false);
    const currentById = new Map(current.map((row) => [row.id, row])); const targetIds = new Set(target.map((row) => row.id));
    const remove = this.database.prepare("DELETE FROM assets WHERE id=?");
    for (const row of current) if (!targetIds.has(row.id)) remove.run(row.id);
    const update = this.database.prepare("UPDATE assets SET sha256=?,mime=?,bytes=?,width=?,height=?,metadata_json=? WHERE id=?");
    const insert = this.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)");
    for (const row of target) {
      const previous = currentById.get(row.id);
      if (previous && previous.sha256 === row.sha256 && previous.mime === row.mime && previous.width === row.width && previous.height === row.height && previous.metadataJson === row.metadataJson) continue;
      if (row.bytes === undefined) throw new Error("The asset bytes required for undo are unavailable.");
      if (previous) update.run(row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson, row.id);
      else insert.run(row.id, row.sha256, row.mime, row.bytes, row.width, row.height, row.metadataJson);
    }
  }

  readAsset(id: string): Row | undefined {
    return this.database.prepare("SELECT id,sha256,mime,length(bytes) AS byteLength,bytes,width,height,metadata_json AS metadata FROM assets WHERE id=?").get(id) as Row | undefined;
  }
}

export function equalState(a: PersistentState, b: PersistentState): boolean {
  return JSON.stringify(a, (_key, value) => value instanceof Uint8Array ? [...value] : value) === JSON.stringify(b, (_key, value) => value instanceof Uint8Array ? [...value] : value);
}
