import { describe, expect, it } from "vitest";
import { MemoryRealmBackend } from "./memoryRealmBackend";
import { cellIdsToPolygonGeometries } from "../shared/mapShapeGeometry";
import { mapShapesFromLayers } from "../shared/layerProjection";
import { flattenLayerTree } from "../shared/layerTree";
import type { MapObject, RealmSnapshot } from "./types";

const polygon = (cells: string[]) => cellIdsToPolygonGeometries(cells)[0]!;
const LEAF_LAYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const point = (coordinates: [number, number]): MapObject["geometry"] => ({ type: "Point", coordinates });
const object = (kind: MapObject["kind"], id: string, geometry: MapObject["geometry"], label: string = kind): MapObject => ({ id, layerId: LEAF_LAYER, kind, geometry, label, properties: {}, zIndex: 0, locked: false });

const project = (path = "memory-project"): RealmSnapshot => ({
  formatVersion: 13,
  path,
  world: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "テスト世界" },
  layerTree: { nodes: [{ id: LEAF_LAYER, parentId: null, kind: "leaf", name: "レイヤー1", order: 0, visible: true, locked: false }] },
  layers: { terrain: [], regions: [], objects: [] },
  assets: [],
  settings: { themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} },
  canUndo: false,
  canRedo: false,
});

describe("MemoryRealmBackend canonical three-layer model", () => {
  it("round-trips group and leaf hierarchy and inherits parent visibility/lock", async () => {
    const backend = new MemoryRealmBackend([project("tree")]);
    await backend.openProject({ libraryId: "tree" });
    const group = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const leaf = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const tree = { nodes: [
      { id: group, parentId: null, kind: "group" as const, name: "Group", order: 0, visible: false, locked: true },
      { id: leaf, parentId: group, kind: "leaf" as const, name: "Leaf", order: 0, visible: true, locked: false },
    ] };
    const saved = await backend.replaceLayerTree({ tree });
    expect(saved.layerTree).toEqual(tree);
    const child = flattenLayerTree(saved.layerTree!)[1]!;
    expect(child).toMatchObject({ id: leaf, effectiveVisible: false, effectiveLocked: true });
  });

  it("rejects deleting a leaf that still owns typed content", async () => {
    const backend = new MemoryRealmBackend([project("delete-leaf")]);
    await backend.openProject({ libraryId: "delete-leaf" });
    await backend.replaceTerrainLayer({ shapes: [{ id: "11111111-1111-4111-8111-111111111111", layerId: LEAF_LAYER, geometry: polygon(["1:1"]) }] });
    await expect(backend.replaceLayerTree({ tree: { nodes: [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", parentId: null, kind: "group", name: "Group", order: 0, visible: true, locked: false },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", parentId: null, kind: "leaf", name: "Other", order: 1, visible: true, locked: false },
    ] } })).rejects.toThrow("地物");
  });

  it("stores mixed typed content in one replaceMapContent undo unit", async () => {
    const backend = new MemoryRealmBackend([project("mixed-content")]);
    await backend.openProject({ libraryId: "mixed-content" });
    const mixed = await backend.replaceMapContent({ layers: {
      terrain: [{ id: "11111111-1111-4111-8111-111111111111", layerId: LEAF_LAYER, geometry: polygon(["1:1"]) }],
      regions: [{ id: "22222222-2222-4222-8222-222222222222", layerId: LEAF_LAYER, name: "Region", color: "#2468AC", shapes: [{ id: "33333333-3333-4333-8333-333333333333", layerId: LEAF_LAYER, geometry: polygon(["2:2"]) }] }],
      objects: [object("city", "44444444-4444-4444-8444-444444444444", point([1, 2]))],
    } });
    expect(mixed.canUndo).toBe(true);
    const undone = await backend.undoProject();
    expect(undone.layers).toEqual({ terrain: [], regions: [], objects: [] });
    expect(undone.canRedo).toBe(true);
  });

  it("replaces each layer independently and restores complete snapshots with undo/redo", async () => {
    const backend = new MemoryRealmBackend([project()]);
    await backend.openProject({ libraryId: "memory-project" });
    const terrain = { id: "11111111-1111-4111-8111-111111111111", layerId: LEAF_LAYER, geometry: polygon(["2:2"]) };
    const region = { id: "22222222-2222-4222-8222-222222222222", layerId: LEAF_LAYER, name: "青の領域", color: "#2468AC", shapes: [{ id: "33333333-3333-4333-8333-333333333333", layerId: LEAF_LAYER, geometry: polygon(["5:5"]) }] };

    let snapshot = await backend.replaceTerrainLayer({ shapes: [terrain] });
    snapshot = await backend.replaceRegionLayer({ regions: [region] });
    expect(snapshot.layers.terrain).toEqual([terrain]);
    expect(snapshot.layers.regions).toEqual([region]);
    expect(mapShapesFromLayers(snapshot.layers)).toHaveLength(2);

    const expanded = { ...terrain, geometry: polygon(["2:2", "3:2"]) };
    snapshot = await backend.replaceTerrainLayer({ shapes: [expanded] });
    expect(snapshot.canUndo).toBe(true);
    snapshot = await backend.undoProject();
    expect(snapshot.layers.terrain).toEqual([terrain]);
    snapshot = await backend.redoProject();
    expect(snapshot.layers.terrain).toEqual([expanded]);
  });

  it("rejects overlap within one layer but permits cross-layer and object overlap", async () => {
    const backend = new MemoryRealmBackend([project("overlap")]);
    await backend.openProject({ libraryId: "overlap" });
    const first = { id: "11111111-1111-4111-8111-111111111111", geometry: polygon(["2:2"]) };
    await backend.replaceTerrainLayer({ shapes: [first] });
    await expect(backend.replaceTerrainLayer({ shapes: [first, { id: "44444444-4444-4444-8444-444444444444", geometry: first.geometry }] })).rejects.toThrow();
    await expect(backend.replaceRegionLayer({ regions: [{ id: "55555555-5555-4555-8555-555555555555", name: "領域", color: "#2468AC", shapes: [{ id: "66666666-6666-4666-8666-666666666666", geometry: first.geometry }] }] })).resolves.toBeDefined();
    const samePoint = point([1, 2]);
    await expect(backend.replaceObjectLayer({ objects: [object("city", "77777777-7777-4777-8777-777777777777", samePoint), object("text", "88888888-8888-4888-8888-888888888888", samePoint)] })).resolves.toBeDefined();
  });

  it("validates all four object kinds and keeps object ordering in the object layer", async () => {
    const backend = new MemoryRealmBackend([project("objects")]);
    await backend.openProject({ libraryId: "objects" });
    const objects = [
      object("city", "44444444-4444-4444-8444-444444444444", point([1, 2]), "都市"),
      object("text", "55555555-5555-4555-8555-555555555555", point([1, 2]), "文字"),
      object("mountain", "66666666-6666-4666-8666-666666666666", point([10, 20]), "山"),
      object("forest", "77777777-7777-4777-8777-777777777777", polygon(["8:8", "9:8"]), "森"),
    ];
    let snapshot = await backend.replaceObjectLayer({ objects });
    expect(snapshot.layers.objects.map(({ kind }) => kind)).toEqual(["city", "text", "mountain", "forest"]);
    await expect(backend.replaceObjectLayer({ objects: [{ ...objects[0]!, kind: "forest", geometry: point([1, 2]) }] })).rejects.toThrow();
    snapshot = await backend.replaceObjectLayer({ objects: [{ ...objects[0]!, geometry: point([2, 3]) }, ...objects.slice(1)] });
    expect(snapshot.layers.objects[0]?.geometry).toEqual(point([2, 3]));
  });

  it("does not allow a locked object to be changed or removed", async () => {
    const backend = new MemoryRealmBackend([project("locked")]);
    await backend.openProject({ libraryId: "locked" });
    const locked = object("city", "99999999-9999-4999-8999-999999999999", point([1, 2]), "固定都市");
    locked.locked = true;
    await backend.replaceObjectLayer({ objects: [locked] });
    await expect(backend.replaceObjectLayer({ objects: [{ ...locked, label: "変更" }] })).rejects.toThrow("ロック");
    await expect(backend.replaceObjectLayer({ objects: [] })).rejects.toThrow("ロック");
    await expect(backend.replaceObjectLayer({ objects: [locked] })).resolves.toBeDefined();
  });

  it("validates memory lifecycle, settings, and local asset references", async () => {
    const backend = new MemoryRealmBackend();
    await expect(backend.getOpenProject()).resolves.toBeNull();
    await expect(backend.saveProject({ name: "未開" })).rejects.toThrow();
    let snapshot = await backend.createProject({ path: "lifecycle", name: "  ライフサイクル  " });
    expect(snapshot.world.name).toBe("ライフサイクル");
    const settings = { ...snapshot.settings, gridKind: "hex" as const };
    snapshot = await backend.updateProjectSettings({ settings });
    expect(snapshot.settings.gridKind).toBe("hex");
    const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
    snapshot = await backend.importAsset({ mime: "image/png", bytes: png, width: 1, height: 1 });
    const asset = snapshot.assets[0]!;
    await backend.replaceObjectLayer({ objects: [{ ...object("city", "99999999-9999-4999-8999-999999999999", point([0, 0])), layerId: snapshot.layerTree?.nodes.find((node) => node.kind === "leaf")?.id ?? LEAF_LAYER, assetId: asset.id }] });
    await expect(backend.deleteAsset({ id: asset.id })).rejects.toThrow();
    await backend.replaceObjectLayer({ objects: [] });
    snapshot = await backend.deleteAsset({ id: asset.id });
    expect(snapshot.assets).toEqual([]);
    await backend.closeProject();
    await expect(backend.getOpenProject()).resolves.toBeNull();
  });
});
