import { describe, expect, it } from "vitest";
import {
  applyCellSelectionToMapShapes,
  cellIdsToPolygonGeometries,
  mapShapeCellIds,
  mapShapesToCellAttributes,
  moveRegionMapShapes,
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
  it("stores one Polygon for one connected surface and reconstructs transient cells", () => {
    const shape = terrain(["1:1", "2:1"]);
    validateMapShapes([shape]);
    expect(mapShapeCellIds(shape)).toEqual(new Set(["1:1", "2:1"]));
    expect(mapShapesToCellAttributes([shape])).toEqual([
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
    const expanded = applyCellSelectionToMapShapes([original], { cellIds: ["6:5"], layer: "terrain", value: "terrain" });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(expanded[0]!)).toEqual(new Set(["5:5", "6:5"]));
    const retracted = applyCellSelectionToMapShapes(expanded, { cellIds: ["6:5"], layer: "terrain", value: null });
    expect(retracted).toHaveLength(1);
    expect(retracted[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(retracted[0]!)).toEqual(new Set(["5:5"]));
  });

  it("translates every disconnected region part while retaining each shape id", () => {
    const regionId = "77777777-7777-4777-8777-777777777777";
    const first = region(["5:5", "6:5"], regionId, "88888888-8888-4888-8888-888888888888");
    const second = region(["20:20"], regionId, "99999999-9999-4999-8999-999999999999");
    const moved = moveRegionMapShapes([first, second], regionId, ["5:5", "6:5", "20:20"], ["25:25", "26:25", "40:40"]);
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
