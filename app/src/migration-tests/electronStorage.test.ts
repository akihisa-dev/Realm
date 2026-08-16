// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RealmCommands } from "../main/commands/realmCommands";
import { preflightExistingProject, sourceIdentity } from "../main/storage/path";
import { copySqliteSnapshot } from "../main/storage/atomic";
import { AtomicPublisher } from "../main/storage/atomic";
import { assertSqlitePathNotMoved, loadHasMovedExtension } from "../main/storage/schema";
import { CURRENT_SCHEMA_VERSION } from "../main/storage/schema";
import { openProject as openStoredProject } from "../main/storage/project";
import { cellIdsToPolygonGeometries } from "../shared/mapShapeGeometry";
import { mapShapesFromLayers } from "../shared/layerProjection";
import type { MapObject } from "../shared/realmContract";

const fixtureDirectory = (): string => mkdtempSync(join(tmpdir(), "realm-electron-"));
const legacyFeatureTypes = "'terrain','forest','river','coastline','country','region','boundary','city','town','road','lake','mountain','tree','symbol','label','overlay','frame','scale'";
const legacySettingsCheck = "CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768 AND json_type(settings_json, '$.canvasWidth') = 'integer' AND json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.canvasHeight') = 'integer' AND json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.gridKind') = 'text' AND json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex') AND json_type(settings_json, '$.gridColor') = 'text' AND length(json_extract(settings_json, '$.gridColor')) = 7 AND json_extract(settings_json, '$.gridColor') GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]' AND (json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real') AND CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4 AND (json_type(settings_json, '$.gridSpacing') = 'integer' OR json_type(settings_json, '$.gridSpacing') = 'real') AND CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45 AND json_type(settings_json, '$.themeOverrides') = 'object')";
function createLegacyFixture(db: DatabaseSync, version: number, settings?: string): void {
  const world = version >= 6 ? `CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,settings_json TEXT NOT NULL ${version >= 7 ? legacySettingsCheck : "CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768)"});` : "CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL);";
  const feature = `CREATE TABLE features(id TEXT PRIMARY KEY NOT NULL,feature_type TEXT NOT NULL CHECK (feature_type IN (${version === 3 ? "'terrain','forest','river','coastline','country','region','boundary','city','town'" : legacyFeatureTypes})),name TEXT NOT NULL,geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json))${version >= 4 ? ",properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')" : ""});`;
  const layers = version >= 8 ? "'terrain','forest','country','region'" : "'forest','country','region'";
  const cells = `CREATE TABLE cell_attributes(id INTEGER PRIMARY KEY AUTOINCREMENT,grid_version INTEGER NOT NULL CHECK (grid_version = 1),cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),layer TEXT NOT NULL CHECK (layer IN (${layers})),value TEXT NOT NULL,UNIQUE (grid_version,cell_x,cell_y,layer));CREATE INDEX cell_attributes_lookup ON cell_attributes(grid_version,cell_x,cell_y,layer);`;
  const assets = version >= 5 ? "CREATE TABLE assets(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),mime TEXT NOT NULL,bytes BLOB NOT NULL,width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'));CREATE INDEX assets_sha256_lookup ON assets(sha256);" : "";
  const defaultSettings = version === 6 ? '{"themeId":"ink","showGrid":true,"exportScale":1,"exportExtent":"world"}' : '{"themeId":"ink","showGrid":true,"exportScale":1,"exportExtent":"world","canvasWidth":2048,"canvasHeight":1024,"gridKind":"graticule","gridColor":"#687784","gridWidth":1,"gridSpacing":10,"themeOverrides":{}}';
  const worldValues = version >= 6 ? `,'${(settings ?? defaultSettings).replace(/'/g, "''")}'` : "";
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);${world}${feature}CREATE TABLE cell_grid(id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),grid_version INTEGER NOT NULL CHECK (grid_version = 1),grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),grid_rows INTEGER NOT NULL CHECK (grid_rows = 256));${cells}${assets}INSERT INTO schema_migrations(version) VALUES (${version});PRAGMA user_version=${version};INSERT INTO world(id,name${version >= 6 ? ",settings_json" : ""}) VALUES ('world','Legacy'${worldValues});INSERT INTO features(id,feature_type,name,geometry_json${version >= 4 ? ",properties_json" : ""}) VALUES ('feature','city','A','{"type":"Point","coordinates":[1,2]}'${version >= 4 ? ",'{}'" : ""});INSERT INTO cell_grid VALUES (1,1,512,256);INSERT INTO cell_attributes(grid_version,cell_x,cell_y,layer,value) VALUES (1,1,1,'forest','trees');`);
}

describe("Electron native SQLite storage", () => {
  it("creates, mutates, reopens and restores one undoable current-state transaction", async () => {
    const directory = fixtureDirectory(); const commands = new RealmCommands({ libraryDirectory: directory });
    let snapshot = await commands.createProject({ name: "Synthetic" });
    expect(snapshot.formatVersion).toBe(CURRENT_SCHEMA_VERSION);
    const objects: MapObject[] = [
      { id: "22222222-2222-4222-8222-222222222222", kind: "city", label: "A", geometry: { type: "Point", coordinates: [1, 2] }, properties: {}, zIndex: 0, locked: false },
      { id: "33333333-3333-4333-8333-333333333333", kind: "text", label: "B", geometry: { type: "Point", coordinates: [2, 3] }, properties: {}, zIndex: 1, locked: false },
    ];
    snapshot = await commands.replaceObjectLayer({ objects });
    expect(snapshot.layers.objects).toHaveLength(2); expect(snapshot.canUndo).toBe(true);
    snapshot = await commands.undoProject(); expect(snapshot.layers.objects).toHaveLength(0); expect(snapshot.canRedo).toBe(true);
    snapshot = await commands.redoProject(); expect(snapshot.layers.objects).toHaveLength(2);
    snapshot = await commands.replaceTerrainLayer({ shapes: [{ id: "11111111-1111-4111-8111-111111111111", geometry: cellIdsToPolygonGeometries(["0:0", "1:0"])[0]! }] });
    const path = snapshot.path; const libraryId = basename(path, ".realmmap"); await commands.closeProject();
    const stored = new DatabaseSync(path, { readOnly: true });
    try {
      expect(Number((stored.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('terrain_shapes','regions','region_shapes','objects')").get() as { count: number }).count)).toBe(4);
      expect(Number((stored.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('features','map_shapes','cell_grid','cell_attributes')").get() as { count: number }).count)).toBe(0);
      expect(Number((stored.prepare("SELECT COUNT(*) AS count FROM terrain_shapes").get() as { count: number }).count)).toBe(1);
      const shape = stored.prepare("SELECT id,geometry_json AS geometryJson FROM terrain_shapes").get() as Record<string, unknown>;
      expect(shape.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(JSON.parse(String(shape.geometryJson))).toMatchObject({ type: "Polygon" });
      expect(Number((stored.prepare("SELECT COUNT(*) AS count FROM objects").get() as { count: number }).count)).toBe(2);
    } finally { stored.close(); }
    snapshot = await commands.openProject({ libraryId }); expect(snapshot.layers.objects).toHaveLength(2); expect(snapshot.layers.terrain).toHaveLength(1); expect(mapShapesFromLayers(snapshot.layers)).toHaveLength(1); expect(snapshot.canUndo).toBe(false);
  });

  it("copies a WAL snapshot without changing source identity", async () => {
    const directory = fixtureDirectory(); const destinationPath = join(directory, "destination.realmmap");
    const commands = new RealmCommands({ libraryDirectory: directory }); await commands.createProject({ name: "Wal" }); const source = (await commands.getOpenProject())!; await commands.closeProject();
    const db = new DatabaseSync(source.path, { timeout: 5000 }); db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS wal_marker(value TEXT); BEGIN; INSERT INTO wal_marker(value) VALUES ('committed-wal'); COMMIT;");
    const before = sourceIdentity(source.path); const validated = preflightExistingProject(source.path); try { await copySqliteSnapshot(validated, destinationPath); } finally { validated.close(); }
    const after = sourceIdentity(source.path); expect(after.main.digest).toBe(before.main.digest); expect(after.sidecars["-wal"]?.digest).toBe(before.sidecars["-wal"]?.digest);
    const copy = new DatabaseSync(destinationPath, { readOnly: true }); expect(copy.prepare("SELECT value FROM wal_marker").get()).toEqual({ value: "committed-wal" }); copy.close(); db.close();
  });

  it("rejects symlinks and no-replace exports", async () => {
    const directory = fixtureDirectory(); const commands = new RealmCommands({ libraryDirectory: directory }); const snapshot = await commands.createProject({ name: "Paths" }); await commands.closeProject();
    const link = join(directory, "link.realmmap"); symlinkSync(snapshot.path, link); await expect(Promise.resolve().then(() => openStoredProject(link))).rejects.toMatchObject({ code: "invalid_path" });
    await commands.openProject({ libraryId: basename(snapshot.path, ".realmmap") }); const existing = join(directory, "existing.realmmap"); writeFileSync(existing, "sentinel"); await expect(commands.exportProject({ path: existing })).rejects.toMatchObject({ code: "already_exists" });
  });

  it("rejects a synthetic v3 database and rejects future schema without mutation", async () => {
    const directory = fixtureDirectory(); const path = join(directory, "v3.realmmap"); const db = new DatabaseSync(path); createLegacyFixture(db, 3); db.close();
    const bytes = readFileSync(path); await expect(Promise.resolve().then(() => openStoredProject(path))).rejects.toMatchObject({ code: "unsupported_schema" }); expect(readFileSync(path)).toEqual(bytes);
    const futurePath = join(directory, "future.realmmap"); const future = new DatabaseSync(futurePath); future.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO schema_migrations(version) VALUES (99); PRAGMA user_version=99;"); future.close(); const futureBytes = readFileSync(futurePath); await expect(Promise.resolve().then(() => openStoredProject(futurePath))).rejects.toMatchObject({ code: "future_schema" }); expect(readFileSync(futurePath)).toEqual(futureBytes);
  });

  it.each([4, 5, 6, 7])( "rejects each synthetic v%d source without mutation", async (version) => {
    const directory = fixtureDirectory(); const path = join(directory, `v${version}.realmmap`); const db = new DatabaseSync(path); createLegacyFixture(db, version); db.close();
    const before = readFileSync(path); await expect(Promise.resolve().then(() => openStoredProject(path))).rejects.toMatchObject({ code: "unsupported_schema" }); expect(readFileSync(path)).toEqual(before);
  });

  it("rejects a v8 cell-attribute source without exposing compatibility rows", async () => {
    const directory = fixtureDirectory(); const path = join(directory, "v8.realmmap"); const db = new DatabaseSync(path); createLegacyFixture(db, 8);
    db.prepare("INSERT INTO cell_attributes(grid_version,cell_x,cell_y,layer,value) VALUES (1,10,10,'terrain','terrain'),(1,10,10,'region','#336699'),(1,11,10,'region','#336699'),(1,80,80,'region','#336699'),(1,200,100,'region','#FF0000')").run(); db.close();
    const before = readFileSync(path); await expect(Promise.resolve().then(() => openStoredProject(path))).rejects.toMatchObject({ code: "unsupported_schema" }); expect(readFileSync(path)).toEqual(before);
  });

  it("rejects a malformed v6 source while preserving source bytes", async () => {
    const directory = fixtureDirectory(); const path = join(directory, "bad-v6.realmmap"); const db = new DatabaseSync(path); db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,settings_json TEXT NOT NULL); CREATE TABLE features(id TEXT PRIMARY KEY NOT NULL,feature_type TEXT NOT NULL,name TEXT NOT NULL,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL); CREATE TABLE cell_grid(id INTEGER PRIMARY KEY NOT NULL,grid_version INTEGER NOT NULL,grid_columns INTEGER NOT NULL,grid_rows INTEGER NOT NULL); CREATE TABLE cell_attributes(id INTEGER PRIMARY KEY AUTOINCREMENT,grid_version INTEGER NOT NULL,cell_x INTEGER NOT NULL,cell_y INTEGER NOT NULL,layer TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE assets(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),mime TEXT NOT NULL,bytes BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,metadata_json TEXT NOT NULL); CREATE INDEX assets_sha256_lookup ON assets(sha256); INSERT INTO schema_migrations(version) VALUES (6); PRAGMA user_version=6; INSERT INTO world VALUES ('world','Bad','{\"themeId\":\"bad\"}'); INSERT INTO cell_grid VALUES(1,1,512,256);"); db.close(); const before = readFileSync(path); await expect(Promise.resolve().then(() => openStoredProject(path))).rejects.toMatchObject({ code: "unsupported_schema" }); expect(readFileSync(path)).toEqual(before);
  });

  it("rejects corrupt, partial, and retired schemas before touching source bytes", async () => {
    const directory = fixtureDirectory();
    const corruptPath = join(directory, "corrupt.realmmap"); writeFileSync(corruptPath, "not sqlite"); const corruptBytes = readFileSync(corruptPath); await expect(Promise.resolve().then(() => openStoredProject(corruptPath))).rejects.toMatchObject({ code: "corrupt_project" }); expect(readFileSync(corruptPath)).toEqual(corruptBytes);
    const partialPath = join(directory, "partial.realmmap"); const partial = new DatabaseSync(partialPath); partial.exec("CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL); PRAGMA user_version=8;"); partial.close(); const partialBytes = readFileSync(partialPath); await expect(Promise.resolve().then(() => openStoredProject(partialPath))).rejects.toMatchObject({ code: "corrupt_project" }); expect(readFileSync(partialPath)).toEqual(partialBytes);
    const retiredPath = join(directory, "retired.realmmap"); const retired = new DatabaseSync(retiredPath); retired.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,settings_json TEXT NOT NULL); CREATE TABLE features(id TEXT PRIMARY KEY NOT NULL,feature_type TEXT NOT NULL,name TEXT NOT NULL,geometry_json TEXT NOT NULL,properties_json TEXT NOT NULL); CREATE TABLE cell_grid(id INTEGER PRIMARY KEY NOT NULL,grid_version INTEGER NOT NULL,grid_columns INTEGER NOT NULL,grid_rows INTEGER NOT NULL); CREATE TABLE cell_attributes(id INTEGER PRIMARY KEY AUTOINCREMENT,grid_version INTEGER NOT NULL,cell_x INTEGER NOT NULL,cell_y INTEGER NOT NULL,layer TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE assets(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,metadata_json TEXT NOT NULL); CREATE TABLE eras(id INTEGER); INSERT INTO schema_migrations(version) VALUES(8); PRAGMA user_version=8; INSERT INTO world VALUES('world','Retired','{\"themeId\":\"ink\",\"showGrid\":true,\"exportScale\":1,\"exportExtent\":\"world\",\"canvasWidth\":2048,\"canvasHeight\":1024,\"gridKind\":\"graticule\",\"gridColor\":\"#687784\",\"gridWidth\":1,\"gridSpacing\":10,\"themeOverrides\":{}}'); INSERT INTO cell_grid VALUES(1,1,512,256);"); retired.close(); const retiredBytes = readFileSync(retiredPath); await expect(Promise.resolve().then(() => openStoredProject(retiredPath))).rejects.toMatchObject({ code: "unsupported_schema" }); expect(readFileSync(retiredPath)).toEqual(retiredBytes);
  });

  it("retains a published destination on parent sync failure and never deletes a foreign staging replacement", () => {
    const directory = fixtureDirectory(); const destination = join(directory, "published.realmmap"); const publisher = new AtomicPublisher(destination, "test"); writeFileSync(publisher.staging, "bytes"); expect(() => publisher.publishWithParentSyncForTest(() => { throw new Error("fsync"); })).toThrow(); expect(readFileSync(destination, "utf8")).toBe("bytes");
    const second = new AtomicPublisher(join(directory, "foreign.realmmap"), "foreign"); writeFileSync(second.staging, "foreign"); const replacement = second.staging + ".replacement"; renameSync(second.staging, replacement); writeFileSync(second.staging, "foreign-replacement"); second.dispose(); expect(readFileSync(second.staging, "utf8")).toBe("foreign-replacement");
  });

  it("fails closed through SQLite HAS_MOVED file-control after foreign replacement", () => {
    const directory = fixtureDirectory(); const path = join(directory, "moved.realmmap"); const oldPath = path + ".old"; const db = new DatabaseSync(path, { allowExtension: true }); db.exec("CREATE TABLE marker(value TEXT)"); loadHasMovedExtension(db); expect(() => assertSqlitePathNotMoved(db)).not.toThrow(); renameSync(path, oldPath); writeFileSync(path, "foreign"); expect(() => assertSqlitePathNotMoved(db)).toThrow(); db.close(); unlinkSync(oldPath); unlinkSync(path);
  });
});
