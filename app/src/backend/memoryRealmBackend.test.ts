import { describe, expect, it } from "vitest";
import { MemoryRealmBackend } from "./memoryRealmBackend";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../shared/mapShapeGeometry";
import type { MapObject, MapShape, RealmSnapshot } from "./types";

const terrain = (cells: string[], id = "11111111-1111-4111-8111-111111111111"): MapShape => ({
  id,
  layer: "terrain",
  value: "terrain",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: cellIdsToPolygonGeometries(cells)[0]!,
});

const region = (cells: string[], regionId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333"): MapShape => ({
  id,
  layer: "region",
  regionId,
  value: "#2468AC",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: cellIdsToPolygonGeometries(cells)[0]!,
});
const point = (coordinates: [number, number]): MapObject["geometry"] => ({ type: "Point", coordinates });
const object = (kind: MapObject["kind"], id: string, geometry: MapObject["geometry"], label: string = kind): MapObject => ({ id, kind, geometry, label, properties: {}, zIndex: 0, locked: false });

const project = (path = "memory-project"): RealmSnapshot => ({
  formatVersion: 12,
  path,
  world: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "テスト世界" },
  layers: { terrain: [], regions: [], objects: [] },
  features: [],
  mapShapes: [],
  assets: [],
  settings: { themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} },
  featureCount: 0,
  canUndo: false,
  canRedo: false,
});

describe("MemoryRealmBackend map shapes", () => {
  it("creates, updates, deletes, and restores canonical Polygon rows", async () => {
    const backend = new MemoryRealmBackend([project()]);
    await backend.openProject({ libraryId: "memory-project" });
    const first = terrain(["2:2"]);
    const second = region(["5:5"]);

    let snapshot = await backend.createMapShapes({ shapes: [first, second] });
    expect(snapshot.mapShapes).toHaveLength(2);
    expect(mapShapeCellIds(snapshot.mapShapes[0]!)).toEqual(new Set(["2:2"]));

    const updated = { ...first, geometry: cellIdsToPolygonGeometries(["2:2", "3:2"])[0]! };
    snapshot = await backend.updateMapShapes({ shapes: [updated, second] });
    expect(mapShapeCellIds(snapshot.mapShapes.find(({ id }) => id === first.id)!)).toEqual(new Set(["2:2", "3:2"]));
    expect(snapshot.canUndo).toBe(true);

    snapshot = await backend.undoProject();
    expect(mapShapeCellIds(snapshot.mapShapes.find(({ id }) => id === first.id)!)).toEqual(new Set(["2:2"]));
    snapshot = await backend.redoProject();
    expect(mapShapeCellIds(snapshot.mapShapes.find(({ id }) => id === first.id)!)).toEqual(new Set(["2:2", "3:2"]));

    snapshot = await backend.deleteMapShapes({ ids: [second.id] });
    expect(snapshot.mapShapes.map(({ id }) => id)).toEqual([first.id]);
  });

  it("rejects invalid or overlapping updates without changing the project", async () => {
    const backend = new MemoryRealmBackend([project()]);
    await backend.openProject({ libraryId: "memory-project" });
    const first = terrain(["2:2"]);
    await backend.createMapShapes({ shapes: [first] });
    const before = await backend.getOpenProject();
    const overlapping = terrain(["2:2"], "44444444-4444-4444-8444-444444444444");
    await expect(backend.updateMapShapes({ shapes: [first, overlapping] })).rejects.toThrow();
    expect(await backend.getOpenProject()).toEqual(before);
  });

  it("stores and edits terrain, regions, and overlapping objects independently", async () => {
    const backend = new MemoryRealmBackend([project("native-layers")]);
    await backend.openProject({ libraryId: "native-layers" });
    const terrainShape = terrain(["2:2"]);
    const regionShape = region(["2:2"]);
    const regions = [{ id: regionShape.regionId!, name: "青の領域", color: regionShape.value, shapes: [{ id: regionShape.id, geometry: regionShape.geometry }] }];
    const objects = [
      object("city", "44444444-4444-4444-8444-444444444444", point([1, 2]), "都市"),
      object("text", "55555555-5555-4555-8555-555555555555", point([1, 2]), "文字"),
      object("mountain", "66666666-6666-4666-8666-666666666666", point([10, 20]), "山"),
      object("forest", "77777777-7777-4777-8777-777777777777", cellIdsToPolygonGeometries(["8:8", "9:8"])[0]!, "森"),
    ];

    let snapshot = await backend.replaceTerrainLayer({ shapes: [{ id: terrainShape.id, geometry: terrainShape.geometry }] });
    snapshot = await backend.replaceRegionLayer({ regions });
    snapshot = await backend.replaceObjectLayer({ objects });
    expect(snapshot.layers.terrain).toHaveLength(1);
    expect(snapshot.layers.regions).toEqual(regions);
    expect(snapshot.layers.objects.map(({ kind }) => kind)).toEqual(["city", "text", "mountain", "forest"]);
    expect(snapshot.mapShapes).toHaveLength(2);

    const moved = { ...objects[0]!, geometry: point([2, 3]) };
    snapshot = await backend.replaceObjectLayer({ objects: [moved, ...objects.slice(1)] });
    expect(snapshot.layers.objects[0]?.geometry).toEqual(moved.geometry);
    await expect(backend.replaceTerrainLayer({ shapes: [{ id: terrainShape.id, geometry: terrainShape.geometry }, { id: "88888888-8888-4888-8888-888888888888", geometry: terrainShape.geometry }] })).rejects.toThrow();
    await expect(backend.replaceObjectLayer({ objects: [{ ...moved, kind: "river" as MapObject["kind"] }] })).rejects.toThrow();

    snapshot = await backend.undoProject();
    expect(snapshot.layers.objects[0]?.geometry).toEqual(objects[0]?.geometry);
    snapshot = await backend.redoProject();
    expect(snapshot.layers.objects[0]?.geometry).toEqual(moved.geometry);
  });

  it("validates memory project lifecycle, settings, and asset references", async () => {
    const backend = new MemoryRealmBackend();
    await expect(backend.getOpenProject()).resolves.toBeNull();
    await expect(backend.saveProject({ name: "未開" })).rejects.toThrow();
    await expect(backend.openProject({ libraryId: "missing" })).rejects.toThrow();
    await expect(backend.importProject({ path: "missing" })).rejects.toThrow();

    let snapshot = await backend.createProject({ path: "lifecycle", name: "  ライフサイクル  " });
    expect(snapshot.world.name).toBe("ライフサイクル");
    await expect(backend.createProject({ path: "lifecycle", name: "重複" })).rejects.toThrow();
    expect(await backend.listProjects()).toEqual([{ libraryId: "lifecycle", name: "ライフサイクル" }]);
    snapshot = await backend.saveProject({ name: "更新後" });
    expect(snapshot.world.name).toBe("更新後");
    snapshot = await backend.saveProject({ name: "更新後" });
    const settings = { ...snapshot.settings, gridKind: "hex" as const };
    snapshot = await backend.updateProjectSettings({ settings });
    expect(snapshot.settings.gridKind).toBe("hex");
    snapshot = await backend.updateProjectSettings({ settings });
    expect(snapshot.settings.gridKind).toBe("hex");

    const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
    snapshot = await backend.importAsset({ mime: "image/png", bytes: png, width: 1, height: 1 });
    const asset = snapshot.assets[0]!;
    snapshot = await backend.importAsset({ mime: "image/png", bytes: png, width: 1, height: 1 });
    expect(snapshot.assets).toHaveLength(1);
    expect((await backend.readAsset({ id: asset.id })).bytes).toEqual(png);
    const linked = object("city", "99999999-9999-4999-8999-999999999999", point([0, 0]), "素材都市");
    snapshot = await backend.replaceObjectLayer({ objects: [{ ...linked, assetId: asset.id }] });
    await expect(backend.deleteAsset({ id: asset.id })).rejects.toThrow();
    await backend.replaceObjectLayer({ objects: [] });
    snapshot = await backend.deleteAsset({ id: asset.id });
    expect(snapshot.assets).toEqual([]);
    await expect(backend.readAsset({ id: asset.id })).rejects.toThrow();
    await backend.closeProject();
    await expect(backend.getOpenProject()).resolves.toBeNull();
  });

  it("keeps the deprecated feature adapter restricted to object kinds", async () => {
    const backend = new MemoryRealmBackend([project("feature-adapter")]);
    await backend.openProject({ libraryId: "feature-adapter" });
    const created = await backend.createFeature({ featureType: "city", name: "都市", geometry: point([1, 1]) });
    const id = created.layers.objects[0]!.id;
    await expect(backend.createFeature({ featureType: "terrain", name: "地形", geometry: { type: "Polygon", coordinates: cellIdsToPolygonGeometries(["1:1"])[0]!.coordinates } })).rejects.toThrow();
    await backend.reviseFeature({ id, name: "更新都市", geometry: point([2, 2]) });
    await backend.setFeaturesLocked({ ids: [id], locked: true });
    await expect(backend.reviseFeature({ id, name: "拒否", geometry: point([3, 3]) })).rejects.toThrow();
    await expect(backend.deleteFeature({ id })).rejects.toThrow();
    await backend.setFeaturesLocked({ ids: [id], locked: false });
    await backend.deleteFeature({ id });
    await expect(backend.undoProject()).resolves.toMatchObject({ layers: { objects: [{ id }] } });
  });

  it("covers batch asset formats and empty history guards", async () => {
    const backend = new MemoryRealmBackend();
    await backend.createProject({ path: "batch-assets", name: "Batch assets" });
    await expect(backend.importAssetsBatch({ packName: "empty", assets: [] })).rejects.toThrow();
    await expect(backend.deleteAssetsBatch({ ids: [] })).rejects.toThrow();
    await expect(backend.deleteAssetsBatch({ ids: ["missing", "missing"] })).rejects.toThrow();
    await expect(backend.updateProjectSettings({ settings: undefined as never })).rejects.toThrow();
    await expect(backend.saveProject({ name: "" })).rejects.toThrow();

    const jpeg = [255, 216, 255];
    const webp = [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80];
    let snapshot = await backend.importAssetsBatch({
      packName: "images",
      assets: [
        { mime: "image/jpeg", bytes: jpeg, width: 1, height: 1 },
        { mime: "image/webp", bytes: webp, width: 1, height: 1 },
      ],
    });
    expect(snapshot.assets).toHaveLength(2);
    snapshot = await backend.importAssetsBatch({ packName: "images", assets: [{ mime: "image/jpeg", bytes: jpeg, width: 1, height: 1 }] });
    expect(snapshot.assets).toHaveLength(2);
    await expect(backend.importAsset({ mime: "image/png", bytes: [1, 2], width: 1, height: 1 })).rejects.toThrow();
    await expect(backend.importAsset({ mime: "image/png", bytes: [137, 80, 78, 71, 13, 10, 26, 10], width: 0, height: 1 })).rejects.toThrow();
    await expect(backend.undoProject()).resolves.toBeDefined();
    while ((await backend.getOpenProject())?.canUndo) await backend.undoProject();
    await expect(backend.undoProject()).rejects.toThrow();
    await expect(backend.redoProject()).resolves.toBeDefined();
    const imported = await backend.importProject({ path: "batch-assets" });
    expect(imported.path).not.toBe("batch-assets");
    await backend.closeProject();
    await expect(backend.redoProject()).rejects.toThrow();
  });
});
