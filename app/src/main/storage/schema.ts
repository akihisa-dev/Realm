import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { corrupt, RealmError } from "../domain/errors";
import { DEFAULT_SETTINGS, parseStoredSettings } from "../domain/settings";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import type { MapShape } from "../../shared/realmContract";

/** Schema 11 is intentionally a new, non-migrating storage format. */
export const CURRENT_SCHEMA_VERSION = 11;
export const ACCEPTED_SCHEMA_VERSIONS = [11] as const;
export const GRID_VERSION = 2;
const FEATURE_TYPES = "'terrain','forest','river','coastline','country','region','boundary','city','town','road','lake','mountain','tree','symbol','label','overlay','frame','scale'";
const SETTINGS_CHECK = `CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768 AND json_type(settings_json, '$.canvasWidth') = 'integer' AND json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.canvasHeight') = 'integer' AND json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.gridKind') = 'text' AND json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex') AND json_type(settings_json, '$.gridColor') = 'text' AND length(json_extract(settings_json, '$.gridColor')) = 7 AND json_extract(settings_json, '$.gridColor') GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]' AND (json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real') AND CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4 AND (json_type(settings_json, '$.gridSpacing') = 'integer' OR json_type(settings_json, '$.gridSpacing') = 'real') AND CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45 AND json_type(settings_json, '$.themeOverrides') = 'object')`;
const RETIRED_OBJECTS = [
  "eras", "timeline_events", "feature_revisions", "cell_edit_operations", "cell_attribute_revisions",
  "feature_revisions_lookup", "feature_revisions_year", "timeline_events_range", "cell_attribute_revisions_lookup",
  "cell_attribute_revisions_view", "feature_revision_sequence_monotonic", "feature_revision_no_update",
  "feature_revision_no_delete", "cell_attribute_revision_sequence_monotonic", "cell_attribute_revision_no_update",
  "cell_attribute_revision_no_delete", "cell_edit_operation_no_update", "cell_edit_operation_no_delete",
  "cell_attributes", "cell_attributes_lookup",
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

/** New staged databases must start in rollback-journal mode. */
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
CREATE TABLE IF NOT EXISTS features (id TEXT PRIMARY KEY NOT NULL, feature_type TEXT NOT NULL CHECK (feature_type IN (${FEATURE_TYPES})), name TEXT NOT NULL, geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)), properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object'));
CREATE TABLE IF NOT EXISTS cell_grid (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), grid_version INTEGER NOT NULL CHECK (grid_version = 2), grid_columns INTEGER NOT NULL CHECK (grid_columns = 128), grid_rows INTEGER NOT NULL CHECK (grid_rows = 73));
CREATE TABLE IF NOT EXISTS map_shapes (id TEXT PRIMARY KEY NOT NULL, layer TEXT NOT NULL CHECK (layer IN ('terrain','region')), region_id TEXT CHECK ((layer = 'terrain' AND region_id IS NULL) OR (layer = 'region' AND region_id IS NOT NULL)), value TEXT NOT NULL, geometry_version INTEGER NOT NULL CHECK (geometry_version = 1), snap_grid_version INTEGER NOT NULL CHECK (snap_grid_version = 2), geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json) AND json_type(geometry_json) = 'object'));
CREATE INDEX IF NOT EXISTS map_shapes_layer_lookup ON map_shapes(layer,id);
CREATE INDEX IF NOT EXISTS map_shapes_region_lookup ON map_shapes(region_id,id);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64), mime TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768), height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768), metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'));
CREATE INDEX IF NOT EXISTS assets_sha256_lookup ON assets(sha256);
INSERT OR IGNORE INTO cell_grid(id, grid_version, grid_columns, grid_rows) VALUES (1,2,128,73);`;
}

export function initializeSchema(db: DatabaseSync, worldId: string, worldName: string): void {
  if (Number(readPragma(db, "user_version")) !== 0 || Number((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type IN ('table','index','trigger')").get() as { count: number }).count) !== 0) throw new RealmError("storage_error", "A new project could not be initialized safely.");
  transaction(db, () => {
    db.exec(schemaSql());
    db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    db.prepare("INSERT INTO world(id,name,settings_json) VALUES (?,?,?)").run(worldId, worldName.trim(), JSON.stringify(DEFAULT_SETTINGS));
    verifyCurrentSchema(db);
  });
}

function readPragma(db: DatabaseSync, key: string): unknown { return (db.prepare(`PRAGMA ${key}`).get() as Record<string, unknown> | undefined)?.[key]; }
function tableExists(db: DatabaseSync, name: string): boolean { return Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?) AS value").get(name) as { value: number }).value); }
type ColumnExpectation = { name: string; declaredType: string; notNull: boolean; primaryKey: boolean };
const column = (name: string, declaredType: string, notNull: boolean, primaryKey: boolean): ColumnExpectation => ({ name, declaredType, notNull, primaryKey });
const SCHEMA_MIGRATION_COLUMNS = [column("version", "INTEGER", false, true), column("applied_at", "TEXT", true, false)];
const WORLD_COLUMNS = [column("id", "TEXT", true, true), column("name", "TEXT", true, false), column("settings_json", "TEXT", true, false)];
const FEATURE_COLUMNS = [column("id", "TEXT", true, true), column("feature_type", "TEXT", true, false), column("name", "TEXT", true, false), column("geometry_json", "TEXT", true, false), column("properties_json", "TEXT", true, false)];
const CELL_GRID_COLUMNS = [column("id", "INTEGER", true, true), column("grid_version", "INTEGER", true, false), column("grid_columns", "INTEGER", true, false), column("grid_rows", "INTEGER", true, false)];
const MAP_SHAPE_COLUMNS = [column("id", "TEXT", true, true), column("layer", "TEXT", true, false), column("region_id", "TEXT", false, false), column("value", "TEXT", true, false), column("geometry_version", "INTEGER", true, false), column("snap_grid_version", "INTEGER", true, false), column("geometry_json", "TEXT", true, false)];
const ASSET_COLUMNS = [column("id", "TEXT", true, true), column("sha256", "TEXT", true, false), column("mime", "TEXT", true, false), column("bytes", "BLOB", true, false), column("width", "INTEGER", true, false), column("height", "INTEGER", true, false), column("metadata_json", "TEXT", true, false)];
const FULL_SETTINGS_FRAGMENTS = ["check (json_valid(settings_json)", "json_type(settings_json) = 'object'", "length(settings_json) <= 32768", "json_type(settings_json, '$.canvasWidth') = 'integer'", "json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192", "json_type(settings_json, '$.canvasHeight') = 'integer'", "json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192", "json_type(settings_json, '$.gridKind') = 'text'", "json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex')", "json_type(settings_json, '$.gridColor') = 'text'", "length(json_extract(settings_json, '$.gridColor')) = 7", "json_extract(settings_json, '$.gridColor') GLOB", "CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4", "CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45", "json_type(settings_json, '$.themeOverrides') = 'object'"];
function tableInfo(db: DatabaseSync, table: string): ColumnExpectation[] { return db.prepare(`PRAGMA table_info(${table})`).all().map((raw) => { const row = raw as Record<string, unknown>; return { name: String(row.name), declaredType: String(row.type), notNull: Number(row.notnull) !== 0, primaryKey: Number(row.pk) !== 0 }; }); }
function hasColumns(db: DatabaseSync, table: string, expected: ColumnExpectation[]): boolean { const found = tableInfo(db, table); return found.length === expected.length && expected.every((want, index) => { const got = found[index]; return got?.name === want.name && got.declaredType.toUpperCase() === want.declaredType && got.notNull === want.notNull && got.primaryKey === want.primaryKey; }); }
function normalizedSql(db: DatabaseSync, objectType: string, name: string): string { const row = db.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").get(objectType, name) as { sql?: unknown } | undefined; return String(row?.sql ?? "").replace(/\s+/g, " ").trim().toLowerCase(); }
function indexColumns(db: DatabaseSync, name: string): string[] { return db.prepare(`PRAGMA index_info(${name})`).all().map((raw) => String((raw as Record<string, unknown>).name)); }
function assertIndex(db: DatabaseSync, name: string, expected: string[]): void { if (!indexColumns(db, name).every((value, index) => value === expected[index]) || indexColumns(db, name).length !== expected.length) throw corrupt(); }
function assertTableSql(db: DatabaseSync, table: string, fragments: readonly string[]): void { const sql = normalizedSql(db, "table", table).replace(/\s+/g, ""); if (!sql || fragments.some((fragment) => !sql.includes(fragment.toLowerCase().replace(/\s+/g, "")))) throw corrupt(); }
function rowCount(db: DatabaseSync, table: string): number { return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
function verifyAssetsSchema(db: DatabaseSync): void { assertTableSql(db, "assets", ["unique", "check (length(sha256) = 64)", "check (width > 0", "check (height > 0", "check (json_valid(metadata_json)", "json_type(metadata_json) = 'object'"]); assertIndex(db, "assets_sha256_lookup", ["sha256"]); }
function assertNoRetiredObjects(db: DatabaseSync): void { for (const retired of RETIRED_OBJECTS) if (tableExists(db, retired) || Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('index','trigger') AND name=?) AS value").get(retired) as { value: number }).value)) throw corrupt("This project contains the retired cell-attribute storage."); }

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
  if (!hasColumns(db, "schema_migrations", SCHEMA_MIGRATION_COLUMNS) || !hasColumns(db, "world", WORLD_COLUMNS) || !hasColumns(db, "features", FEATURE_COLUMNS) || !hasColumns(db, "cell_grid", CELL_GRID_COLUMNS) || !hasColumns(db, "map_shapes", MAP_SHAPE_COLUMNS) || !hasColumns(db, "assets", ASSET_COLUMNS)) throw corrupt();
  if (rowCount(db, "world") !== 1 || rowCount(db, "cell_grid") !== 1) throw corrupt("The project must contain exactly one world record and one grid record.");
  assertTableSql(db, "world", FULL_SETTINGS_FRAGMENTS);
  assertTableSql(db, "features", ["check (json_valid(geometry_json)", "check (json_valid(properties_json)", "json_type(properties_json) = 'object'"]);
  assertTableSql(db, "cell_grid", ["check (id = 1)", "check (grid_version = 2)", "check (grid_columns = 128)", "check (grid_rows = 73)"]);
  assertTableSql(db, "map_shapes", ["check (layer in ('terrain','region'))", "check ((layer = 'terrain' and region_id is null) or (layer = 'region' and region_id is not null))", "check (geometry_version = 1)", "check (snap_grid_version = 2)", "check (json_valid(geometry_json)"]);
  assertIndex(db, "map_shapes_layer_lookup", ["layer", "id"]);
  assertIndex(db, "map_shapes_region_lookup", ["region_id", "id"]);
  verifyAssetsSchema(db);
  assertNoRetiredObjects(db);
  parseStoredSettings(String((db.prepare("SELECT settings_json FROM world LIMIT 1").get() as { settings_json: string }).settings_json));
  const mapShapes = (db.prepare("SELECT id,layer,region_id AS regionId,value,geometry_version AS geometryVersion,snap_grid_version AS snapGridVersion,geometry_json AS geometryJson FROM map_shapes ORDER BY layer,region_id,id").all() as Record<string, unknown>[]).map((row): MapShape => {
    let geometry: unknown;
    try { geometry = JSON.parse(String(row.geometryJson)); } catch { throw corrupt("A map shape contains invalid JSON."); }
    return { id: String(row.id), layer: String(row.layer) as MapShape["layer"], ...(row.regionId === null || row.regionId === undefined ? {} : { regionId: String(row.regionId) }), value: String(row.value), geometryVersion: Number(row.geometryVersion), snapGridVersion: Number(row.snapGridVersion), geometry: geometry as MapShape["geometry"] };
  });
  try { validateMapShapes(mapShapes); } catch { throw corrupt("A map shape is invalid or overlaps another shape."); }
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
