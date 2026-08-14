import Feature from "ol/Feature";
import { describe, expect, it, vi } from "vitest";
import { RegionGrabController } from "./RegionGrabController";
import { clipRegionCellsToTerrain, connectedCellComponents, connectedRegionCells, sameCellSet, sameRegionCells, translateRegionCells } from "./regionGrab";
import { cellCenter, cellIdsWithinPaintPosition } from "./gridGeometry";

const region = (cellId: string, value: string, regionId = "region-a") => ({ cellId, attribute: "region" as const, value, regionId });
const terrain = (cellId: string) => ({ cellId, attribute: "terrain" as const, value: "terrain" });

describe("region grab geometry", () => {
  it("collects one same-ID hex-connected mass and excludes another region ID", () => {
    const cells = new Map([
      ["2:2", [region("2:2", "#AA0000")]],
      ["3:2", [region("3:2", "#AA0000")]],
      ["2:3", [region("2:3", "#AA0000")]],
      ["4:2", [region("4:2", "#00AA00", "region-b")]],
      ["20:20", [region("20:20", "#AA0000")]],
    ]);
    expect(connectedRegionCells("2:2", cells)).toEqual(["2:2", "3:2", "2:3"]);
    expect(connectedRegionCells("20:20", cells)).toEqual(["20:20"]);
    expect(sameRegionCells("2:2", cells)).toEqual(["2:2", "3:2", "2:3", "20:20"]);
    cells.set("21:20", [region("21:20", "#AA0000", "region-b")]);
    expect(sameRegionCells("2:2", cells)).not.toContain("21:20");
  });

  it("translates a mass using axial hex coordinates and rejects world overflow", () => {
    const source = ["2:2", "3:2", "2:3"];
    const target = translateRegionCells(source, "2:2", "5:3");
    expect(target).toEqual(["5:3", "6:3", "6:4"]);
    expect(sameCellSet(source, target ?? [])).toBe(false);
    expect(translateRegionCells(["127:72"], "127:72", "128:72")).toBeNull();
  });

  it("splits a cell set into independent six-neighbor components", () => {
    expect(connectedCellComponents(["10:10", "11:10", "20:20", "20:21", "invalid"])).toEqual([
      ["10:10", "11:10"],
      ["20:20", "20:21"],
    ]);
  });

  it("keeps only translated cells that have terrain", () => {
    const attributes = new Map([
      ["5:3", [terrain("5:3")]],
      ["6:3", [region("6:3", "#00AA00")]],
    ]);
    expect(clipRegionCellsToTerrain(["5:3", "6:3", "6:4"], attributes)).toEqual(["5:3"]);
  });

  it("previews only the terrain portion, emits one in-world move, and cancels an outside release", () => {
    const attributes = new Map([
      ["2:1", [region("2:1", "#AA0000")]],
      ["3:1", [region("3:1", "#AA0000")]],
      ["2:2", [region("2:2", "#AA0000")]],
      ["3:2", [region("3:2", "#AA0000")]],
      ["4:2", [region("4:2", "#AA0000")]],
      ["2:3", [{ cellId: "2:3", attribute: "terrain" as const, value: "terrain" }, region("2:3", "#AA0000")]],
      ["3:3", [region("3:3", "#AA0000")]],
      ["20:20", [region("20:20", "#AA0000")]],
      ["5:3", [terrain("5:3")]],
    ]);
    const features = new Map<string, Feature>();
    const emitted: Array<{ sourceCellIds: string[]; targetCellIds: string[] }> = [];
    const setRegionSmoothVisible = vi.fn();
    const controller = new RegionGrabController({
      cellAt: (position) => position[0] === 0 ? "3:2" : position[0] === 1 ? "5:3" : null,
      attributes: () => attributes,
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => { for (const id of ids) if (!features.has(id)) { const feature = new Feature(); feature.setId(id); features.set(id, feature); } },
      removeUnused: (id) => { if (!attributes.has(id)) features.delete(id); },
      changed: vi.fn(),
      setRegionSmoothVisible,
      emit: (input) => emitted.push(input),
      emitResize: vi.fn(),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: [0, 0] })).toBe(true);
    expect(setRegionSmoothVisible).toHaveBeenLastCalledWith(false);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [1, 0] });
    expect(features.get("5:3")?.get("grabPreview")).toBe(true);
    expect(features.get("6:3")).toBeUndefined();
    expect(interaction.handleUpEvent({ originalEvent: pointer, coordinate: [1, 0] })).toBe(false);
    expect(setRegionSmoothVisible).toHaveBeenLastCalledWith(true);
    expect(emitted).toEqual([{ sourceCellIds: ["2:1", "3:1", "2:2", "3:2", "4:2", "2:3", "3:3", "20:20"], targetCellIds: ["5:2", "6:2", "4:3", "5:3", "6:3", "5:4", "6:4", "22:21"] }]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: [0, 0] })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [2, 0] });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: [2, 0] });
    expect(emitted).toHaveLength(1);
    expect(features.get("2:2")?.get("grabPreview")).toBeUndefined();
    controller.dispose();
  });

  it("edits a boundary as one region-id cell update without creating a new region", () => {
    const regionId = "region-a";
    const attributes = new Map([
      ["10:10", [terrain("10:10"), region("10:10", "#AA0000", regionId)]],
      ["11:10", [terrain("11:10"), region("11:10", "#AA0000", regionId)]],
      ["10:11", [terrain("10:11"), region("10:11", "#AA0000", regionId)]],
      ["9:10", [terrain("9:10")]],
    ]);
    const features = new Map<string, Feature>();
    const resized: Array<{ cellIds: string[]; attribute: "region"; value: string | null; regionId?: string }> = [];
    const controller = new RegionGrabController({
      cellAt: (position) => cellIdsWithinPaintPosition(position, 0)[0] ?? null,
      attributes: () => attributes,
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => { for (const id of ids) if (!features.has(id)) { const feature = new Feature(); feature.setId(id); features.set(id, feature); } },
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      emit: vi.fn(),
      emitResize: (input) => resized.push(input as typeof resized[number]),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    const start = cellCenter(10, 10); const outside = cellCenter(10, 9); const inside = cellCenter(10, 11);
    expect(cellIdsWithinPaintPosition(start, 0)).toContain("10:10");
    expect(cellIdsWithinPaintPosition(outside, 0)).toContain("9:10");
    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: start })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: outside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId }]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: start })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: inside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: inside });
    expect(resized).toEqual([
      { cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId },
      { cellIds: ["11:10"], attribute: "region", value: null },
    ]);
    controller.dispose();
  });
});
