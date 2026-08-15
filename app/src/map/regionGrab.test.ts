import Feature from "ol/Feature";
import { describe, expect, it, vi } from "vitest";
import { RegionGrabController } from "./RegionGrabController";
import { adjacentCellIds, clipRegionCellsToTerrain, connectedCellComponents, connectedRegionCells, connectedTerrainCells, resizableCellIdsAt, sameCellSet, sameRegionCells, translateRegionCells } from "./regionGrab";
import { cellCenter, cellIdsWithinPaintPosition, parseCellId } from "./gridGeometry";

const region = (cellId: string, value: string, regionId = "region-a") => ({ cellId, attribute: "region" as const, value, regionId });
const terrain = (cellId: string) => ({ cellId, attribute: "terrain" as const, value: "terrain" });
const midpoint = (left: [number, number], right: [number, number]): [number, number] => [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];

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

  it("collects the six-connected terrain mass for boundary editing", () => {
    const cells = new Map([
      ["10:10", [terrain("10:10")]],
      ["11:10", [terrain("11:10")]],
      ["10:11", [terrain("10:11")]],
      ["20:20", [terrain("20:20")]],
    ]);
    expect(connectedTerrainCells("10:10", cells)).toEqual(["10:10", "11:10", "10:11"]);
    expect(connectedTerrainCells("20:20", cells)).toEqual(["20:20"]);
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

  it("marks only the inner hex edge under the pointer as pullable", () => {
    const center = cellCenter(10, 10);
    const ring = cellIdsWithinPaintPosition(center, 1).filter((id) => id !== "10:10");
    const attributes = new Map(ring.map((id) => [id, [region(id, "#AA0000")]]));
    expect(resizableCellIdsAt(center, attributes)).toEqual([]);
    const firstNeighbor = parseCellId(ring[0]!)!;
    expect(resizableCellIdsAt(midpoint(center, cellCenter(firstNeighbor[0], firstNeighbor[1])), attributes)).toEqual([ring[0]]);
  });

  it("does not treat a shared edge inside one terrain mass as pullable", () => {
    const center = cellCenter(10, 10);
    const neighbor = cellCenter(10, 11);
    const attributes = new Map([
      ["10:10", [terrain("10:10")]],
      ["11:10", [terrain("11:10")]],
    ]);
    expect(resizableCellIdsAt(midpoint(center, neighbor), attributes)).toEqual([]);
  });

  it("resolves every exposed terrain edge around a boundary cell", () => {
    const sourceId = "10:10";
    const source = cellCenter(10, 10);
    const attributes = new Map([[sourceId, [terrain(sourceId)]]]);
    for (const neighborId of adjacentCellIds(sourceId)) {
      const [row, column] = parseCellId(neighborId)!;
      expect(resizableCellIdsAt(midpoint(source, cellCenter(row, column)), attributes), neighborId).toContain(sourceId);
    }
  });

  it("does not turn an interior cell into an explicit grab handle", () => {
    const center = cellCenter(10, 10);
    const ring = cellIdsWithinPaintPosition(center, 1).filter((id) => id !== "10:10");
    const entries: Array<[string, ReturnType<typeof terrain>[]]> = [["10:10", [terrain("10:10")]]];
    for (const id of ring) entries.push([id, [terrain(id)]]);
    const attributes = new Map(entries);
    expect(resizableCellIdsAt(center, attributes, undefined, { interiorCellId: "10:10" })).toEqual([]);
  });

  it("keeps only translated cells that have terrain", () => {
    const attributes = new Map([
      ["5:3", [terrain("5:3")]],
      ["6:3", [region("6:3", "#00AA00")]],
    ]);
    expect(clipRegionCellsToTerrain(["5:3", "6:3", "6:4"], attributes)).toEqual(["5:3"]);
  });

  it("rejects an overlapping region move and restores the canonical preview", () => {
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
      ["6:3", [region("6:3", "#00AA00", "region-b")]],
    ]);
    const features = new Map<string, Feature>();
    const sourceFeature = new Feature(); sourceFeature.setId("2:1"); features.set("2:1", sourceFeature);
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
    expect(setRegionSmoothVisible).toHaveBeenLastCalledWith(false, "region-a");
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [1, 0] });
    expect(features.get("5:3")?.get("grabPreview")).toBeUndefined();
    expect(features.get("6:4")?.get("grabPreview")).toBeUndefined();
    expect(features.get("6:3")).toBeUndefined();
    expect(interaction.handleUpEvent({ originalEvent: pointer, coordinate: [1, 0] })).toBe(false);
    expect(setRegionSmoothVisible).toHaveBeenLastCalledWith(true);
    expect(features.get("2:1")?.get("attributes")).toEqual([region("2:1", "#AA0000")]);
    expect(features.get("5:3")).toBeUndefined();
    expect(features.get("6:4")).toBeUndefined();
    expect(emitted).toEqual([]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: [0, 0] })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [2, 0] });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: [2, 0] });
    expect(emitted).toHaveLength(0);
    expect(features.get("2:2")?.get("grabPreview")).toBeUndefined();
    controller.dispose();
  });

  it("edits a boundary as one region-id cell update without creating a new region", () => {
    const regionId = "region-a";
    const attributes = new Map([
      ["10:10", [terrain("10:10"), region("10:10", "#AA0000", regionId)]],
      ["11:10", [terrain("11:10"), region("11:10", "#AA0000", regionId)]],
      ["10:11", [terrain("10:11"), region("10:11", "#AA0000", regionId)]],
      ["9:10", []],
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
    const start = cellCenter(10, 10); const outside = cellCenter(10, 9); const inside = cellCenter(10, 11); const boundary = midpoint(start, outside);
    expect(cellIdsWithinPaintPosition(start, 0)).toContain("10:10");
    expect(cellIdsWithinPaintPosition(outside, 0)).toContain("9:10");
    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    expect(features.get("9:10")?.get("grabPreview")).toBe(true);
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: outside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId }]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: inside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: inside });
    expect(resized).toEqual([
      { cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId },
      { cellIds: ["11:10"], attribute: "region", value: null },
    ]);
    controller.dispose();
  });

  it("does not move an interior region cell when boundary-only mode is active", () => {
    const ring = cellIdsWithinPaintPosition(cellCenter(10, 10), 1);
    const attributes = new Map(ring.map((id) => [id, [region(id, "#AA0000")]]));
    const emitted: unknown[] = [];
    const controller = new RegionGrabController({
      cellAt: () => "10:10",
      allowMove: false,
      attributes: () => attributes,
      getFeature: () => undefined,
      ensureFeatures: () => undefined,
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      emit: (input) => emitted.push(input),
      emitResize: vi.fn(),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean };
    expect(interaction.handleDownEvent({ originalEvent: { isPrimary: true, button: 0 }, coordinate: cellCenter(10, 10) })).toBe(false);
    expect(emitted).toHaveLength(0);
    controller.dispose();
  });

  it("allows explicit grab mode to resize a region from inside its boundary cell", () => {
    const attributes = new Map([["10:10", [region("10:10", "#AA0000")]]]);
    const resized: unknown[] = [];
    const controller = new RegionGrabController({
      cellAt: (position) => cellIdsWithinPaintPosition(position, 0)[0] ?? null,
      allowMove: true,
      allowInteriorBoundaryPress: true,
      attributes: () => attributes,
      getFeature: () => undefined,
      ensureFeatures: () => undefined,
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      emit: vi.fn(),
      emitResize: (input) => resized.push(input),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    const start = cellCenter(10, 10);
    const outside = cellCenter(10, 9);
    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: start })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: outside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId: "region-a" }]);
    controller.dispose();
  });

  it("keeps the pointer's target cell when a real drag is off the mathematical centre line", () => {
    const attributes = new Map([["10:10", [region("10:10", "#AA0000")]]]);
    const features = new Map<string, Feature>();
    const resized: unknown[] = [];
    const controller = new RegionGrabController({
      cellAt: (position) => cellIdsWithinPaintPosition(position, 0)[0] ?? null,
      allowMove: true,
      allowInteriorBoundaryPress: true,
      attributes: () => attributes,
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => { for (const id of ids) if (!features.has(id)) { const feature = new Feature(); feature.setId(id); features.set(id, feature); } },
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      emit: vi.fn(),
      emitResize: (input) => resized.push(input),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    const start = cellCenter(10, 10);
    const outside = cellCenter(10, 9);
    const offset: [number, number] = [0.2, 0.15];
    const shiftedStart: [number, number] = [start[0] + offset[0], start[1] + offset[1]];
    const shiftedOutside: [number, number] = [outside[0] + offset[0], outside[1] + offset[1]];

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: shiftedStart })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: shiftedOutside });
    expect(features.get("9:10")?.get("grabPreview")).toBe(true);
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: shiftedOutside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "region", value: "#AA0000", regionId: "region-a" }]);
    controller.dispose();
  });

  it("pulls a neighboring terrain boundary when the nearest cell only has a region", () => {
    const center = "10:10";
    const ring = cellIdsWithinPaintPosition(cellCenter(10, 10), 1).filter((id) => id !== center);
    const terrainId = ring[0]!;
    const attributes = new Map<string, Array<ReturnType<typeof region> | ReturnType<typeof terrain>>>();
    for (const id of ring) attributes.set(id, [region(id, "#AA0000")]);
    attributes.set(center, [region(center, "#AA0000")]);
    attributes.set(terrainId, [region(terrainId, "#AA0000"), terrain(terrainId)]);
    const setTerrainSmoothVisible = vi.fn();
    const controller = new RegionGrabController({
      cellAt: () => center,
      cellCandidatesAt: () => [center, ...ring],
      allowMove: false,
      attributes: () => attributes,
      getFeature: () => undefined,
      ensureFeatures: () => undefined,
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      setTerrainSmoothVisible,
      emit: vi.fn(),
      emitResize: vi.fn(),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean };
    const boundary = midpoint(cellCenter(10, 10), cellCenter(parseCellId(terrainId)![0], parseCellId(terrainId)![1]));
    expect(interaction.handleDownEvent({ originalEvent: { isPrimary: true, button: 0 }, coordinate: boundary })).toBe(true);
    expect(setTerrainSmoothVisible).toHaveBeenCalledWith(false, [terrainId]);
    controller.dispose();
  });

  it("expands and retracts a terrain boundary as one cell-layer update", () => {
    const attributes = new Map([
      ["10:10", [terrain("10:10")]],
      ["11:10", [terrain("11:10")]],
      ["10:11", [terrain("10:11")]],
    ]);
    const features = new Map<string, Feature>();
    const resized: Array<{ cellIds: string[]; attribute: "terrain"; value: string | null }> = [];
    const setTerrainSmoothVisible = vi.fn();
    const controller = new RegionGrabController({
      cellAt: (position) => cellIdsWithinPaintPosition(position, 0)[0] ?? null,
      attributes: () => attributes,
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => { for (const id of ids) if (!features.has(id)) { const feature = new Feature(); feature.setId(id); features.set(id, feature); } },
      removeUnused: () => undefined,
      changed: vi.fn(),
      setRegionSmoothVisible: vi.fn(),
      setTerrainSmoothVisible,
      emit: vi.fn(),
      emitResize: (input) => resized.push(input as typeof resized[number]),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    const start = cellCenter(10, 10); const outside = cellCenter(10, 9); const inside = cellCenter(10, 11); const boundary = midpoint(start, outside);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    expect(features.get("9:10")?.get("grabPreview")).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: start });
    expect(features.get("9:10")?.get("grabPreview")).toBeUndefined();
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: start });
    expect(resized).toHaveLength(0);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: outside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "terrain", value: "terrain" }]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: inside });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: inside });
    expect(resized).toEqual([
      { cellIds: ["9:10"], attribute: "terrain", value: "terrain" },
      { cellIds: ["11:10"], attribute: "terrain", value: null },
    ]);
    expect(setTerrainSmoothVisible).toHaveBeenCalledWith(false, expect.arrayContaining(["10:10"]));
    expect(setTerrainSmoothVisible).toHaveBeenCalledWith(true);
    controller.dispose();
  });
});
