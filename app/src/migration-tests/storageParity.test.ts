// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RealmCommands } from "../main/commands/realmCommands";
import { copySqliteSnapshot } from "../main/storage/atomic";
import { preflightExistingProject, sameIdentity, sourceIdentity } from "../main/storage/path";
import { openProject, openProjectAfterValidationForTest, createProject as createStoredProject } from "../main/storage/project";

const directories: string[] = [];
const fixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "realm-storage-parity-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const point = { type: "Point" as const, coordinates: [1, 2] as [number, number] };
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2];
const featureInput = { featureType: "city" as const, name: "Synthetic city", geometry: point, properties: { source: "parity" } };

function privateSnapshots(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.startsWith(".realm-source-") || name.includes("parity"));
}

function replaceLibraryDirectory(directory: string): void {
  const moved = `${directory}.moved`;
  renameSync(directory, moved);
  mkdirSync(directory);
  writeFileSync(join(directory, "foreign.marker"), "foreign");
  directories.push(moved);
}

function createLegacyFixture(path: string, version: number, settings?: string): void {
  const world = version >= 6
    ? `CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,settings_json TEXT NOT NULL ${version >= 7
      ? "CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768 AND json_type(settings_json, '$.canvasWidth') = 'integer' AND json_extract(settings_json, '$.canvasWidth') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.canvasHeight') = 'integer' AND json_extract(settings_json, '$.canvasHeight') BETWEEN 512 AND 8192 AND json_type(settings_json, '$.gridKind') = 'text' AND json_extract(settings_json, '$.gridKind') IN ('graticule','square','hex') AND json_type(settings_json, '$.gridColor') = 'text' AND length(json_extract(settings_json, '$.gridColor')) = 7 AND json_extract(settings_json, '$.gridColor') GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]' AND (json_type(settings_json, '$.gridWidth') = 'integer' OR json_type(settings_json, '$.gridWidth') = 'real') AND CAST(json_extract(settings_json, '$.gridWidth') AS REAL) BETWEEN 0.25 AND 4 AND (json_type(settings_json, '$.gridSpacing') = 'integer' OR json_type(settings_json, '$.gridSpacing') = 'real') AND CAST(json_extract(settings_json, '$.gridSpacing') AS REAL) BETWEEN 2 AND 45 AND json_type(settings_json, '$.themeOverrides') = 'object')"
      : "CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object' AND length(settings_json) <= 32768)"});`
    : "CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL);";
  const featureTypes = version === 3
    ? "'terrain','forest','river','coastline','country','region','boundary','city','town'"
    : "'terrain','forest','river','coastline','country','region','boundary','city','town','road','lake','mountain','tree','symbol','label','overlay','frame','scale'";
  const feature = `CREATE TABLE features(id TEXT PRIMARY KEY NOT NULL,feature_type TEXT NOT NULL CHECK (feature_type IN (${featureTypes})),name TEXT NOT NULL,geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json))${version >= 4 ? ",properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')" : ""});`;
  const cells = "CREATE TABLE cell_grid(id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),grid_version INTEGER NOT NULL CHECK (grid_version = 1),grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),grid_rows INTEGER NOT NULL CHECK (grid_rows = 256));CREATE TABLE cell_attributes(id INTEGER PRIMARY KEY AUTOINCREMENT,grid_version INTEGER NOT NULL CHECK (grid_version = 1),cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),layer TEXT NOT NULL CHECK (layer IN ('forest','country','region')),value TEXT NOT NULL,UNIQUE (grid_version,cell_x,cell_y,layer));CREATE INDEX cell_attributes_lookup ON cell_attributes(grid_version,cell_x,cell_y,layer);";
  const assets = version >= 5 ? "CREATE TABLE assets(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),mime TEXT NOT NULL,bytes BLOB NOT NULL,width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'));CREATE INDEX assets_sha256_lookup ON assets(sha256);" : "";
  const defaultSettings = version >= 7
    ? '{"themeId":"ink","showGrid":true,"exportScale":1,"exportExtent":"world","canvasWidth":2048,"canvasHeight":1024,"gridKind":"graticule","gridColor":"#687784","gridWidth":1,"gridSpacing":10,"themeOverrides":{}}'
    : '{"themeId":"atlas","showGrid":false,"exportScale":2,"exportExtent":"viewport"}';
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);${world}${feature}${cells}${assets}`);
    db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(version);
    db.exec(`PRAGMA user_version=${version}`);
    if (version >= 6) db.prepare("INSERT INTO world(id,name,settings_json) VALUES ('world','Legacy',?)").run(settings ?? defaultSettings);
    else db.exec("INSERT INTO world(id,name) VALUES ('world','Legacy')");
    const featureInsert = version >= 4
      ? db.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)")
      : db.prepare("INSERT INTO features(id,feature_type,name,geometry_json) VALUES (?,?,?,?)");
    if (version >= 4) featureInsert.run("feature", "city", "A", JSON.stringify({ type: "Point", coordinates: [1, 2] }), "{}");
    else featureInsert.run("feature", "city", "A", JSON.stringify({ type: "Point", coordinates: [1, 2] }));
    db.prepare("INSERT INTO cell_grid(id,grid_version,grid_columns,grid_rows) VALUES (1,1,512,256)").run();
    db.prepare("INSERT INTO cell_attributes(grid_version,cell_x,cell_y,layer,value) VALUES (1,1,1,?,?)").run("forest", "trees");
  } finally { db.close(); }
}

describe("Electron storage parity: path, snapshots, migrations and transfer", () => {
  it("rejects path replacement before writable open and same-inode content mutation", () => {
    const directory = fixtureDirectory();
    const path = join(directory, "open-race.realmmap");
    const created = createStoredProject(path, "Open race");
    created.close();
    const moved = path + ".moved";
    const foreign = Buffer.from("SQLite format 3\0foreign");
    expect(() => openProjectAfterValidationForTest(path, (validatedPath) => {
      renameSync(validatedPath, moved);
      writeFileSync(validatedPath, foreign);
    })).toThrow(/changed|invalid|safely/i);
    expect(readFileSync(moved)).not.toEqual(foreign);
    expect(readFileSync(path)).toEqual(foreign);
    unlinkSync(moved); unlinkSync(path);

    const reopened = createStoredProject(path, "Digest race");
    reopened.close();
    const original = readFileSync(path);
    const metadata = statSync(path);
    const validated = preflightExistingProject(path);
    const fd = openSync(path, "r+");
    try { writeSync(fd, Buffer.from([0x7f]), 0, 1, 100); fsyncSync(fd); } finally { closeSync(fd); }
    utimesSync(path, new Date(metadata.atimeMs), new Date(metadata.mtimeMs));
    expect(() => validated.ensureCurrentIdentity()).toThrow(/changed|invalid/i);
    writeFileSync(path, original);
    utimesSync(path, new Date(metadata.atimeMs), new Date(metadata.mtimeMs));
    validated.close();
  });

  it("rejects managed create, open, and import after library replacement", async () => {
    const createDirectory = fixtureDirectory();
    const createCommands = new RealmCommands({ libraryDirectory: createDirectory });
    replaceLibraryDirectory(createDirectory);
    await expect(createCommands.createProject({ name: "Foreign create" })).rejects.toMatchObject({ code: "invalid_path" });
    expect(readdirSync(createDirectory)).toEqual(["foreign.marker"]);

    const openDirectory = fixtureDirectory();
    const openCommands = new RealmCommands({ libraryDirectory: openDirectory });
    const opened = await openCommands.createProject({ name: "Managed open" });
    const libraryId = basename(opened.path, ".realmmap");
    await openCommands.closeProject();
    replaceLibraryDirectory(openDirectory);
    await expect(openCommands.openProject({ libraryId })).rejects.toMatchObject({ code: "invalid_path" });
    expect(readdirSync(openDirectory)).toEqual(["foreign.marker"]);

    const sourceDirectory = fixtureDirectory();
    const sourceCommands = new RealmCommands({ libraryDirectory: sourceDirectory });
    const source = await sourceCommands.createProject({ name: "Transfer source" });
    await sourceCommands.closeProject();
    const importDirectory = fixtureDirectory();
    const importCommands = new RealmCommands({ libraryDirectory: importDirectory });
    replaceLibraryDirectory(importDirectory);
    await expect(importCommands.importProject({ path: source.path })).rejects.toMatchObject({ code: "invalid_path" });
    expect(readdirSync(importDirectory)).toEqual(["foreign.marker"]);
  });

  it("cleans only owned private snapshots and rejects non-regular sidecars", () => {
    const directory = fixtureDirectory();
    const path = join(directory, "snapshot.realmmap");
    const created = createStoredProject(path, "Snapshot");
    created.close();
    const validated = preflightExistingProject(path);
    const snapshot = readdirSync(directory).find((name) => name.startsWith(".realm-source-"));
    expect(snapshot).toBeDefined();
    const snapshotPath = join(directory, snapshot!);
    const moved = snapshotPath + ".moved";
    renameSync(snapshotPath, moved);
    writeFileSync(snapshotPath, "foreign replacement");
    validated.close();
    expect(readFileSync(snapshotPath, "utf8")).toBe("foreign replacement");
    unlinkSync(snapshotPath); unlinkSync(moved);
    symlinkSync(path, path + "-wal");
    const bytes = readFileSync(path);
    expect(() => preflightExistingProject(path)).toThrow(/regular|path/i);
    expect(readFileSync(path)).toEqual(bytes);
    unlinkSync(path + "-wal");
    expect(privateSnapshots(directory)).toEqual([]);
  });

  it("rejects sidecar content replacement and source-parent replacement without publishing", async () => {
    const directory = fixtureDirectory();
    const path = join(directory, "wal-source.realmmap");
    const created = createStoredProject(path, "WAL");
    created.close();
    const writer = new DatabaseSync(path);
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE wal_marker(value TEXT); INSERT INTO wal_marker(value) VALUES ('source');");
    const before = sourceIdentity(path);
    expect(before.sidecars["-wal"]).not.toBeNull();
    const validated = preflightExistingProject(path);
    const destination = join(directory, "wal-copy.realmmap");
    const wal = path + "-wal";
    const movedWal = wal + ".moved";
    renameSync(wal, movedWal);
    writeFileSync(wal, "foreign wal");
    await expect(copySqliteSnapshot(validated, destination, "sidecar-race")).rejects.toThrow(/changed|invalid/i);
    validated.close();
    expect(readFileSync(wal, "utf8")).toBe("foreign wal");
    const movedWalBytes = readFileSync(movedWal);
    expect(movedWalBytes).not.toEqual(readFileSync(wal));
    writer.close();
    if (existsSync(wal)) unlinkSync(wal);
    if (existsSync(movedWal)) unlinkSync(movedWal);

    const parent = join(directory, "parent");
    const movedParent = join(directory, "parent.moved");
    const newParent = join(directory, "parent");
    const nested = join(parent, "nested.realmmap");
    mkdirSync(parent);
    const nestedSession = createStoredProject(nested, "Parent race");
    nestedSession.close();
    const checked = preflightExistingProject(nested);
    renameSync(parent, movedParent);
    // A replacement directory at the old path must not receive a transfer.
    // eslint-disable-next-line no-bitwise
    require("node:fs").mkdirSync(newParent);
    await expect(copySqliteSnapshot(checked, join(newParent, "published.realmmap"), "parent-race")).rejects.toThrow(/regular|changed|invalid/i);
    checked.close();
    expect(existsSync(join(newParent, "published.realmmap"))).toBe(false);
  });

  it.each([3, 4, 5, 6, 7, 8, 9, 10])("rejects a legacy v%d source and preserves source bytes", async (version) => {
    const directory = fixtureDirectory();
    const path = join(directory, `failed-v${version}.realmmap`);
    createLegacyFixture(path, version);
    const before = readFileSync(path);
    const identity = sourceIdentity(path);
    await expect(Promise.resolve().then(() => openProject(path))).rejects.toMatchObject({ code: "unsupported_schema" });
    expect(readFileSync(path)).toEqual(before);
    expect(sameIdentity(identity, sourceIdentity(path))).toBe(true);
    const check = new DatabaseSync(path, { readOnly: true });
    try { expect(Number((check.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version)).toBe(version); } finally { check.close(); }
  });

  it("rejects unsupported, future, corrupt, partial, and retired schemas without mutation", async () => {
    const directory = fixtureDirectory();
    const futurePath = join(directory, "future.realmmap");
    const future = new DatabaseSync(futurePath);
    future.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO schema_migrations(version) VALUES (99);PRAGMA user_version=99;PRAGMA journal_mode=WAL;");
    future.close();
    const futureBytes = readFileSync(futurePath);
    await expect(Promise.resolve().then(() => openProject(futurePath))).rejects.toMatchObject({ code: "future_schema" });
    expect(readFileSync(futurePath)).toEqual(futureBytes);
    const legacyPath = join(directory, "legacy.realmmap");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO schema_migrations(version) VALUES (2);PRAGMA user_version=2;");
    legacy.close();
    const legacyBytes = readFileSync(legacyPath);
    await expect(Promise.resolve().then(() => openProject(legacyPath))).rejects.toMatchObject({ code: "unsupported_schema" });
    expect(readFileSync(legacyPath)).toEqual(legacyBytes);
    const corruptPath = join(directory, "corrupt.realmmap"); writeFileSync(corruptPath, "not sqlite");
    const corruptBytes = readFileSync(corruptPath);
    await expect(Promise.resolve().then(() => openProject(corruptPath))).rejects.toMatchObject({ code: "corrupt_project" });
    expect(readFileSync(corruptPath)).toEqual(corruptBytes);
    const partialPath = join(directory, "partial.realmmap"); const partial = new DatabaseSync(partialPath); partial.exec("CREATE TABLE world(id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL);PRAGMA user_version=8;"); partial.close();
    const partialBytes = readFileSync(partialPath);
    await expect(Promise.resolve().then(() => openProject(partialPath))).rejects.toMatchObject({ code: "corrupt_project" });
    expect(readFileSync(partialPath)).toEqual(partialBytes);
  });

  it("round-trips an uncheckpointed WAL through transfer while source bytes and sidecars stay immutable", async () => {
    const directory = fixtureDirectory();
    const sourcePath = join(directory, "source.realmmap");
    const sourceSession = createStoredProject(sourcePath, "Transfer source");
    sourceSession.close();
    const writer = new DatabaseSync(sourcePath);
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE wal_marker(value TEXT); INSERT INTO wal_marker(value) VALUES ('committed-wal');");
    const before = sourceIdentity(sourcePath);
    const transferPath = join(directory, "transfer.realmmap");
    const validated = preflightExistingProject(sourcePath);
    try { await copySqliteSnapshot(validated, transferPath, "wal-roundtrip"); } finally { validated.close(); }
    expect(sameIdentity(before, sourceIdentity(sourcePath))).toBe(true);
    const copied = new DatabaseSync(transferPath, { readOnly: true });
    try { expect(copied.prepare("SELECT value FROM wal_marker").get()).toEqual({ value: "committed-wal" }); } finally { copied.close(); }
    const imported = new RealmCommands({ libraryDirectory: join(directory, "library") });
    const importedSnapshot = await imported.importProject({ path: transferPath });
    expect(importedSnapshot.featureCount).toBe(0);
    const exportedPath = join(directory, "exported.realmmap");
    await imported.exportProject({ path: exportedPath });
    const exported = new DatabaseSync(exportedPath, { readOnly: true });
    try { expect(exported.prepare("SELECT value FROM wal_marker").get()).toEqual({ value: "committed-wal" }); } finally { exported.close(); }
    await imported.closeProject();
    writer.close();
  });
});

describe("Electron storage parity: transactional CRUD and session history", () => {
  it("rolls back feature, cell, and asset writes when SQLite rejects a transaction", async () => {
    const directory = fixtureDirectory();
    const commands = new RealmCommands({ libraryDirectory: directory });
    const initial = await commands.createProject({ name: "Rollback" });
    const path = initial.path;
    const reject = (name: string, table: string): void => {
      const db = new DatabaseSync(path);
      try { db.exec(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END;`); } finally { db.close(); }
    };
    const drop = (name: string): void => { const db = new DatabaseSync(path); try { db.exec(`DROP TRIGGER ${name}`); } finally { db.close(); } };
    reject("reject_feature", "features");
    await expect(commands.createFeature(featureInput)).rejects.toThrow();
    let check = new DatabaseSync(path, { readOnly: true }); expect(Number((check.prepare("SELECT COUNT(*) AS count FROM features").get() as Record<string, unknown>).count)).toBe(0); check.close();
    drop("reject_feature");
    reject("reject_shape", "map_shapes");
    await expect(commands.applyCellAttributes({ cellIds: ["1:1", "2:2"], attribute: "terrain", value: "land" })).rejects.toThrow();
    expect(await commands.viewCellAttributes({})).toEqual([]);
    drop("reject_shape");
    reject("reject_asset", "assets");
    await expect(commands.importAsset({ mime: "image/png", bytes: png, width: 1, height: 1, metadata: {} })).rejects.toThrow();
    check = new DatabaseSync(path, { readOnly: true }); expect(Number((check.prepare("SELECT COUNT(*) AS count FROM assets").get() as Record<string, unknown>).count)).toBe(0); check.close();
    await commands.closeProject();
  });

  it("keeps one undo step per edit, restores state across undo/redo, and reopens persisted current state", async () => {
    const directory = fixtureDirectory();
    const commands = new RealmCommands({ libraryDirectory: directory });
    let snapshot = await commands.createProject({ name: "History" });
    const path = snapshot.path;
    snapshot = await commands.createFeature(featureInput);
    const featureId = snapshot.features[0]!.id;
    snapshot = await commands.saveProject({ name: "Renamed" });
    expect(snapshot.canUndo).toBe(true);
    snapshot = await commands.undoProject(); expect(snapshot.world.name).toBe("History"); expect(snapshot.canRedo).toBe(true);
    snapshot = await commands.redoProject(); expect(snapshot.world.name).toBe("Renamed");
    snapshot = await commands.applyCellAttributes({ cellIds: ["1:1"], attribute: "terrain", value: "land" });
    expect(snapshot.canUndo).toBe(true);
    snapshot = await commands.undoProject(); expect(await commands.viewCellAttributes({})).toEqual([]);
    snapshot = await commands.redoProject(); expect((await commands.viewCellAttributes({}))[0]?.value).toBe("terrain");
    snapshot = await commands.importAsset({ mime: "image/png", bytes: png, width: 1, height: 1, metadata: { role: "history" } });
    expect(snapshot.assets).toHaveLength(1);
    snapshot = await commands.undoProject(); expect(snapshot.assets).toHaveLength(0);
    snapshot = await commands.redoProject(); expect(snapshot.assets).toHaveLength(1);
    await commands.closeProject();
    const reopened = await commands.openProject({ libraryId: basename(path, ".realmmap") });
    expect(reopened.featureCount).toBe(1);
    expect((await commands.viewCellAttributes({}))[0]?.value).toBe("terrain");
    expect(reopened.assets).toHaveLength(1);
    expect(reopened.canUndo).toBe(false);
    await commands.closeProject();
    void featureId;
  });
});
