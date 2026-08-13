import { MAX_DRAW_COORDINATES, MAX_SMOOTHING_PASSES, MIN_POLYGON_AREA, refineDrawnGeometry, snapPositionToAngle } from "./drawingGeometry";
import type { GeoJsonGeometry } from "../backend/types";

describe("refineDrawnGeometry", () => {
  it("keeps valid point features unchanged", () => {
    const point = { type: "Point", coordinates: [12, -4] as [number, number] } as const;
    expect(refineDrawnGeometry("city", point, 1)).toBe(point);
  });

  it("rejects non-finite and out-of-world coordinates", () => {
    expect(() => refineDrawnGeometry("city", { type: "Point", coordinates: [Number.NaN, 0] }, 1)).toThrow("drawing_outside_world");
    expect(() => refineDrawnGeometry("city", { type: "Point", coordinates: [181, 0] }, 1)).toThrow("drawing_outside_world");
    expect(() => refineDrawnGeometry("river", { type: "LineString", coordinates: [[0, 0], [Infinity, 1]] }, 1)).toThrow("drawing_outside_world");
  });

  it("uses resolution-based RDP while preserving line endpoints", () => {
    const noisy = Array.from({ length: 80 }, (_, index): [number, number] => [index / 10, Math.sin(index / 7) * 0.001]);
    noisy[0] = [-10, 0];
    noisy[noisy.length - 1] = [10, 0];
    const coarse = refineDrawnGeometry("river", { type: "LineString", coordinates: noisy }, 0.1);
    const fine = refineDrawnGeometry("river", { type: "LineString", coordinates: noisy }, 0.000_001);
    if (coarse.type !== "LineString" || fine.type !== "LineString") throw new Error("Expected lines.");
    expect(coarse.coordinates[0]).toEqual([-10, 0]);
    expect(coarse.coordinates.at(-1)).toEqual([10, 0]);
    expect(coarse.coordinates.length).toBeLessThan(fine.coordinates.length);
  });

  it("preserves a closed, smoothed landmass ring and its bounds", () => {
    const refined = refineDrawnGeometry("terrain", {
      type: "Polygon",
      coordinates: [[[-20, -10], [20, -10], [20, 10], [-20, 10], [-20, -10]]],
    }, 0.25);
    if (refined.type !== "Polygon") throw new Error("Expected polygon.");
    const ring = refined.coordinates[0]!;
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.length).toBeGreaterThan(5);
    expect(ring.every(([x, y]) => x >= -20 && x <= 20 && y >= -10 && y <= 10)).toBe(true);
  });

  it("repairs an open polygon ring before refinement", () => {
    const refined = refineDrawnGeometry("country", {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [0, 1]]],
    }, Number.NaN);
    if (refined.type !== "Polygon") throw new Error("Expected polygon.");
    expect(refined.coordinates[0]![0]).toEqual(refined.coordinates[0]!.at(-1));
    expect(refined.coordinates[0]!.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects degenerate, tiny, and self-intersecting polygons", () => {
    expect(MIN_POLYGON_AREA).toBeGreaterThan(0);
    expect(() => refineDrawnGeometry("country", { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] }, 1)).toThrow("drawing_zero_area");
    expect(() => refineDrawnGeometry("country", { type: "Polygon", coordinates: [[[0, 0], [1e-6, 0], [0, 1e-6], [0, 0]]] }, 1)).toThrow("drawing_zero_area");
    expect(() => refineDrawnGeometry("country", { type: "Polygon", coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] }, 0.000_001)).toThrow("drawing_self_intersection");
  });

  it("removes stationary freehand samples before checking a region boundary", () => {
    const refined = refineDrawnGeometry("region", {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    }, 0.000_001, { smoothingPasses: 0 });
    expect(refined).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    });
  });

  it("caps large paths deterministically and retains the closure", () => {
    const input: [number, number][] = Array.from({ length: MAX_DRAW_COORDINATES * 3 }, (_, index) => [
      -170 + (340 * index) / (MAX_DRAW_COORDINATES * 3 - 1),
      Math.sin(index / 9) * 10,
    ]);
    const first = refineDrawnGeometry("river", { type: "LineString", coordinates: input }, 0.000_001);
    const second = refineDrawnGeometry("river", { type: "LineString", coordinates: input }, 0.000_001);
    expect(first).toEqual(second);
    if (first.type !== "LineString") throw new Error("Expected line.");
    expect(first.coordinates.length).toBeLessThanOrEqual(MAX_DRAW_COORDINATES);
    expect(first.coordinates[0]).toEqual(input[0]);
    expect(first.coordinates.at(-1)).toEqual(input.at(-1));
  });

  it("rejects degenerate lines", () => {
    expect(() => refineDrawnGeometry("river", { type: "LineString", coordinates: [[1, 1], [1, 1]] }, 1)).toThrow("drawing_line_too_short");
    expect(() => refineDrawnGeometry("river", { type: "LineString", coordinates: [[1, 1]] }, 1)).toThrow("drawing_line_too_short");
  });

  it("allows corner-preserving smoothing and keeps the default equivalent", () => {
    const line: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [1, 1], [2, 0]] };
    const sharp = refineDrawnGeometry("river", line, 0.000_001, { smoothingPasses: 0 });
    const defaultResult = refineDrawnGeometry("river", line, 0.000_001);
    const explicitDefault = refineDrawnGeometry("river", line, 0.000_001, { smoothingPasses: 1 });
    expect(sharp).toEqual(line);
    expect(defaultResult).toEqual(explicitDefault);
    if (defaultResult.type !== "LineString") throw new Error("Expected a line.");
    expect(defaultResult.coordinates.length).toBeGreaterThan(line.coordinates.length);
  });

  it("preserves polygon closure and holes with zero smoothing", () => {
    const polygon: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
        [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]],
      ],
    };
    const refined = refineDrawnGeometry("country", polygon, 0.000_001, { smoothingPasses: 0 });
    expect(refined).toEqual(polygon);
    if (refined.type !== "Polygon") throw new Error("Expected a polygon.");
    expect(refined.coordinates).toHaveLength(2);
    expect(refined.coordinates.every((ring) => ring[0] && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1])).toBe(true);
  });

  it("rejects non-integer or unbounded smoothing passes", () => {
    expect(MAX_SMOOTHING_PASSES).toBeGreaterThan(0);
    const line: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    expect(() => refineDrawnGeometry("river", line, 1, { smoothingPasses: -1 })).toThrow("drawing_smoothing");
    expect(() => refineDrawnGeometry("river", line, 1, { smoothingPasses: 1.5 })).toThrow("drawing_smoothing");
    expect(() => refineDrawnGeometry("river", line, 1, { smoothingPasses: MAX_SMOOTHING_PASSES + 1 })).toThrow("drawing_smoothing");
  });

  it("snaps an endpoint to the nearest requested angle without mutating inputs", () => {
    const previous: [number, number] = [0, 0];
    const next: [number, number] = [2, 0.5];
    const original = [...next] as [number, number];
    const snapped = snapPositionToAngle(previous, next, 45);
    expect(snapped[0]).toBeCloseTo(Math.hypot(2, 0.5));
    expect(snapped[1]).toBeCloseTo(0);
    expect(next).toEqual(original);
    expect(snapPositionToAngle([1, 1], [1, 2], 90)).toEqual([1, 2]);
  });

  it("rejects invalid, zero-length, and out-of-world angle snaps", () => {
    expect(() => snapPositionToAngle([0, 0], [1, 1], 0)).toThrow("drawing_angle");
    expect(() => snapPositionToAngle([0, 0], [1, 1], Number.NaN)).toThrow("drawing_angle");
    expect(() => snapPositionToAngle([0, 0], [1, 1], 361)).toThrow("drawing_angle");
    expect(() => snapPositionToAngle([0, 0], [0, 0], 45)).toThrow("drawing_zero_length");
    expect(() => snapPositionToAngle([179, 89], [180, 90], 90)).toThrow("drawing_outside_world");
    expect(() => snapPositionToAngle([Number.NaN, 0], [1, 1], 45)).toThrow("drawing_outside_world");
  });
});
