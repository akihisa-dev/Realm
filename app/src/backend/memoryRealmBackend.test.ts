import { MemoryRealmBackend } from "./memoryRealmBackend";
import type { CreateFeatureInput, GeoJsonGeometry } from "./types";

describe("MemoryRealmBackend", () => {
it("creates, edits, deletes, and undoes current features", async () => {
    const backend = new MemoryRealmBackend();
    const initial = await backend.createProject({ path: "browser://world.realmmap", name: "World" });
    expect(initial.world).toEqual(expect.objectContaining({ name: "World" }));
    const created = await backend.createFeature({ featureType: "city", name: "City", geometry: { type: "Point", coordinates: [0, 0] } });
    const id = created.features[0]!.id;
    await backend.reviseFeature({ id, name: "Capital", geometry: { type: "Point", coordinates: [1, 1] } });
    expect((await backend.getOpenProject())?.features[0]?.name).toBe("Capital");
    await backend.deleteFeature({ id });
    expect((await backend.getOpenProject())?.features).toHaveLength(0);
    expect((await backend.undoProject()).features).toHaveLength(1);
  });

  it("stores non-terrain cell attributes", async () => {
    const backend = new MemoryRealmBackend(); await backend.createProject({ path: "browser://cells.realmmap", name: "Cells" });
    await backend.applyCellAttributes({ cellIds: ["1:2"], attribute: "forest", value: "on" });
    expect(await backend.viewCellAttributes({})).toEqual([{ cellId: "1:2", attribute: "forest", value: "on" }]);
  });

  it("stores, clears, and undoes terrain cell attributes", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://terrain-cells.realmmap", name: "Terrain cells" });
    await backend.applyCellAttributes({ cellIds: ["2:3", "3:3"], attribute: "terrain", value: "terrain" });
    expect(await backend.viewCellAttributes({})).toEqual([
      { cellId: "2:3", attribute: "terrain", value: "terrain" },
      { cellId: "3:3", attribute: "terrain", value: "terrain" },
    ]);
    await backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "terrain", value: null });
    expect(await backend.viewCellAttributes({})).toEqual([
      { cellId: "3:3", attribute: "terrain", value: "terrain" },
    ]);
    await backend.undoProject();
    expect(await backend.viewCellAttributes({})).toHaveLength(2);
  });

  it("clears terrain and region shapes together as one undoable operation", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://terrain-region-erase.realmmap", name: "Terrain region erase" });
    const regionId = "55555555-5555-4555-8555-555555555555";
    await backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "terrain", value: "land" });
    await backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "region", value: "#AA0000", regionId });
    await backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "terrain", value: null, clearRegion: true });
    expect(await backend.viewCellAttributes({})).toEqual([]);
    await backend.undoProject();
    expect(await backend.viewCellAttributes({})).toEqual([
      { cellId: "2:3", attribute: "terrain", value: "terrain" },
      { cellId: "2:3", attribute: "region", value: "#AA0000", regionId },
    ]);
    await expect(backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "terrain", value: "land", clearRegion: true })).rejects.toThrow("領域消去");
    await expect(backend.applyCellAttributes({ cellIds: ["2:3"], attribute: "region", value: null, clearRegion: true })).rejects.toThrow("領域消去");
  });

  it("covers library errors, import, reopen, redo, and cell validation", async () => {
    const backend = new MemoryRealmBackend();
    await expect(backend.saveProject({ name: "Nope" })).rejects.toThrow("開かれていません");
    await expect(backend.openProject({ libraryId: "browser://missing" })).rejects.toThrow("見つかりません");
    const created = await backend.createProject({ path: "browser://copy.realmmap", name: "Copy" });
    await expect(backend.createProject({ path: created.path, name: "Duplicate" })).rejects.toThrow("すでに");
    await expect(backend.createFeature({ featureType: "city", name: "", geometry: { type: "Point", coordinates: [0, 0] } })).rejects.toThrow("名前");
    await expect(backend.createFeature({ featureType: "city", name: "City", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })).rejects.toThrow("形状");
    await expect(backend.createFeature({ featureType: "city", name: "City", geometry: { type: "Point", coordinates: [0, 0] } })).resolves.toBeTruthy();
    await backend.undoProject(); await backend.redoProject();
    await backend.closeProject(); await expect(backend.getOpenProject()).resolves.toBeNull();
    await backend.openProject({ libraryId: created.path }); await backend.importProject({ path: created.path });
    await expect(backend.applyCellAttributes({ cellIds: [], attribute: "forest", value: "on" })).rejects.toThrow("セルを選択");
    await expect(backend.applyCellAttributes({ cellIds: ["63:36"], attribute: "forest", value: "on" })).resolves.toBeTruthy();
    await expect(backend.applyCellAttributes({ cellIds: ["128:72"], attribute: "forest", value: "on" })).rejects.toThrow("不正");
    await expect(backend.applyCellAttributes({ cellIds: ["127:73"], attribute: "forest", value: "on" })).rejects.toThrow("不正");
    await expect(backend.applyCellAttributes({ cellIds: ["999:999"], attribute: "forest", value: "on" })).rejects.toThrow("不正");
    await expect(backend.applyCellAttributes({ cellIds: ["1:1"], attribute: "forest", value: " " })).rejects.toThrow("属性値");
  });

  it("does not create undo history for a canonical no-op name save", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "browser://name.realmmap", name: "World" });
    await backend.saveProject({ name: "  World  " });
    expect((await backend.getOpenProject())?.canUndo).toBe(false);
  });
});

it("creates a validated feature batch as one undo operation", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://batch.realmmap", name: "Batch" });
  const created = await backend.createFeaturesBatch({ features: [
    { featureType: "tree", name: "Tree 1", geometry: { type: "Point", coordinates: [1, 2] } },
    { featureType: "tree", name: "Tree 2", geometry: { type: "Point", coordinates: [2, 3] } },
  ] });
  expect(created.features).toHaveLength(2);
  expect((await backend.undoProject()).features).toHaveLength(0);
  await expect(backend.createFeaturesBatch({ features: [] })).rejects.toThrow("地物数");
});

it("revises and deletes multiple unlocked features atomically", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://multi.realmmap", name: "Multi" });
  const created = await backend.createFeaturesBatch({ features: [
    { featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } },
    { featureType: "city", name: "B", geometry: { type: "Point", coordinates: [1, 1] } },
  ] });
  const revisions = created.features.map((feature, index) => ({ id: feature.id, name: feature.name, geometry: { type: "Point" as const, coordinates: [index + 10, index + 10] as [number, number] }, properties: {} }));
  const revised = await backend.reviseFeaturesBatch({ features: revisions });
  expect(revised.features.map((feature) => feature.geometry)).toEqual(revisions.map((revision) => revision.geometry));
  expect((await backend.undoProject()).features.map((feature) => feature.geometry)).toEqual(created.features.map((feature) => feature.geometry));
  await backend.redoProject();
  expect((await backend.deleteFeaturesBatch({ ids: created.features.map(({ id }) => id) })).features).toHaveLength(0);
  expect((await backend.undoProject()).features).toHaveLength(2);
});

it("rejects locked or invalid multi-feature mutations without a partial write", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://locked.realmmap", name: "Locked" });
  const created = await backend.createFeaturesBatch({ features: [
    { featureType: "city", name: "Locked", geometry: { type: "Point", coordinates: [0, 0] }, properties: { locked: true } },
    { featureType: "city", name: "Open", geometry: { type: "Point", coordinates: [1, 1] } },
  ] });
  await expect(backend.deleteFeaturesBatch({ ids: created.features.map(({ id }) => id) })).rejects.toThrow("ロック");
  await expect(backend.reviseFeaturesBatch({ features: [
    { id: created.features[1]!.id, name: "Moved", geometry: { type: "Point", coordinates: [2, 2] }, properties: {} },
    { id: created.features[0]!.id, name: "Locked", geometry: { type: "Point", coordinates: [3, 3] }, properties: { locked: true } },
  ] })).rejects.toThrow("ロック");
  expect((await backend.getOpenProject())?.features).toEqual(created.features);
  const unlocked = await backend.setFeaturesLocked({ ids: [created.features[0]!.id], locked: false });
  expect(unlocked.features[0]?.properties?.locked).toBe(false);
  expect((await backend.undoProject()).features[0]?.properties?.locked).toBe(true);
});

it("embeds, reads, deduplicates, and deletes project assets", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://assets.realmmap", name: "Assets" });
  const input = { mime: "image/png", bytes: [137, 80, 78, 71, 13, 10, 26, 10], width: 8, height: 8, metadata: { license: "owned" } };
  const imported = await backend.importAsset(input);
  expect(imported.assets).toHaveLength(1);
  expect((await backend.readAsset({ id: imported.assets[0]!.id })).bytes).toEqual(input.bytes);
  expect((await backend.importAsset(input)).assets).toHaveLength(1);
  const assetId = imported.assets[0]!.id;
  await backend.createFeature({ featureType: "symbol", name: "Custom", geometry: { type: "Point", coordinates: [0, 0] }, properties: { assetId } });
  await expect(backend.deleteAsset({ id: assetId })).rejects.toThrow("使用中");
  const open = await backend.getOpenProject();
  await backend.deleteFeature({ id: open!.features[0]!.id });
  expect((await backend.deleteAsset({ id: assetId })).assets).toHaveLength(0);
});

it("matches native asset signature and nested reference validation", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://asset-contract.realmmap", name: "Assets" });
  await expect(backend.importAsset({ mime: "image/png", bytes: [255, 216, 255], width: 1, height: 1 })).rejects.toThrow("MIME");
  const imported = await backend.importAsset({ mime: " IMAGE/PNG ", bytes: [137, 80, 78, 71, 13, 10, 26, 10], width: 1, height: 1, metadata: { owned: true } });
  const assetId = imported.assets[0]!.id;
  await backend.createFeature({ featureType: "symbol", name: "Nested", geometry: { type: "Point", coordinates: [0, 0] }, properties: { style: { assetIds: [assetId] } } });
  await expect(backend.deleteAsset({ id: assetId })).rejects.toThrow("使用中");
});

it("imports and deletes an asset pack as atomic undoable batches", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://asset-pack.realmmap", name: "Asset Pack" });
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const imported = await backend.importAssetsBatch({ packName: "Own Trees", assets: [
    { mime: "image/png", bytes: [...png, 1], width: 1, height: 1, metadata: { originalName: "oak.png" } },
    { mime: "image/png", bytes: [...png, 2], width: 1, height: 1, metadata: { originalName: "pine.png" } },
  ] });
  expect(imported.assets).toHaveLength(2);
  expect(imported.assets.map((asset) => asset.metadata)).toEqual([
    expect.objectContaining({ packName: "Own Trees", packOrdinal: 0 }),
    expect.objectContaining({ packName: "Own Trees", packOrdinal: 1 }),
  ]);
  expect(new Set(imported.assets.map((asset) => asset.metadata.packId)).size).toBe(1);
  expect((await backend.undoProject()).assets).toHaveLength(0);
  const restored = await backend.redoProject();
  expect(restored.assets).toHaveLength(2);
  expect((await backend.deleteAssetsBatch({ ids: restored.assets.map(({ id }) => id) })).assets).toHaveLength(0);
  expect((await backend.undoProject()).assets).toHaveLength(2);
});

it("rejects an invalid asset pack without a partial write", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://invalid-pack.realmmap", name: "Invalid Pack" });
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  await expect(backend.importAssetsBatch({ packName: "Own", assets: [
    { mime: "image/png", bytes: png, width: 1, height: 1 },
    { mime: "image/png", bytes: [255, 216, 255], width: 1, height: 1 },
  ] })).rejects.toThrow("MIME");
  expect((await backend.getOpenProject())?.assets).toHaveLength(0);
  await expect(backend.importAssetsBatch({ packName: "Own", assets: [
    { mime: "image/png", bytes: png, width: 1, height: 1, metadata: { packId: "forged" } },
  ] })).rejects.toThrow("予約済み");
  expect((await backend.getOpenProject())?.assets).toHaveLength(0);
});

it("persists project view settings without accepting unknown state", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://settings.realmmap", name: "Settings" });
  const changed = await backend.updateProjectSettings({ settings: { themeId: "midnight", showGrid: false, exportScale: 4, exportExtent: "world", canvasWidth: 4096, canvasHeight: 2048, gridKind: "hex", gridColor: "#102030", gridWidth: 1.5, gridSpacing: 12, themeOverrides: { land: "#aabbcc" } } });
  expect(changed.settings).toEqual({ themeId: "midnight", showGrid: false, exportScale: 4, exportExtent: "world", canvasWidth: 4096, canvasHeight: 2048, gridKind: "hex", gridColor: "#102030", gridWidth: 1.5, gridSpacing: 12, themeOverrides: { land: "#aabbcc" } });
  expect((await backend.undoProject()).settings).toEqual({ themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} });
  await expect(backend.updateProjectSettings({ settings: { ...changed.settings, canvasWidth: 511 } })).rejects.toThrow("キャンバス幅");
  await expect(backend.updateProjectSettings({ settings: { ...changed.settings, canvasHeight: 8193 } })).rejects.toThrow("キャンバス高さ");
  await expect(backend.updateProjectSettings({ settings: { viewport: true } as never })).rejects.toThrow("不正");
});

it("keeps a moved region's hidden overhang and terrain attributes", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab.realmmap", name: "Grab" });
  const regionId = "11111111-1111-4111-8111-111111111111";
  await backend.applyCellAttributes({ cellIds: ["2:2", "3:2"], attribute: "region", value: "#AA0000", regionId });
  await backend.applyCellAttributes({ cellIds: ["2:2", "5:3"], attribute: "terrain", value: "terrain" });
  const before = await backend.getOpenProject();
  await backend.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] });
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "2:2", attribute: "terrain", value: "terrain" },
    { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
    { cellId: "5:3", attribute: "terrain", value: "terrain" },
  ]));
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
  ]));
  await backend.moveRegionCells({ sourceCellIds: ["5:3", "6:3"], targetCellIds: ["2:2", "3:2"] });
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
    { cellId: "3:2", attribute: "region", value: "#AA0000", regionId },
  ]));
  expect(await backend.viewCellAttributes({})).not.toEqual(expect.arrayContaining([
    { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
    { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
  ]));
  expect((await backend.undoProject()).canRedo).toBe(true);
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
    { cellId: "6:3", attribute: "region", value: "#AA0000", regionId },
  ]));
  await backend.undoProject();
  expect(await backend.viewCellAttributes({})).toEqual(expect.arrayContaining([
    { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
    { cellId: "2:2", attribute: "terrain", value: "terrain" },
    { cellId: "3:2", attribute: "region", value: "#AA0000", regionId },
  ]));
  await expect(backend.moveRegionCells({ sourceCellIds: ["9:9"], targetCellIds: ["4:2"] })).rejects.toThrow();
  expect(before?.features).toEqual([]);
});

it("moves every cell with one region ID, including a visually separated component", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab-region-id.realmmap", name: "Grab region ID" });
  const regionId = "22222222-2222-4222-8222-222222222222";
  await backend.applyCellAttributes({ cellIds: ["2:2", "3:2", "20:20"], attribute: "region", value: "#AA0000", regionId });
  await backend.applyCellAttributes({ cellIds: ["2:2", "3:2", "20:20", "5:3", "23:21"], attribute: "terrain", value: "terrain" });

  await expect(backend.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] })).rejects.toThrow("領域全体");
  await backend.moveRegionCells({ sourceCellIds: ["2:2", "3:2", "20:20"], targetCellIds: ["5:3", "6:3", "23:21"] });

  const moved = await backend.viewCellAttributes({});
  expect(moved).toEqual(expect.arrayContaining([
    { cellId: "5:3", attribute: "region", value: "#AA0000", regionId },
    { cellId: "23:21", attribute: "region", value: "#AA0000", regionId },
  ]));
  expect(moved).not.toEqual(expect.arrayContaining([
    { cellId: "2:2", attribute: "region", value: "#AA0000", regionId },
    { cellId: "20:20", attribute: "region", value: "#AA0000", regionId },
  ]));
});

it("rejects a region move when it overlaps another region", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://grab-overlap.realmmap", name: "Grab overlap" });
  const movingRegionId = "55555555-5555-4555-8555-555555555555";
  const stationaryRegionId = "66666666-6666-4666-8666-666666666666";
  await backend.applyCellAttributes({ cellIds: ["2:2", "3:2"], attribute: "region", value: "#AA0000", regionId: movingRegionId });
  await backend.applyCellAttributes({ cellIds: ["5:3"], attribute: "region", value: "#00AA00", regionId: stationaryRegionId });

  await expect(backend.moveRegionCells({ sourceCellIds: ["2:2", "3:2"], targetCellIds: ["5:3", "6:3"] })).rejects.toThrow("移動先に別の領域");

  const unchanged = await backend.viewCellAttributes({});
  expect(unchanged).toEqual(expect.arrayContaining([
    { cellId: "2:2", attribute: "region", value: "#AA0000", regionId: movingRegionId },
    { cellId: "3:2", attribute: "region", value: "#AA0000", regionId: movingRegionId },
    { cellId: "5:3", attribute: "region", value: "#00AA00", regionId: stationaryRegionId },
  ]));
});

it("matches strict native geometry write validation and keeps failed mutations atomic", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://geometry-contract.realmmap", name: "Geometry" });

  const coordinates: [number, number][] = Array.from({ length: 4096 }, (_, index) => [
    -180 + (360 * index) / 4095,
    index % 2,
  ]);
  await expect(backend.createFeature({ featureType: "river", name: "Boundary", geometry: { type: "LineString", coordinates } })).resolves.toBeTruthy();
  await expect(backend.createFeature({ featureType: "river", name: "Too many", geometry: { type: "LineString", coordinates: [...coordinates, [180, 0]] } })).rejects.toThrow(/線/);
  await expect(backend.createFeature({ featureType: "river", name: "Adjacent duplicate", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1], [1, 1], [2, 0]] } })).rejects.toThrow(/重複/);
  await expect(backend.createFeature({ featureType: "river", name: "Closed", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1], [0, 0]] } })).rejects.toThrow(/終点/);

  const validHole: GeoJsonGeometry = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
    ],
  };
  await expect(backend.createFeature({ featureType: "country", name: "Hole", geometry: validHole })).resolves.toBeTruthy();
  await expect(backend.createFeature({ featureType: "country", name: "Outside hole", geometry: { type: "Polygon", coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[3, 3], [5, 3], [5, 5], [3, 3]],
  ] } })).rejects.toThrow(/外周/);
  await expect(backend.createFeature({ featureType: "country", name: "Overlapping holes", geometry: { type: "Polygon", coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[2, 2], [6, 2], [6, 6], [2, 2]],
    [[4, 3], [8, 3], [8, 7], [4, 3]],
  ] } })).rejects.toThrow(/穴同士/);
  await expect(backend.createFeature({ featureType: "country", name: "Zero area", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] } })).rejects.toThrow(/面積/);
  await expect(backend.createFeature({ featureType: "country", name: "Self intersecting", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] } })).rejects.toThrow(/自己交差/);

  const oversized = { type: "Point", coordinates: [0, 0], extra: "x".repeat(512 * 1024) } as unknown as CreateFeatureInput["geometry"];
  await expect(backend.createFeature({ featureType: "city", name: "Oversized", geometry: oversized })).rejects.toThrow(/大きすぎ/);

  const beforeBatch = await backend.getOpenProject();
  await expect(backend.createFeaturesBatch({ features: [
    { featureType: "city", name: "Valid", geometry: { type: "Point", coordinates: [8, 8] } },
    { featureType: "country", name: "Invalid", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] } },
  ] })).rejects.toThrow(/面積/);
  expect(await backend.getOpenProject()).toEqual(beforeBatch);

  const feature = (await backend.createFeature({ featureType: "city", name: "Revisable", geometry: { type: "Point", coordinates: [9, 9] } })).features.at(-1)!;
  const beforeRevision = await backend.getOpenProject();
  await expect(backend.reviseFeature({ id: feature.id, name: "Broken", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })).rejects.toThrow(/形状/);
  expect(await backend.getOpenProject()).toEqual(beforeRevision);
});
