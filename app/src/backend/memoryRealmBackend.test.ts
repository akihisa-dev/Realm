import { MemoryRealmBackend } from "./memoryRealmBackend";

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

  it("covers library errors, import, reopen, redo, and cell validation", async () => {
    const backend = new MemoryRealmBackend();
    await expect(backend.saveProject({ name: "Nope" })).rejects.toThrow("開かれていません");
    await expect(backend.openProject({ path: "browser://missing" })).rejects.toThrow("見つかりません");
    const created = await backend.createProject({ path: "browser://copy.realmmap", name: "Copy" });
    await expect(backend.createProject({ path: created.path, name: "Duplicate" })).rejects.toThrow("すでに");
    await expect(backend.createFeature({ featureType: "city", name: "", geometry: { type: "Point", coordinates: [0, 0] } })).rejects.toThrow("名前");
    await expect(backend.createFeature({ featureType: "city", name: "City", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })).rejects.toThrow("形状");
    await expect(backend.createFeature({ featureType: "city", name: "City", geometry: { type: "Point", coordinates: [0, 0] } })).resolves.toBeTruthy();
    await backend.undoProject(); await backend.redoProject();
    await backend.closeProject(); await expect(backend.getOpenProject()).resolves.toBeNull();
    await backend.openProject({ path: created.path }); await backend.importProject({ path: created.path });
    await expect(backend.applyCellAttributes({ cellIds: [], attribute: "forest", value: "on" })).rejects.toThrow("セルを選択");
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

it("persists project view settings without accepting unknown state", async () => {
  const backend = new MemoryRealmBackend();
  await backend.createProject({ path: "browser://settings.realmmap", name: "Settings" });
  const changed = await backend.updateProjectSettings({ settings: { themeId: "midnight", showGrid: false, exportScale: 4, exportExtent: "world" } });
  expect(changed.settings).toEqual({ themeId: "midnight", showGrid: false, exportScale: 4, exportExtent: "world" });
  expect((await backend.undoProject()).settings).toEqual({ themeId: "ink", showGrid: true, exportScale: 2, exportExtent: "world" });
  await expect(backend.updateProjectSettings({ settings: { viewport: true } as never })).rejects.toThrow("不正");
});
