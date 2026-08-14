// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RealmCommands } from "./realmCommands";
import { RealmError } from "../domain/errors";

const directory = (): string => mkdtempSync(join(tmpdir(), "realm-commands-"));
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
const point: { type: "Point"; coordinates: [number, number] } = { type: "Point", coordinates: [1, 2] };
const settings = { themeId: "ink" as const, showGrid: true, exportScale: 1 as const, exportExtent: "world" as const, canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule" as const, gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} };

describe("RealmCommands user-visible operations", () => {
  it("creates, lists, saves, updates settings, and closes projects", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir });
    let snapshot = await commands.createProject({ name: "  World  " });
    const path = snapshot.path;
    const libraryId = basename(path, ".realmmap");
    expect(snapshot.world.name).toBe("World");
    expect(await commands.getOpenProject()).not.toBeNull();
    snapshot = await commands.saveProject({ name: "Renamed" }); expect(snapshot.world.name).toBe("Renamed");
    snapshot = await commands.updateProjectSettings({ settings }); expect(snapshot.settings).toEqual(settings);
    await commands.closeProject(); expect(await commands.getOpenProject()).toBeNull();
    expect(await commands.listProjects()).toEqual([{ libraryId, name: "Renamed" }]);
    writeFileSync(join(dir, "ignored.realmmap"), "not sqlite");
    writeFileSync(join(dir, "not-a-uuid.realmmap"), "not sqlite");
    expect((await commands.listProjects()).map((item) => item.libraryId)).toEqual([libraryId]);
    await expect(commands.openProject({ libraryId: path })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.openProject({ libraryId: "../" + libraryId })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.openProject({ libraryId: "not-a-uuid" })).rejects.toMatchObject({ code: "invalid_input" });
    await commands.openProject({ libraryId: libraryId.toUpperCase() });
    await commands.closeProject();
  });

  it("rejects symlinked managed project files", async () => {
    const dir = directory(); const sourceCommands = new RealmCommands({ libraryDirectory: join(dir, "outside") });
    const source = await sourceCommands.createProject({ name: "Source" }); const id = "11111111-1111-4111-8111-111111111111"; await sourceCommands.closeProject();
    const commands = new RealmCommands({ libraryDirectory: dir });
    const link = join(dir, id + ".realmmap"); symlinkSync(source.path, link);
    await expect(commands.openProject({ libraryId: id })).rejects.toMatchObject({ code: "invalid_path" });
    expect(await commands.listProjects()).toEqual([]);
  });

  it("mutates features, enforces locking, and supports history", async () => {
    const commands = new RealmCommands({ libraryDirectory: directory() }); await commands.createProject({ name: "World" });
    let snapshot = await commands.createFeaturesBatch({ features: [{ featureType: "city", name: "A", geometry: point, properties: { note: "a" } }, { featureType: "town", name: "B", geometry: { type: "Point", coordinates: [2, 3] } }] });
    const id = snapshot.features[0]!.id;
    snapshot = await commands.reviseFeature({ id, name: "Updated", geometry: { type: "Point", coordinates: [4, 5] }, properties: { updated: true } });
    expect(snapshot.features.find((feature) => feature.id === id)?.name).toBe("Updated");
    snapshot = await commands.setFeaturesLocked({ ids: [id], locked: true }); expect(snapshot.features.find((feature) => feature.id === id)?.properties.locked).toBe(true);
    await expect(commands.reviseFeature({ id, name: "Nope", geometry: point })).rejects.toMatchObject({ code: "feature_locked" });
    await expect(commands.deleteFeature({ id })).rejects.toMatchObject({ code: "feature_locked" });
    snapshot = await commands.setFeaturesLocked({ ids: [id], locked: false });
    snapshot = await commands.deleteFeaturesBatch({ ids: [id] }); expect(snapshot.featureCount).toBe(1);
    await expect(commands.undoProject()).resolves.toMatchObject({ featureCount: 2 });
    await expect(commands.redoProject()).resolves.toMatchObject({ featureCount: 1 });
    await expect(commands.deleteFeature({ id: "missing" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.createFeaturesBatch({ features: [] })).rejects.toBeInstanceOf(RealmError);
  });

  it("imports, reads, deduplicates, references, and deletes assets", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Assets" });
    console.log("stage:create", Date.now());
    const asset = { mime: "image/png", bytes: png, width: 4, height: 5, metadata: { label: "icon" } } as const;
    let snapshot = await commands.importAsset(asset); console.log("stage:import-asset", Date.now()); expect(snapshot.assets).toHaveLength(1);
    const id = snapshot.assets[0]!.id; expect(await commands.readAsset({ id })).toMatchObject({ manifest: { id, mime: "image/png", byteLength: png.length }, bytes: png }); console.log("stage:read", Date.now());
    expect((await commands.importAsset(asset)).assets).toHaveLength(1); console.log("stage:dedup", Date.now());
    snapshot = await commands.importAssetsBatch({ packName: "Pack", assets: [asset, { ...asset, bytes: [...png, 1] }] }); console.log("stage:batch", Date.now()); expect(snapshot.assets).toHaveLength(2);
    const referenced = snapshot.assets[0]!.id;
    await commands.createFeature({ featureType: "city", name: "Uses", geometry: point, properties: { assetId: referenced } }); console.log("stage:feature", Date.now());
    await expect(commands.deleteAsset({ id: referenced })).rejects.toMatchObject({ code: "asset_in_use" }); console.log("stage:ref", Date.now());
    await expect(commands.readAsset({ id: "missing" })).rejects.toMatchObject({ code: "invalid_input" });
    await commands.deleteAssetsBatch({ ids: [snapshot.assets[1]!.id] }); console.log("stage:delete", Date.now());
    await expect(commands.deleteAssetsBatch({ ids: ["missing"] })).rejects.toMatchObject({ code: "invalid_input" });
    const exportPath = join(dir, "export.realmmap"); await commands.exportProject({ path: exportPath }); console.log("stage:export", Date.now());
    const imported = new RealmCommands({ libraryDirectory: join(dir, "imported") }); await imported.importProject({ path: exportPath }); console.log("stage:import", Date.now()); await imported.closeProject(); console.log("stage:import-close", Date.now());
    await commands.closeProject(); console.log("stage:main-close", Date.now());
  }, 60_000);

  it("writes validated artifacts and applies/removes cell attributes", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Cells" });
    const regionId = "33333333-3333-4333-8333-333333333333";
    const eraseRegionId = "66666666-6666-4666-8666-666666666666";
    await commands.applyCellAttributes({ cellIds: ["0:0", "1:0", "1:0"], attribute: "terrain", value: "land" });
    expect(await commands.viewCellAttributes({ minX: 0, maxX: 1, minY: 0, maxY: 0 })).toHaveLength(2);
    await commands.applyCellAttributes({ cellIds: ["0:0"], attribute: "terrain", value: null }); expect(await commands.viewCellAttributes({})).toHaveLength(1);
    await commands.applyCellAttributes({ cellIds: ["2:2", "3:2"], attribute: "region", value: "#AA0000", regionId });
    await commands.applyCellAttributes({ cellIds: ["8:8"], attribute: "region", value: "#AA0000", regionId: eraseRegionId });
    await commands.applyCellAttributes({ cellIds: ["8:8"], attribute: "terrain", value: "land" });
    await commands.applyCellAttributes({ cellIds: ["8:8"], attribute: "terrain", value: null, clearRegion: true });
    expect(await commands.viewCellAttributes({})).toEqual(expect.arrayContaining([{ cellId: "2:2", attribute: "region", value: "#AA0000", regionId }]));
    expect(await commands.viewCellAttributes({})).not.toEqual(expect.arrayContaining([
      { cellId: "8:8", attribute: "terrain", value: "land" },
      { cellId: "8:8", attribute: "region", value: "#AA0000", regionId: eraseRegionId },
    ]));
    await commands.undoProject();
    expect(await commands.viewCellAttributes({})).toEqual(expect.arrayContaining([
      { cellId: "8:8", attribute: "terrain", value: "land" },
      { cellId: "8:8", attribute: "region", value: "#AA0000", regionId: eraseRegionId },
    ]));
    await expect(commands.applyCellAttributes({ cellIds: ["8:8"], attribute: "terrain", value: "land", clearRegion: true })).rejects.toThrow("region clearing");
    await expect(commands.applyCellAttributes({ cellIds: ["8:8"], attribute: "region", value: null, clearRegion: true })).rejects.toThrow("region clearing");
    await commands.applyCellAttributes({ cellIds: ["5:3"], attribute: "terrain", value: "land" });
    await commands.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] });
    const moved = await commands.viewCellAttributes({ minX: 2, maxX: 6, minY: 2, maxY: 3 });
    expect(moved).toEqual(expect.arrayContaining([
      { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
      { cellId: "5:3", attribute: "terrain", value: "land" },
    ]));
    expect(moved).toEqual(expect.arrayContaining([
      { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
    ]));
    await commands.moveRegionCells({ sourceCellIds: ["5:3", "6:3"], targetCellIds: ["2:2", "3:2"] });
    const movedBack = await commands.viewCellAttributes({});
    expect(movedBack).toEqual(expect.arrayContaining([
      { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
      { cellId: "3:2", attribute: "region", value: "#AA0000", regionId },
    ]));
    expect(movedBack).not.toEqual(expect.arrayContaining([
      { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
      { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
    ]));
    await expect(commands.moveRegionCells({ sourceCellIds: ["2:2"], targetCellIds: ["7:3"] })).rejects.toThrow();
    await commands.undoProject();
    expect(await commands.viewCellAttributes({})).toEqual(expect.arrayContaining([
      { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
      { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
    ]));
    await commands.undoProject();
    expect(await commands.viewCellAttributes({ minX: 2, maxX: 3, minY: 2, maxY: 2 })).toEqual([
      { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
      { cellId: "3:2", attribute: "region", value: "#AA0000", regionId },
    ]);
    await expect(commands.viewCellAttributes({ minX: 3, maxX: 2 })).rejects.toThrow("viewport");
    const pngPath = join(dir, "artifact.png"); await commands.writeArtifact({ path: pngPath, bytes: png });
    await expect(commands.writeArtifact({ path: join(dir, "bad.png"), bytes: [1, 2] })).rejects.toThrow("content");
    await expect(commands.writeArtifact({ path: join(dir, "bad.txt"), bytes: png })).rejects.toThrow("extension");
  });

  it("moves every cell with one region ID, including a visually separated component", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Region ID" });
    const regionId = "44444444-4444-4444-8444-444444444444";
    await commands.applyCellAttributes({ cellIds: ["2:2", "3:2", "20:20"], attribute: "region", value: "#AA0000", regionId });
    await commands.applyCellAttributes({ cellIds: ["2:2", "3:2", "20:20", "5:3", "23:21"], attribute: "terrain", value: "land" });

    await expect(commands.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] })).rejects.toThrow("entire region");
    await commands.moveRegionCells({ sourceCellIds: ["2:2", "3:2", "20:20"], targetCellIds: ["5:3", "6:3", "23:21"] });

    const moved = await commands.viewCellAttributes({});
    expect(moved).toEqual(expect.arrayContaining([
      { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
      { cellId: "23:21", attribute: "region", value: "#AA0000", regionId },
    ]));
    expect(moved).not.toEqual(expect.arrayContaining([
      { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
      { cellId: "20:20", attribute: "region", value: "#AA0000", regionId },
    ]));
  });

  it("keeps the stationary region and clips only the grabbed side on overlap", async () => {
    const dir = directory(); const commands = new RealmCommands({ libraryDirectory: dir }); await commands.createProject({ name: "Grab overlap" });
    const movingRegionId = "55555555-5555-4555-8555-555555555555";
    const stationaryRegionId = "66666666-6666-4666-8666-666666666666";
    await commands.applyCellAttributes({ cellIds: ["2:2", "3:2"], attribute: "region", value: "#AA0000", regionId: movingRegionId });
    await commands.applyCellAttributes({ cellIds: ["5:3"], attribute: "region", value: "#00AA00", regionId: stationaryRegionId });

    await commands.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] });

    const moved = await commands.viewCellAttributes({});
    expect(moved).toEqual(expect.arrayContaining([
      { cellId: "5:3", attribute: "region", value: "#00AA00", regionId: stationaryRegionId },
      { cellId: "6:3", attribute: "region", value: "#AA0000", regionId: movingRegionId },
    ]));
    expect(moved).not.toEqual(expect.arrayContaining([
      { cellId: "2:2", attribute: "region", value: "#AA0000", regionId: movingRegionId },
      { cellId: "3:2", attribute: "region", value: "#AA0000", regionId: movingRegionId },
    ]));
  });
});
