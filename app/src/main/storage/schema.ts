import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { corrupt, RealmError } from "../domain/errors";
import { DEFAULT_SETTINGS, parseStoredSettings } from "../domain/settings";
import { validateGeometry, validateName, validateProperties } from "../domain/geometry";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import type { GridShape, MapShapeGeometry, ObjectKind } from "../../shared/realmContract";

/** Schema 13 separates the user-facing layer tree from typed map content. */
export const CURRENT_SCHEMA_VERSION = 13;
export const ACCEPTED_SCHEMA_VERSIONS = [13] as const;
export const GRID_VERSION = 2;
export const DEFAULT_LAYER_NAME = "レイヤー 1";
const OBJECT_KINDS = "'city','text','mountain','forest'";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SETTINGS_CHECK = `CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768 AND json_type(settings_json, '$.canvasWidth') = 'integer' AND json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.canvasHeight') = 'integer' AND json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.gridKind') = 'text' AND json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex') AND json_type(settings_json, '$.gridColor') = 'text' AND length(json_extract(settings_json, '$.gridColor')) = 7 AND json_extract(settings_json, '$.gridColor') GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]' AND (json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real') AND CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4 AND json_type(settings_json, '$.themeOverrides') = 'object')`;
const RETIRED_OBJECTS = [
  "features", "map_shapes", "cell_grid", "cell_attributes", "cell_attributes_lookup", "eras", "timeline_events", "feature_revisions", "cell_edit_operations", "cell_attribute_revisions",
  "feature_revisions_lookup", "feature_revisions_year", "timeline_events_range", "cell_attribute_revisions_lookup", "cell_attribute_revisions_view", "feature_revision_sequence_monotonic", "feature_revision_no_update", "feature_revision_no_delete", "cell_attribute_revision_sequence_monotonic", "cell_attribute_revision_no_update", "cell_attribute_revision_no_delete", "cell_edit_operation_no_update", "cell_edit_operation_no_delete",
] as const;

function hasMovedExtensionCandidates(): string[] {
  const candidates = [process.env.REALM_HAS_MOVED_EXTENSION, process.resourcesPath && join(process.resourcesPath, "realm_has_moved.dylib"), process.resourcesPath && join(process.resourcesPath, "native", "build", "realm_has_moved.dylib"), resolve(process.cwd(), "native/build/realm_has_moved.dylib")];
  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}
export function hasMovedExtensionPath(): string | null { return hasMovedExtensionCandidates().find((candidate) => existsSync(candidate)) ?? null; }
export function loadHasMovedExtension(db: DatabaseSync): void {
  const path = hasMovedExtensionPath();
  if (!path) throw new RealmError("storage_error", "SQLite HAS_MOVED verification extension is unavailable.");
  try { db.loadExtension(path); db.enableLoadExtension(false); } catch { throw new RealmError("storage_error", "SQLite HAS_MOVED verification extension could not be loaded."); }
}
export function assertSqlitePathNotMoved(db: DatabaseSync): void {
  try { db.prepare("SELECT realm_has_moved()").get(); } catch { throw new RealmError("invalid_path", "The project file moved while it was open."); }
}

export function configureDatabase(db: DatabaseSync): void {
  loadHasMovedExtension(db);
  assertSqlitePathNotMoved(db);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  assertSqlitePathNotMoved(db);
}

export function configureNewDatabase(db: DatabaseSync): void {
  configureDatabase(db);
  const current = String((db.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined)?.journal_mode ?? "");
  if (current.toLowerCase() !== "delete") {
    db.exec("PRAGMA journal_mode = DELETE");
    const confirmed = String((db.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined)?.journal_mode ?? "");
    if (confirmed.toLowerCase() !== "delete") throw new RealmError("storage_error", "The project storage mode is unavailable.");
  }
}

export function schemaSql(): string {
  return `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS world (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, settings_json TEXT NOT NULL ${SETTINGS_CHECK});
CREATE TABLE IF NOT EXISTS layer_nodes (id TEXT PRIMARY KEY NOT NULL, parent_id TEXT REFERENCES layer_nodes(id) ON DELETE RESTRICT, kind TEXT NOT NULL CHECK (kind IN ('group','leaf')), name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200), sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN -1000000 AND 1000000), visible INTEGER NOT NULL CHECK (visible IN (0,1)), locked INTEGER NOT NULL CHECK (locked IN (0,1)), UNIQUE(parent_id,sort_order));
CREATE INDEX IF NOT EXISTS layer_nodes_parent_order ON layer_nodes(parent_id,sort_order,id);
CREATE TABLE IF NOT EXISTS terrain_shapes (id TEXT PRIMARY KEY NOT NULL, layer_id TEXT NOT NULL REFERENCES layer_nodes(id) ON DELETE RESTRICT, geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json) AND json_type(geometry_json) = 'object'));
CREATE INDEX IF NOT EXISTS terrain_shapes_layer_lookup ON terrain_shapes(layer_id,id);
CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY NOT NULL, layer_id TEXT NOT NULL REFERENCES layer_nodes(id) ON DELETE RESTRICT, name TEXT NOT NULL, color TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'), UNIQUE(id,layer_id));
CREATE INDEX IF NOT EXISTS regions_layer_lookup ON regions(layer_id,name,id);
CREATE TABLE IF NOT EXISTS region_shapes (id TEXT PRIMARY KEY NOT NULL, region_id TEXT NOT NULL, layer_id TEXT NOT NULL, geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json) AND json_type(geometry_json) = 'object'), FOREIGN KEY (region_id,layer_id) REFERENCES regions(id,layer_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS region_shapes_region_lookup ON region_shapes(region_id,layer_id,id);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64), mime TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768), height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768), metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'));
CREATE INDEX IF NOT EXISTS assets_sha256_lookup ON assets(sha256);
CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY NOT NULL, layer_id TEXT NOT NULL REFERENCES layer_nodes(id) ON DELETE RESTRICT, kind TEXT NOT NULL CHECK (kind IN (${OBJECT_KINDS})), label TEXT NOT NULL, geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json) AND json_type(geometry_json) = 'object'), properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object'), z_index INTEGER NOT NULL CHECK (z_index BETWEEN -1000000 AND 1000000), locked INTEGER NOT NULL CHECK (locked IN (0,1)), asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS objects_order_lookup ON objects(layer_id,z_index,id);`;
}

export function initializeSchema(db: DatabaseSync, worldId: string, worldName: string): void {
  if (Number(readPragma(db, "user_version")) !== 0 || Number((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type IN ('table','index','trigger')").get() as { count: number }).count) !== 0) throw new RealmError("storage_error", "A new project could not be initialized safely.");
  transaction(db, () => {
    db.exec(schemaSql());
    db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    db.prepare("INSERT INTO world(id,name,settings_json) VALUES (?,?,?)").run(worldId, worldName.trim(), JSON.stringify(DEFAULT_SETTINGS));
    db.prepare("INSERT INTO layer_nodes(id,parent_id,kind,name,sort_order,visible,locked) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), null, "leaf", DEFAULT_LAYER_NAME, 0, 1, 0);
    verifyCurrentSchema(db);
  });
}

function readPragma(db: DatabaseSync, key: string): unknown { return (db.prepare(`PRAGMA ${key}`).get() as Record<string, unknown> | undefined)?.[key]; }
function tableExists(db: DatabaseSync, name: string): boolean { return Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?) AS value").get(name) as { value: number }).value); }
type ColumnExpectation = { name: string; declaredType: string; notNull: boolean; primaryKey: boolean };
const column = (name: string, declaredType: string, notNull: boolean, primaryKey: boolean): ColumnExpectation => ({ name, declaredType, notNull, primaryKey });
const SCHEMA_MIGRATION_COLUMNS = [column("version", "INTEGER", false, true), column("applied_at", "TEXT", true, false)];
const WORLD_COLUMNS = [column("id", "TEXT", true, true), column("name", "TEXT", true, false), column("settings_json", "TEXT", true, false)];
const LAYER_NODE_COLUMNS = [column("id", "TEXT", true, true), column("parent_id", "TEXT", false, false), column("kind", "TEXT", true, false), column("name", "TEXT", true, false), column("sort_order", "INTEGER", true, false), column("visible", "INTEGER", true, false), column("locked", "INTEGER", true, false)];
const TERRAIN_COLUMNS = [column("id", "TEXT", true, true), column("layer_id", "TEXT", true, false), column("geometry_json", "TEXT", true, false)];
const REGION_COLUMNS = [column("id", "TEXT", true, true), column("layer_id", "TEXT", true, false), column("name", "TEXT", true, false), column("color", "TEXT", true, false)];
const REGION_SHAPE_COLUMNS = [column("id", "TEXT", true, true), column("region_id", "TEXT", true, false), column("layer_id", "TEXT", true, false), column("geometry_json", "TEXT", true, false)];
const OBJECT_COLUMNS = [column("id", "TEXT", true, true), column("layer_id", "TEXT", true, false), column("kind", "TEXT", true, false), column("label", "TEXT", true, false), column("geometry_json", "TEXT", true, false), column("properties_json", "TEXT", true, false), column("z_index", "INTEGER", true, false), column("locked", "INTEGER", true, false), column("asset_id", "TEXT", false, false)];
const ASSET_COLUMNS = [column("id", "TEXT", true, true), column("sha256", "TEXT", true, false), column("mime", "TEXT", true, false), column("bytes", "BLOB", true, false), column("width", "INTEGER", true, false), column("height", "INTEGER", true, false), column("metadata_json", "TEXT", true, false)];
function tableInfo(db: DatabaseSync, table: string): ColumnExpectation[] { return db.prepare(`PRAGMA table_info(${table})`).all().map((raw) => { const row = raw as Record<string, unknown>; return { name: String(row.name), declaredType: String(row.type), notNull: Number(row.notnull) !== 0, primaryKey: Number(row.pk) !== 0 }; }); }
function hasColumns(db: DatabaseSync, table: string, expected: ColumnExpectation[]): boolean { const found = tableInfo(db, table); return found.length === expected.length && expected.every((want, index) => { const got = found[index]; return got?.name === want.name && got.declaredType.toUpperCase() === want.declaredType && got.notNull === want.notNull && got.primaryKey === want.primaryKey; }); }
function normalizedSql(db: DatabaseSync, objectType: string, name: string): string { const row = db.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").get(objectType, name) as { sql?: unknown } | undefined; return String(row?.sql ?? "").replace(/\s+/g, " ").trim().toLowerCase(); }
function indexColumns(db: DatabaseSync, name: string): string[] { return db.prepare(`PRAGMA index_info(${name})`).all().map((raw) => String((raw as Record<string, unknown>).name)); }
function assertIndex(db: DatabaseSync, name: string, expected: string[]): void { if (!indexColumns(db, name).every((value, index) => value === expected[index]) || indexColumns(db, name).length !== expected.length) throw corrupt(); }
function assertTableSql(db: DatabaseSync, table: string, fragments: readonly string[]): void { const sql = normalizedSql(db, "table", table).replace(/\s+/g, ""); if (!sql || fragments.some((fragment) => !sql.includes(fragment.toLowerCase().replace(/\s+/g, "")))) throw corrupt(); }
function rowCount(db: DatabaseSync, table: string): number { return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
function verifyAssetsSchema(db: DatabaseSync): void { assertTableSql(db, "assets", ["unique", "check (length(sha256) = 64)", "check (width > 0", "check (height > 0", "check (json_valid(metadata_json)", "json_type(metadata_json) = 'object'"]); assertIndex(db, "assets_sha256_lookup", ["sha256"]); }
function assertNoRetiredObjects(db: DatabaseSync): void { for (const retired of RETIRED_OBJECTS) if (tableExists(db, retired) || Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('index','trigger') AND name=?) AS value").get(retired) as { value: number }).value)) throw corrupt("This project contains storage from an older Realm format."); }
function parseJson(value: unknown, label: string): unknown { try { return JSON.parse(String(value)); } catch { throw corrupt(`A project contains invalid ${label}.`); } }
function verifyGeometryRows(db: DatabaseSync): void {
  const transient: GridShape[] = [];
  const nodeRows = db.prepare("SELECT id,parent_id AS parentId,kind,name,sort_order AS sortOrder,visible,locked FROM layer_nodes ORDER BY parent_id,sort_order,id").all() as Record<string, unknown>[];
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const row of nodeRows) {
    const id = String(row.id); const parentId = row.parentId === null || row.parentId === undefined ? null : String(row.parentId);
    if (!UUID_PATTERN.test(id) || (parentId !== null && !UUID_PATTERN.test(parentId)) || !["group", "leaf"].includes(String(row.kind)) || !Number.isSafeInteger(Number(row.sortOrder)) || ![0, 1].includes(Number(row.visible)) || ![0, 1].includes(Number(row.locked))) throw corrupt("A layer node contains invalid structure.");
    try { validateName(String(row.name)); } catch { throw corrupt("A layer node contains an invalid name."); }
    nodeById.set(id, row);
  }
  if (nodeRows.length === 0 || !nodeRows.some((row) => String(row.kind) === "leaf")) throw corrupt("The project must contain an editable leaf layer.");
  for (const row of nodeRows) {
    const nodeId = String(row.id); const parentId = row.parentId === null || row.parentId === undefined ? null : String(row.parentId);
    if (parentId !== null && (!nodeById.has(parentId) || parentId === nodeId)) throw corrupt("A layer node contains an invalid parent.");
    const seen = new Set<string>(); let current: string | null = nodeId;
    while (current !== null) { if (seen.has(current)) throw corrupt("The layer tree contains a cycle."); seen.add(current); const parent: unknown = nodeById.get(current)?.parentId; current = parent === null || parent === undefined ? null : String(parent); }
  }
  const siblingOrders = new Set<string>();
  for (const row of nodeRows) { const parent = row.parentId === null || row.parentId === undefined ? "" : String(row.parentId); const key = `${parent}:${row.sortOrder}`; if (siblingOrders.has(key)) throw corrupt("Layer sibling order is not unique."); siblingOrders.add(key); }
  const leafIds = new Set(nodeRows.filter((row) => String(row.kind) === "leaf").map((row) => String(row.id)));
  for (const row of nodeRows.filter((candidate) => String(candidate.kind) === "group")) {
    const id = String(row.id);
    if (["terrain_shapes", "regions", "objects"].some((table) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE layer_id=?`).get(id) as { count: number }).count) > 0)) throw corrupt("A group layer cannot contain map content.");
  }
  const regionColors = new Map<string, string>();
  for (const row of db.prepare("SELECT id,layer_id AS layerId,name,color FROM regions ORDER BY id").all() as Record<string, unknown>[]) {
    const id = String(row.id); const layerId = String(row.layerId); const name = String(row.name); const color = String(row.color);
    if (!UUID_PATTERN.test(id) || !leafIds.has(layerId) || !/^#[\da-f]{6}$/iu.test(color)) throw corrupt("A region contains invalid identity, layer, or color.");
    try { validateName(name); } catch { throw corrupt("A region contains an invalid name."); }
    regionColors.set(id, color);
  }
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) throw corrupt("The project contains an invalid layer reference.");
  for (const row of db.prepare("SELECT id,layer_id AS layerId,geometry_json AS geometryJson FROM terrain_shapes ORDER BY layer_id,id").all() as Record<string, unknown>[]) { if (!leafIds.has(String(row.layerId))) throw corrupt("A terrain shape refers to an invalid layer."); transient.push({ id: String(row.id), layer: "terrain", layerId: String(row.layerId), value: "terrain", geometry: parseJson(row.geometryJson, "terrain geometry") as MapShapeGeometry }); }
  for (const row of db.prepare("SELECT id,region_id AS regionId,layer_id AS layerId,geometry_json AS geometryJson FROM region_shapes ORDER BY layer_id,region_id,id").all() as Record<string, unknown>[]) {
    const regionId = String(row.regionId); const color = regionColors.get(regionId);
    if (!color || !leafIds.has(String(row.layerId)) || db.prepare("SELECT 1 FROM regions WHERE id=? AND layer_id=?").get(regionId, String(row.layerId)) === undefined) throw corrupt("A region shape refers to a missing region or wrong layer.");
    transient.push({ id: String(row.id), layer: "region", layerId: String(row.layerId), regionId, value: color, geometry: parseJson(row.geometryJson, "region geometry") as MapShapeGeometry });
  }
  try { validateMapShapes(transient.map((shape) => ({ ...shape, geometryVersion: 1, snapGridVersion: GRID_VERSION }))); } catch { throw corrupt("A terrain or region shape is invalid or overlaps another shape in its layer."); }
  for (const row of db.prepare("SELECT id,layer_id AS layerId,kind,label,geometry_json AS geometryJson,properties_json AS propertiesJson,z_index AS zIndex,locked,asset_id AS assetId FROM objects ORDER BY layer_id,z_index,id").all() as Record<string, unknown>[]) {
    if (!UUID_PATTERN.test(String(row.id)) || !leafIds.has(String(row.layerId)) || !Number.isSafeInteger(Number(row.zIndex)) || Number(row.zIndex) < -1000000 || Number(row.zIndex) > 1000000 || ![0, 1].includes(Number(row.locked))) throw corrupt("An object contains invalid identity, layer, or ordering.");
    try { validateName(String(row.label)); } catch { throw corrupt("An object contains an invalid label."); }
    const kind = String(row.kind) as ObjectKind;
    try { validateGeometry(kind, parseJson(row.geometryJson, "object geometry"), true); validateProperties(parseJson(row.propertiesJson, "object properties")); } catch { throw corrupt("An object contains invalid geometry or properties."); }
    if (row.assetId !== null && row.assetId !== undefined && !UUID_PATTERN.test(String(row.assetId))) throw corrupt("An object contains an invalid asset reference.");
  }
}

export function schemaVersion(db: DatabaseSync): number {
  const integrity = String((db.prepare("PRAGMA quick_check(1)").get() as Record<string, unknown> | undefined)?.quick_check ?? "");
  if (integrity.toLowerCase() !== "ok") throw corrupt("The project file is corrupt or not a Realm project.");
  const user = Number(readPragma(db, "user_version") ?? 0);
  if (!tableExists(db, "schema_migrations")) throw corrupt("The project file does not contain a Realm schema.");
  const recorded = (db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number }).version;
  if (!recorded || user !== Number(recorded)) throw corrupt("The project schema versions do not agree.");
  if (user > CURRENT_SCHEMA_VERSION || Number(recorded) > CURRENT_SCHEMA_VERSION) throw new RealmError("future_schema", "This project was created by a newer version of Realm.");
  if (!(ACCEPTED_SCHEMA_VERSIONS as readonly number[]).includes(user)) throw new RealmError("unsupported_schema", "This project uses an unsupported Realm format and cannot be migrated.");
  return user;
}

export function verifyCurrentSchema(db: DatabaseSync): void {
  if (!hasColumns(db, "schema_migrations", SCHEMA_MIGRATION_COLUMNS) || !hasColumns(db, "world", WORLD_COLUMNS) || !hasColumns(db, "layer_nodes", LAYER_NODE_COLUMNS) || !hasColumns(db, "terrain_shapes", TERRAIN_COLUMNS) || !hasColumns(db, "regions", REGION_COLUMNS) || !hasColumns(db, "region_shapes", REGION_SHAPE_COLUMNS) || !hasColumns(db, "assets", ASSET_COLUMNS) || !hasColumns(db, "objects", OBJECT_COLUMNS)) throw corrupt();
  if (rowCount(db, "world") !== 1) throw corrupt("The project must contain exactly one world record.");
  // The settings constraint itself is defined in schemaSql; only its stable
  // JSON-object guard is checked here because SQLite normalizes the long
  // numeric expression differently across bundled SQLite builds.
  assertTableSql(db, "world", ["check (json_valid(settings_json)", "json_type(settings_json) = 'object'"]);
  assertTableSql(db, "layer_nodes", ["check (kind in ('group','leaf'))", "check (visible in (0,1))", "check (locked in (0,1))"]);
  assertTableSql(db, "terrain_shapes", ["references layer_nodes(id)", "check (json_valid(geometry_json)", "json_type(geometry_json) = 'object'"]);
  assertTableSql(db, "regions", ["references layer_nodes(id)", "check (color glob"]);
  assertTableSql(db, "region_shapes", ["references regions(id,layer_id)", "on delete cascade", "check (json_valid(geometry_json)"]);
  assertTableSql(db, "objects", ["references layer_nodes(id)", "check (kind in ('city','text','mountain','forest'))", "check (json_valid(geometry_json)", "check (json_valid(properties_json)", "check (z_index between", "check (locked in (0,1))"]);
  assertIndex(db, "layer_nodes_parent_order", ["parent_id", "sort_order", "id"]);
  assertIndex(db, "region_shapes_region_lookup", ["region_id", "layer_id", "id"]);
  assertIndex(db, "objects_order_lookup", ["layer_id", "z_index", "id"]);
  verifyAssetsSchema(db);
  assertNoRetiredObjects(db);
  parseStoredSettings(String((db.prepare("SELECT settings_json FROM world LIMIT 1").get() as { settings_json: string }).settings_json));
  verifyGeometryRows(db);
}
export function preflightSchema(db: DatabaseSync): number { const version = schemaVersion(db); verifyCurrentSchema(db); return version; }
/** Old formats are rejected before a writable connection is opened. */
export function migrateToCurrent(db: DatabaseSync, version: number): void {
  if (version !== CURRENT_SCHEMA_VERSION) throw new RealmError("unsupported_schema", "This project uses an unsupported Realm format and cannot be migrated.");
  verifyCurrentSchema(db);
}
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  const databaseFile = String((db.prepare("PRAGMA database_list").all()[0] as Record<string, unknown> | undefined)?.file ?? "");
  const assertCurrentPath = (): void => { if (databaseFile !== "") assertSqlitePathNotMoved(db); };
  assertCurrentPath(); db.exec("BEGIN IMMEDIATE");
  try { assertCurrentPath(); const result = operation(); assertCurrentPath(); db.exec("COMMIT"); assertCurrentPath(); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch { /* preserve original */ } throw error; }
}

/** Read one SQLite snapshot while keeping all project rows consistent. */
export function readTransaction<T>(db: DatabaseSync, operation: () => T): T {
  const databaseFile = String((db.prepare("PRAGMA database_list").all()[0] as Record<string, unknown> | undefined)?.file ?? "");
  const assertCurrentPath = (): void => { if (databaseFile !== "") assertSqlitePathNotMoved(db); };
  assertCurrentPath(); db.exec("BEGIN");
  try { assertCurrentPath(); const result = operation(); assertCurrentPath(); db.exec("COMMIT"); assertCurrentPath(); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch { /* preserve original */ } throw error; }
}
