import { describe, expect, it } from "vitest";
import { cellCenter, cellPolygon } from "./gridGeometry";
import { adjacentCellIds, clipRegionCellsToTerrain, connectedCellComponents, connectedRegionCells, connectedTerrainCells, isRegionBoundaryCell, regionResizeStroke, resizableCellIdsAt, sameCellSet, sameRegionCells, translateRegionCells } from "./regionGrab";

const region = (cellId: string, regionId = "region-a") => ({ cellId, layer: "region" as const, value: "#AA0000", regionId });
const terrain = (cellId: string) => ({ cellId, layer: "terrain" as const, value: "terrain" });

describe("transient grid derivation", () => {
  it("collects connected and disconnected components without making them persistent", () => {
    const attributes = new Map([
      ["2:2", [region("2:2")]], ["3:2", [region("3:2")]], ["2:3", [region("2:3")]],
      ["20:20", [region("20:20")]], ["4:2", [region("4:2", "region-b")]],
    ]);
    expect(connectedRegionCells("2:2", attributes)).toEqual(["2:2", "3:2", "2:3"]);
    expect(sameRegionCells("2:2", attributes)).toEqual(["2:2", "3:2", "2:3", "20:20"]);
    expect(connectedCellComponents(["10:10", "11:10", "20:20", "20:21", "invalid"])).toEqual([["10:10", "11:10"], ["20:20", "20:21"]]);
  });

  it("derives terrain components and fixed-grid translations for temporary selection only", () => {
    const attributes = new Map([["10:10", [terrain("10:10")]], ["11:10", [terrain("11:10")]], ["20:20", [terrain("20:20")]]]);
    expect(connectedTerrainCells("10:10", attributes)).toEqual(["10:10", "11:10"]);
    expect(translateRegionCells(["2:2", "3:2"], "2:2", "5:3")).toEqual(["5:3", "6:3"]);
    expect(translateRegionCells(["127:72"], "127:72", "128:72")).toBeNull();
    expect(adjacentCellIds("10:10")).toHaveLength(6);
  });

  it("returns empty results for missing identities and malformed cell ids", () => {
    const attributes = new Map([["10:10", [terrain("10:10")]]]);
    expect(adjacentCellIds("invalid")).toEqual([]);
    expect(connectedCellComponents([])).toEqual([]);
    expect(connectedRegionCells("10:10", attributes)).toEqual([]);
    expect(connectedTerrainCells("invalid", attributes)).toEqual([]);
    expect(sameRegionCells("10:10", attributes)).toEqual([]);
    expect(translateRegionCells([], "10:10", "11:11")).toBeNull();
    expect(translateRegionCells(["invalid"], "10:10", "11:11")).toBeNull();
  });

  it("recognizes region boundaries and filters regions to the terrain layer", () => {
    const attributes = new Map([
      ["10:10", [terrain("10:10"), region("10:10")]],
      ["11:10", [terrain("11:10"), region("11:10")]],
      ["12:10", [region("12:10")]],
    ]);
    expect(isRegionBoundaryCell("10:10", ["10:10", "11:10"])).toBe(true);
    expect(isRegionBoundaryCell("11:10", ["10:10", "11:10"])).toBe(true);
    expect(isRegionBoundaryCell("12:10", ["10:10", "11:10"])).toBe(false);
    expect(isRegionBoundaryCell("invalid", ["invalid"])).toBe(false);
    expect(clipRegionCellsToTerrain(["10:10", "11:10", "12:10"], attributes)).toEqual(["10:10", "11:10"]);
    expect(sameCellSet(["10:10", "11:10"], ["11:10", "10:10"])).toBe(true);
    expect(sameCellSet(["10:10"], ["10:10", "11:10"])).toBe(false);
  });

  it("finds boundary grab targets and supports explicit interior targets", () => {
    const id = "10:10";
    const attributes = new Map([[id, [terrain(id), region(id)]]]);
    const boundary = cellPolygon(10, 10)![0]!;
    expect(resizableCellIdsAt(boundary, attributes, [id])).toEqual([id]);
    expect(resizableCellIdsAt([0, 0], attributes, [], { interiorCellId: id })).toEqual([id]);
    expect(resizableCellIdsAt([0, 0], new Map(), [id])).toEqual([]);
    expect(regionResizeStroke([cellCenter(10, 10), cellCenter(10, 11)], 0)).not.toEqual([]);
    expect(regionResizeStroke([], 0)).toEqual([]);
  });
});
