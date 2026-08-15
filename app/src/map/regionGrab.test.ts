import { describe, expect, it } from "vitest";
import { adjacentCellIds, connectedCellComponents, connectedRegionCells, connectedTerrainCells, sameRegionCells, translateRegionCells } from "./regionGrab";

const region = (cellId: string, regionId = "region-a") => ({ cellId, attribute: "region" as const, value: "#AA0000", regionId });
const terrain = (cellId: string) => ({ cellId, attribute: "terrain" as const, value: "terrain" });

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
});
