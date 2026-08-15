import { describe, expect, it } from "vitest";
import {
  applyGridSelectionToMapShapes,
  cellIdsToPolygonGeometries,
  differenceMapShapeGeometry,
  intersectionMapShapeGeometries,
  mapShapeCellIds,
  deriveMapGridCells,
  mapShapeCellCenter,
  normalizeMapShapes,
  normalizeResizedMapShapeGeometry,
  translateMapShapeGeometry,
  unionMapShapeGeometries,
  hitTestMapShapeGeometry,
  resizeMapShapeGeometry,
  validateMapShapes,
} from "./mapShapeGeometry";
import type { MapShape } from "./realmContract";

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

describe("grid-snapped continuous map shapes", () => {
  it("bridges a narrow distant vertex pull instead of creating disconnected cells", () => {
    const original = terrain(["30:30"]);
    const ring = original.geometry.coordinates[0]!;
    const preview = resizeMapShapeGeometry(original.geometry, { kind: "vertex", ringIndex: 0, vertexIndex: 0, distance: 0 }, ring[0]!, [ring[0]![0], ring[0]![1] - 42]);
    const normalized = normalizeResizedMapShapeGeometry(original.geometry, preview);
    expect(normalized).toHaveLength(1);
    const cells = mapShapeCellIds({ geometry: normalized[0]! });
    expect(cells).toContain("30:30");
    expect(cells).toContain("30:13");
    expect(cells.size).toBeGreaterThan(1);
    const remaining = new Set(cells);
    const queue = ["30:30"];
    remaining.delete("30:30");
    for (let index = 0; index < queue.length; index += 1) {
      const [column = 0, row = 0] = queue[index]!.split(":").map(Number);
      const axialQ = column - Math.floor(row / 2);
      for (const [dq = 0, drow = 0] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
        const next = `${axialQ + dq + Math.floor((row + drow) / 2)}:${row + drow}`;
        if (remaining.delete(next)) queue.push(next);
      }
    }
    expect(remaining).toHaveLength(0);
  });

  it("does not grow neighboring cells for a small vertex adjustment", () => {
    const original = terrain(["30:30"]);
    const ring = original.geometry.coordinates[0]!;
    const preview = resizeMapShapeGeometry(original.geometry, { kind: "vertex", ringIndex: 0, vertexIndex: 0, distance: 0 }, ring[0]!, [ring[0]![0], ring[0]![1] - 0.2]);
    const normalized = normalizeResizedMapShapeGeometry(original.geometry, preview);
    expect(mapShapeCellIds({ geometry: normalized[0]! })).toEqual(new Set(["30:30"]));
  });

  it("stores one Polygon for one connected surface and reconstructs transient cells", () => {
    const shape = terrain(["1:1", "2:1"]);
    validateMapShapes([shape]);
    expect(mapShapeCellIds(shape)).toEqual(new Set(["1:1", "2:1"]));
    expect(deriveMapGridCells([shape])).toEqual([
      { cellId: "1:1", attribute: "terrain", value: "terrain" },
      { cellId: "2:1", attribute: "terrain", value: "terrain" },
    ]);
  });

  it("keeps concave, holed, and disconnected surfaces valid", () => {
    const concave = terrain(["2:2", "3:2", "4:2", "2:3", "2:4", "3:4", "4:4"]);
    validateMapShapes([concave]);
    const holedCells = ["2:2", "3:2", "4:2", "2:3", "4:3", "2:4", "3:4", "4:4"];
    const holed = terrain(holedCells);
    validateMapShapes([holed]);
    expect(holed.geometry.coordinates.length).toBeGreaterThan(1);
    const disconnected = cellIdsToPolygonGeometries(["1:1", "20:20"]);
    expect(disconnected).toHaveLength(2);
  });

  it("expands and retracts a shape through cell operations while retaining its id", () => {
    const original = terrain(["5:5"], "44444444-4444-4444-8444-444444444444");
    const expanded = applyGridSelectionToMapShapes([original], { cellIds: ["6:5"], layer: "terrain", value: "terrain" });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(expanded[0]!)).toEqual(new Set(["5:5", "6:5"]));
    const retracted = applyGridSelectionToMapShapes(expanded, { cellIds: ["6:5"], layer: "terrain", value: null });
    expect(retracted).toHaveLength(1);
    expect(retracted[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(retracted[0]!)).toEqual(new Set(["5:5"]));
  });

  it("uses Polygon boolean operations for grid selection without persisting cell rows", () => {
    const first = cellIdsToPolygonGeometries(["10:10", "11:10"])[0]!;
    const second = cellIdsToPolygonGeometries(["11:10", "12:10"])[0]!;
    expect(mapShapeCellIds({ geometry: unionMapShapeGeometries([first, second])[0]! })).toEqual(new Set(["10:10", "11:10", "12:10"]));
    expect(mapShapeCellIds({ geometry: differenceMapShapeGeometry(first, [second])[0]! })).toEqual(new Set(["10:10"]));
    expect(mapShapeCellIds({ geometry: intersectionMapShapeGeometries(first, second)[0]! })).toEqual(new Set(["11:10"]));
  });

  it("previews exact edge and vertex edits continuously, then snaps the result at commit", () => {
    const original = terrain(["10:10", "11:10"]);
    const ring = original.geometry.coordinates[0]!;
    const edge = ring[0] && ring[1] ? [
      (ring[0][0] + ring[1][0]) / 2,
      (ring[0][1] + ring[1][1]) / 2,
    ] as [number, number] : null;
    expect(edge).not.toBeNull();
    const edgeHit = hitTestMapShapeGeometry(original.geometry, edge!, 0.001);
    expect(edgeHit?.kind).toBe("edge");
    const preview = resizeMapShapeGeometry(original.geometry, edgeHit!, edge!, [edge![0], edge![1] + 4]);
    expect(preview).not.toEqual(original.geometry);
    const normalized = normalizeMapShapes([{ ...original, geometry: preview }]);
    expect(normalized).toHaveLength(1);
    validateMapShapes(normalized);

    const vertex = ring[0]!;
    const vertexHit = hitTestMapShapeGeometry(original.geometry, vertex, 0.001);
    expect(vertexHit?.kind).toBe("vertex");
    const vertexPreview = resizeMapShapeGeometry(original.geometry, vertexHit!, vertex, [vertex[0] + 2, vertex[1] + 1]);
    expect(vertexPreview.coordinates[0]?.at(-1)).toEqual(vertexPreview.coordinates[0]?.[0]);
  });

  it("normalizes a continuous move to the target grid cell while retaining the shape id", () => {
    const original = terrain(["5:5"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const source = mapShapeCellCenter({ row: 5, column: 5 });
    const target = mapShapeCellCenter({ row: 5, column: 6 });
    const moved = normalizeMapShapes([{ ...original, geometry: translateMapShapeGeometry(original.geometry, [target[0] - source[0], target[1] - source[1]]) }]);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(moved[0]!)).toEqual(new Set(["6:5"]));
  });

  it("merges touching shapes that share one canonical identity while retaining one existing id", () => {
    const first = terrain(["5:5"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const second = terrain(["6:5"], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(() => validateMapShapes([first, second])).toThrow();
    const merged = normalizeMapShapes([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(first.id);
    expect(mapShapeCellIds(merged[0]!)).toEqual(new Set(["5:5", "6:5"]));
  });

  it("rejects a continuous move that crosses the bounded world instead of clipping or deleting the shape", () => {
    const original = terrain(["0:0"]);
    expect(() => normalizeMapShapes([{ ...original, geometry: translateMapShapeGeometry(original.geometry, [-10, 0]) }])).toThrow();
  });

  it("translates every disconnected region part while retaining each shape id", () => {
    const regionId = "77777777-7777-4777-8777-777777777777";
    const first = region(["5:5", "6:5"], regionId, "88888888-8888-4888-8888-888888888888");
    const second = region(["20:20"], regionId, "99999999-9999-4999-8999-999999999999");
    const source = mapShapeCellCenter({ row: 5, column: 5 });
    const target = mapShapeCellCenter({ row: 25, column: 25 });
    const offset: [number, number] = [target[0] - source[0], target[1] - source[1]];
    const moved = normalizeMapShapes([first, second].map((shape) => ({ ...shape, geometry: translateMapShapeGeometry(shape.geometry, offset) })));
    expect(moved.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(moved.map(mapShapeCellIds)).toEqual([
      new Set(["25:25", "26:25"]),
      new Set(["40:40"]),
    ]);
    validateMapShapes(moved);
  });

  it("allows world-edge polygons and rejects self-intersection and overlap", () => {
    validateMapShapes([terrain(["0:0"])]);
    const first = region(["10:10"]);
    const second = region(["10:10"], "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666");
    expect(() => validateMapShapes([first, second])).toThrow();
    const invalid: MapShape = { ...first, geometry: { type: "Polygon", coordinates: [[[-10, -10], [10, 10], [-10, 10], [10, -10], [-10, -10]] as [number, number][]] } };
    expect(() => validateMapShapes([invalid])).toThrow();
  });
});
