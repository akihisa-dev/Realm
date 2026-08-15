import { describe, expect, it } from "vitest";
import { MemoryRealmBackend } from "./memoryRealmBackend";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../shared/mapShapeGeometry";
import type { MapShape, RealmSnapshot } from "./types";

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

const project = (path = "memory-project"): RealmSnapshot => ({
  formatVersion: 11,
  path,
  world: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "テスト世界" },
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
});
