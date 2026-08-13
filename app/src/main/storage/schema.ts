import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { corrupt, RealmError } from "../domain/errors";
import { DEFAULT_SETTINGS, parseStoredSettings, validateSettings } from "../domain/settings";

export const CURRENT_SCHEMA_VERSION = 9;
export const ACCEPTED_SCHEMA_VERSIONS = [3, 4, 5, 6, 7, 8, 9] as const;
export const GRID_VERSION = 2;
const ACTIVE_GRID_COLUMNS = 128;
const ACTIVE_GRID_ROWS = 73;
const FEATURE_TYPES = "'terrain','forest','river','coastline','country','region','boundary','city','town','road','lake','mountain','tree','symbol','label','overlay','frame','scale'";
const SETTINGS_CHECK = `CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768 AND json_type(settings_json, '$.canvasWidth') = 'integer' AND json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.canvasHeight') = 'integer' AND json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.gridKind') = 'text' AND json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex') AND json_type(settings_json, '$.gridColor') = 'text' AND length(json_extract(settings_json, '$.gridColor')) = 7 AND json_extract(settings_json, '$.gridColor') GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]' AND (json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real') AND CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4 AND (json_type(settings_json, '$.gridSpacing') = 'integer' OR json_type(settings_json, '$.gridSpacing') = 'real') AND CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45 AND json_type(settings_json, '$.themeOverrides') = 'object')`;

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
  loadHasMovedExtension(db); assertSqlitePathNotMoved(db); db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"); assertSqlitePathNotMoved(db);
}

/** New staged databases must start in rollback-journal mode. Existing sources
 * are inspected on a private snapshot and are never switched during preflight. */
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
CREATE TABLE IF NOT EXISTS cell_attributes (id INTEGER PRIMARY KEY AUTOINCREMENT, grid_version INTEGER NOT NULL CHECK (grid_version IN (1,2)), cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512), cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256), layer TEXT NOT NULL CHECK (layer IN ('terrain','forest','country','region')), value TEXT NOT NULL, UNIQUE (grid_version, cell_x, cell_y, layer));
CREATE INDEX IF NOT EXISTS cell_attributes_lookup ON cell_attributes(grid_version, cell_x, cell_y, layer);
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
const WORLD_COLUMNS_V5 = [column("id", "TEXT", true, true), column("name", "TEXT", true, false)];
const WORLD_COLUMNS = [...WORLD_COLUMNS_V5, column("settings_json", "TEXT", true, false)];
const FEATURE_COLUMNS_V3 = [column("id", "TEXT", true, true), column("feature_type", "TEXT", true, false), column("name", "TEXT", true, false), column("geometry_json", "TEXT", true, false)];
const FEATURE_COLUMNS = [...FEATURE_COLUMNS_V3, column("properties_json", "TEXT", true, false)];
const CELL_GRID_COLUMNS = [column("id", "INTEGER", true, true), column("grid_version", "INTEGER", true, false), column("grid_columns", "INTEGER", true, false), column("grid_rows", "INTEGER", true, false)];
const CELL_ATTRIBUTE_COLUMNS = [column("id", "INTEGER", false, true), column("grid_version", "INTEGER", true, false), column("cell_x", "INTEGER", true, false), column("cell_y", "INTEGER", true, false), column("layer", "TEXT", true, false), column("value", "TEXT", true, false)];
const ASSET_COLUMNS = [column("id", "TEXT", true, true), column("sha256", "TEXT", true, false), column("mime", "TEXT", true, false), column("bytes", "BLOB", true, false), column("width", "INTEGER", true, false), column("height", "INTEGER", true, false), column("metadata_json", "TEXT", true, false)];
const FULL_SETTINGS_FRAGMENTS = ["check (json_valid(settings_json)", "json_type(settings_json) = 'object'", "length(settings_json) <= 32768", "json_type(settings_json, '$.canvasWidth') = 'integer'", "json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192", "json_type(settings_json, '$.canvasHeight') = 'integer'", "json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192", "json_type(settings_json, '$.gridKind') = 'text'", "json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex')", "json_type(settings_json, '$.gridColor') = 'text'", "length(json_extract(settings_json, '$.gridColor')) = 7", "json_extract(settings_json, '$.gridColor') GLOB", "(json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real')", "CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4", "(json_type(settings_json, '$.gridSpacing') = 'integer' OR json_type(settings_json, '$.gridSpacing') = 'real')", "CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45", "json_type(settings_json, '$.themeOverrides') = 'object'"];
function tableInfo(db: DatabaseSync, table: string): ColumnExpectation[] { return db.prepare(`PRAGMA table_info(${table})`).all().map((raw) => { const row = raw as Record<string, unknown>; return { name: String(row.name), declaredType: String(row.type), notNull: Number(row.notnull) !== 0, primaryKey: Number(row.pk) !== 0 }; }); }
function hasColumns(db: DatabaseSync, table: string, expected: ColumnExpectation[]): boolean { const found = tableInfo(db, table); return found.length === expected.length && expected.every((want, index) => { const got = found[index]; return got?.name === want.name && got.declaredType.toUpperCase() === want.declaredType && got.notNull === want.notNull && got.primaryKey === want.primaryKey; }); }
function normalizedSql(db: DatabaseSync, objectType: string, name: string): string { const row = db.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").get(objectType, name) as { sql?: unknown } | undefined; return String(row?.sql ?? "").replace(/\s+/g, " ").trim().toLowerCase(); }
function indexColumns(db: DatabaseSync, name: string): string[] { return db.prepare(`PRAGMA index_info(${name})`).all().map((raw) => String((raw as Record<string, unknown>).name)); }
function assertIndex(db: DatabaseSync, name: string, expected: string[]): void { if (!indexColumns(db, name).every((value, index) => value === expected[index]) || indexColumns(db, name).length !== expected.length) throw corrupt(); }
function assertTableSql(db: DatabaseSync, table: string, fragments: readonly string[]): void { const sql = normalizedSql(db, "table", table).replace(/\s+/g, ""); if (!sql || fragments.some((fragment) => !sql.includes(fragment.toLowerCase().replace(/\s+/g, "")))) throw corrupt(); }
function rowCount(db: DatabaseSync, table: string): number { return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
function verifyAssetsSchema(db: DatabaseSync): void {
  assertTableSql(db, "assets", ["unique", "check (length(sha256) = 64)", "check (width > 0", "check (height > 0", "check (json_valid(metadata_json)", "json_type(metadata_json) = 'object'"]);
  assertIndex(db, "assets_sha256_lookup", ["sha256"]);
}

export function schemaVersion(db: DatabaseSync): number {
  const integrity = String((db.prepare("PRAGMA quick_check(1)").get() as Record<string, unknown> | undefined)?.quick_check ?? "");
  if (integrity.toLowerCase() !== "ok") throw corrupt("The project file is corrupt or not a Realm project.");
  const user = Number(readPragma(db, "user_version") ?? 0);
  if (!tableExists(db, "schema_migrations")) throw corrupt("The project file does not contain a Realm schema.");
  const recorded = (db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number }).version;
  if (!recorded || user !== Number(recorded)) throw corrupt("The project schema versions do not agree.");
  if (user > CURRENT_SCHEMA_VERSION || Number(recorded) > CURRENT_SCHEMA_VERSION) throw new RealmError("future_schema", "This project was created by a newer version of Realm.");
  if (!(ACCEPTED_SCHEMA_VERSIONS as readonly number[]).includes(user)) throw new RealmError("unsupported_schema", "This project uses a legacy Realm format that is no longer supported.");
  return user;
}

function verifyLegacy(db: DatabaseSync, version: number): void {
  const worldColumns = version >= 6 ? WORLD_COLUMNS : WORLD_COLUMNS_V5;
  const featureColumns = version >= 4 ? FEATURE_COLUMNS : FEATURE_COLUMNS_V3;
  if (!tableExists(db, "world") || !tableExists(db, "features") || !tableExists(db, "cell_grid") || !tableExists(db, "cell_attributes") || !hasColumns(db, "schema_migrations", SCHEMA_MIGRATION_COLUMNS) || !hasColumns(db, "world", worldColumns) || !hasColumns(db, "features", featureColumns) || !hasColumns(db, "cell_grid", CELL_GRID_COLUMNS) || !hasColumns(db, "cell_attributes", CELL_ATTRIBUTE_COLUMNS)) throw corrupt();
  if (rowCount(db, "world") !== 1 || rowCount(db, "cell_grid") !== 1) throw corrupt("The project must contain exactly one world record and one grid record.");
  assertTableSql(db, "features", ["check (json_valid(geometry_json)", ...((version >= 4) ? ["check (json_valid(properties_json)", "json_type(properties_json) = 'object'"] : [])]);
  const featureTypes = version === 3
    ? ["'terrain'", "'forest'", "'river'", "'coastline'", "'country'", "'region'", "'boundary'", "'city'", "'town'"]
    : ["'terrain'", "'forest'", "'river'", "'coastline'", "'country'", "'region'", "'boundary'", "'city'", "'town'", "'road'", "'lake'", "'mountain'", "'tree'", "'symbol'", "'label'", "'overlay'", "'frame'", "'scale'"];
  assertTableSql(db, "features", featureTypes);
  assertTableSql(db, "cell_grid", ["check (id = 1)", "check (grid_version = 1)", "check (grid_columns = 512)", "check (grid_rows = 256)"]);
  assertTableSql(db, "cell_attributes", ["unique (grid_version, cell_x, cell_y, layer)", "check (grid_version = 1)", "check (cell_x >= 0", "check (cell_y >= 0"]);
  const layers = version >= 8 ? ["'terrain'", "'forest'", "'country'", "'region'"] : ["'forest'", "'country'", "'region'"];
  assertTableSql(db, "cell_attributes", ["check (layer in (" + layers.join(",") + "))"]);
  assertIndex(db, "cell_attributes_lookup", ["grid_version", "cell_x", "cell_y", "layer"]);
  const hasAssets = version >= 5;
  if (hasAssets) { if (!tableExists(db, "assets") || !hasColumns(db, "assets", ASSET_COLUMNS)) throw corrupt(); verifyAssetsSchema(db); } else if (tableExists(db, "assets") || tableExists(db, "assets_sha256_lookup")) throw corrupt();
  if (version >= 6) {
    const row = db.prepare("SELECT settings_json AS value FROM world LIMIT 1").get() as { value: string };
    try { JSON.parse(row.value); } catch { throw corrupt("Project settings are invalid."); }
    assertTableSql(db, "world", ["check (json_valid(settings_json)", "json_type(settings_json) = 'object'", "length(settings_json) <= 32768"]);
    if (version >= 7) assertTableSql(db, "world", FULL_SETTINGS_FRAGMENTS);
  }
  for (const retired of ["eras", "timeline_events", "feature_revisions", "cell_edit_operations", "cell_attribute_revisions", "feature_revisions_lookup", "feature_revisions_year", "timeline_events_range", "cell_attribute_revisions_lookup", "cell_attribute_revisions_view", "feature_revision_sequence_monotonic", "feature_revision_no_update", "feature_revision_no_delete", "cell_attribute_revision_sequence_monotonic", "cell_attribute_revision_no_update", "cell_attribute_revision_no_delete", "cell_edit_operation_no_update", "cell_edit_operation_no_delete"]) if (tableExists(db, retired) || Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('index','trigger') AND name=?) AS value").get(retired) as { value: number }).value)) throw corrupt("Chronology tables are not supported.");
}

export function verifyCurrentSchema(db: DatabaseSync): void {
  if (!hasColumns(db, "schema_migrations", SCHEMA_MIGRATION_COLUMNS) || !hasColumns(db, "world", WORLD_COLUMNS) || !hasColumns(db, "features", FEATURE_COLUMNS) || !hasColumns(db, "cell_grid", CELL_GRID_COLUMNS) || !hasColumns(db, "cell_attributes", CELL_ATTRIBUTE_COLUMNS) || !hasColumns(db, "assets", ASSET_COLUMNS)) throw corrupt();
  if (rowCount(db, "world") !== 1 || rowCount(db, "cell_grid") !== 1) throw corrupt("The project must contain exactly one world record and one grid record.");
  assertTableSql(db, "world", FULL_SETTINGS_FRAGMENTS);
  assertTableSql(db, "features", ["check (json_valid(geometry_json)", "check (json_valid(properties_json)", "json_type(properties_json) = 'object'", "'terrain'", "'forest'", "'river'", "'coastline'", "'country'", "'region'", "'boundary'", "'city'", "'town'", "'road'", "'lake'", "'mountain'", "'tree'", "'symbol'", "'label'", "'overlay'", "'frame'", "'scale'"]);
  assertTableSql(db, "cell_grid", ["check (id = 1)", "check (grid_version = 2)", "check (grid_columns = 128)", "check (grid_rows = 73)"]);
  assertTableSql(db, "cell_attributes", ["unique (grid_version, cell_x, cell_y, layer)", "check (grid_version in (1,2))", "check (cell_x >= 0", "check (cell_y >= 0", "check (layer in ('terrain','forest','country','region'))"]);
  assertIndex(db, "cell_attributes_lookup", ["grid_version", "cell_x", "cell_y", "layer"]);
  verifyAssetsSchema(db);
  for (const retired of ["eras", "timeline_events", "feature_revisions", "cell_edit_operations", "cell_attribute_revisions", "feature_revisions_lookup", "feature_revisions_year", "timeline_events_range", "cell_attribute_revisions_lookup", "cell_attribute_revisions_view", "feature_revision_sequence_monotonic", "feature_revision_no_update", "feature_revision_no_delete", "cell_attribute_revision_sequence_monotonic", "cell_attribute_revision_no_update", "cell_attribute_revision_no_delete", "cell_edit_operation_no_update", "cell_edit_operation_no_delete"]) if (tableExists(db, retired) || Boolean((db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('index','trigger') AND name=?) AS value").get(retired) as { value: number }).value)) throw corrupt("Chronology tables are not supported.");
  const settings = (db.prepare("SELECT settings_json AS value FROM world LIMIT 1").get() as { value: string }).value;
  parseStoredSettings(settings);
  const featureRows = db.prepare("SELECT feature_type, geometry_json, properties_json FROM features").all() as Record<string, unknown>[];
  for (const row of featureRows) { if (!FEATURE_TYPES.includes(`'${String(row.feature_type)}'`)) throw corrupt("A feature class is invalid."); try { JSON.parse(String(row.geometry_json)); JSON.parse(String(row.properties_json)); } catch { throw corrupt("A feature contains invalid JSON."); } }
}

export function preflightSchema(db: DatabaseSync): number { const version = schemaVersion(db); if (version === CURRENT_SCHEMA_VERSION) verifyCurrentSchema(db); else verifyLegacy(db, version); return version; }

function renameRebuildFeatures(db: DatabaseSync): void {
  db.exec(`ALTER TABLE features RENAME TO features_legacy; CREATE TABLE features (id TEXT PRIMARY KEY NOT NULL, feature_type TEXT NOT NULL CHECK (feature_type IN (${FEATURE_TYPES})), name TEXT NOT NULL, geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)), properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object'));`);
  db.exec("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) SELECT id,feature_type,name,geometry_json, '{}' FROM features_legacy;"); db.exec("DROP TABLE features_legacy;");
}
function rebuildWorld(db: DatabaseSync, withSettings: boolean): void {
  const rows = withSettings ? db.prepare("SELECT id,name,settings_json FROM world").all() as Record<string, unknown>[] : db.prepare("SELECT id,name FROM world").all() as Record<string, unknown>[];
  db.exec(`ALTER TABLE world RENAME TO world_legacy; CREATE TABLE world (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, settings_json TEXT NOT NULL ${SETTINGS_CHECK});`);
  const insert = db.prepare("INSERT INTO world(id,name,settings_json) VALUES (?,?,?)");
  for (const row of rows) {
    let settings = DEFAULT_SETTINGS;
    if (withSettings) {
      const raw = String(row.settings_json);
      let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw corrupt("Project settings are invalid."); }
      const merged = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
      settings = validateSettings(merged);
    }
    insert.run(String(row.id), String(row.name), JSON.stringify(settings));
  }
  db.exec("DROP TABLE world_legacy;");
}
function rebuildCells(db: DatabaseSync): void {
  db.exec("ALTER TABLE cell_attributes RENAME TO cell_attributes_legacy; DROP INDEX IF EXISTS cell_attributes_lookup;");
  db.exec("CREATE TABLE cell_attributes (id INTEGER PRIMARY KEY AUTOINCREMENT, grid_version INTEGER NOT NULL CHECK (grid_version = 1), cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512), cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256), layer TEXT NOT NULL CHECK (layer IN ('terrain','forest','country','region')), value TEXT NOT NULL, UNIQUE (grid_version,cell_x,cell_y,layer));");
  db.exec("INSERT INTO cell_attributes(id,grid_version,cell_x,cell_y,layer,value) SELECT id,grid_version,cell_x,cell_y,layer,value FROM cell_attributes_legacy;"); db.exec("DROP TABLE cell_attributes_legacy; CREATE INDEX cell_attributes_lookup ON cell_attributes(grid_version,cell_x,cell_y,layer);");
}

/** Preserves every v1 row and derives the active v2 terrain/region cells by nearest old hex centre. */
function migrateFineGrid(db: DatabaseSync): void {
  const active = db.prepare("SELECT cell_x AS x,cell_y AS y,layer,value FROM cell_attributes WHERE grid_version=1 AND cell_x<64 AND cell_y<37 AND layer IN ('terrain','region')").all() as Record<string, unknown>[];
  const values = new Map(active.map((row) => [`${Number(row.x)}:${Number(row.y)}:${String(row.layer)}`, String(row.value)]));
  db.exec("ALTER TABLE cell_attributes RENAME TO cell_attributes_v1; DROP INDEX IF EXISTS cell_attributes_lookup;");
  db.exec("CREATE TABLE cell_attributes (id INTEGER PRIMARY KEY AUTOINCREMENT, grid_version INTEGER NOT NULL CHECK (grid_version IN (1,2)), cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512), cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256), layer TEXT NOT NULL CHECK (layer IN ('terrain','forest','country','region')), value TEXT NOT NULL, UNIQUE (grid_version,cell_x,cell_y,layer));");
  db.exec("INSERT INTO cell_attributes(id,grid_version,cell_x,cell_y,layer,value) SELECT id,grid_version,cell_x,cell_y,layer,value FROM cell_attributes_v1; DROP TABLE cell_attributes_v1; CREATE INDEX cell_attributes_lookup ON cell_attributes(grid_version,cell_x,cell_y,layer);");
  const centre = (row: number, column: number, rows: number): [number, number] => { const radius = 180 / (1.5 * rows + 0.5); const step = Math.sqrt(3) * radius; return [-180 + step / 2 + (column + (row % 2 === 0 ? 0 : 0.5)) * step, -90 + radius + row * 1.5 * radius]; };
  const insert = db.prepare("INSERT OR IGNORE INTO cell_attributes(grid_version,cell_x,cell_y,layer,value) VALUES (2,?,?,?,?)");
  for (let y = 0; y < ACTIVE_GRID_ROWS; y += 1) for (let x = 0; x < ACTIVE_GRID_COLUMNS; x += 1) {
    const [longitude, latitude] = centre(y, x, ACTIVE_GRID_ROWS);
    let nearestX = 0; let nearestY = 0; let nearestDistance = Number.POSITIVE_INFINITY;
    const oldRadius = 180 / (1.5 * 37 + 0.5); const estimatedRow = Math.round((latitude - (-90 + oldRadius)) / (1.5 * oldRadius));
    for (let oldY = Math.max(0, estimatedRow - 2); oldY <= Math.min(36, estimatedRow + 2); oldY += 1) {
      const oldStep = Math.sqrt(3) * oldRadius; const estimatedColumn = Math.round((longitude - (-180 + oldStep / 2)) / oldStep - (oldY % 2 === 0 ? 0 : 0.5));
      for (let oldX = Math.max(0, estimatedColumn - 2); oldX <= Math.min(63, estimatedColumn + 2); oldX += 1) { const [cx, cy] = centre(oldY, oldX, 37); const distance = (longitude - cx) ** 2 + (latitude - cy) ** 2; if (distance < nearestDistance) { nearestDistance = distance; nearestX = oldX; nearestY = oldY; } }
    }
    for (const layer of ["terrain", "region"] as const) { const value = values.get(`${nearestX}:${nearestY}:${layer}`); if (value !== undefined) insert.run(x, y, layer, value); }
  }
  db.exec("ALTER TABLE cell_grid RENAME TO cell_grid_v1; CREATE TABLE cell_grid (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), grid_version INTEGER NOT NULL CHECK (grid_version = 2), grid_columns INTEGER NOT NULL CHECK (grid_columns = 128), grid_rows INTEGER NOT NULL CHECK (grid_rows = 73)); INSERT INTO cell_grid(id,grid_version,grid_columns,grid_rows) VALUES (1,2,128,73); DROP TABLE cell_grid_v1;");
}

export function migrateToCurrent(db: DatabaseSync, version: number): void {
  if (version === CURRENT_SCHEMA_VERSION) { verifyCurrentSchema(db); return; }
  verifyLegacy(db, version);
  transaction(db, () => {
    if (version === 3) { renameRebuildFeatures(db); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(4); db.exec("PRAGMA user_version=4"); version = 4; }
    if (version === 4) { db.exec("CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256)=64), mime TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL CHECK (width>0 AND width<=32768), height INTEGER NOT NULL CHECK (height>0 AND height<=32768), metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object')); CREATE INDEX assets_sha256_lookup ON assets(sha256);"); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(5); db.exec("PRAGMA user_version=5"); version = 5; }
    if (version === 5) { rebuildWorld(db, false); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(6); db.exec("PRAGMA user_version=6"); version = 6; }
    if (version === 6) { rebuildWorld(db, true); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(7); db.exec("PRAGMA user_version=7"); version = 7; }
    if (version === 7) { rebuildCells(db); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(8); db.exec("PRAGMA user_version=8"); version = 8; }
    if (version === 8) { migrateFineGrid(db); db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(9); db.exec("PRAGMA user_version=9"); }
    verifyCurrentSchema(db);
  });
}

export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  const databaseFile = String((db.prepare("PRAGMA database_list").all()[0] as Record<string, unknown> | undefined)?.file ?? "");
  const assertCurrentPath = (): void => { if (databaseFile !== "") assertSqlitePathNotMoved(db); };
  assertCurrentPath(); db.exec("BEGIN IMMEDIATE");
  try { assertCurrentPath(); const result = operation(); assertCurrentPath(); db.exec("COMMIT"); assertCurrentPath(); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch { /* preserve original */ } throw error; }
}
