import { describe, expect, it } from "vitest";
import type { GeoJsonGeometry } from "../backend";
import { nudgeGeometry, resolutionForFillingExtent, resolutionForFittingExtent, snapFinalGeometry, straightenLine } from "./mapAdapterGeometry";

describe("map adapter geometry helpers", () => {
  const extent = [-10, -5, 30, 15] as const;

  it("calculates fitting and filling resolutions and rejects unusable sizes", () => {
    expect(resolutionForFittingExtent(extent, [400, 200])).toBe(0.1);
    expect(resolutionForFillingExtent(extent, [400, 200])).toBe(0.1);
    expect(Number.isNaN(resolutionForFittingExtent(extent, [0, 200]))).toBe(true);
    expect(Number.isNaN(resolutionForFillingExtent(extent, [400, Number.POSITIVE_INFINITY]))).toBe(true);
    expect(Number.isNaN(resolutionForFittingExtent([0, 0, 0, 10], [400, 200]))).toBe(true);
    expect(Number.isNaN(resolutionForFillingExtent([0, 0, 10, 0], [400, 200]))).toBe(true);
  });

  it("snaps line and polygon vertices while preserving points and short geometries", () => {
    const point: GeoJsonGeometry = { type: "Point", coordinates: [1, 2] };
    expect(snapFinalGeometry(point, 45)).toBe(point);

    const shortLine: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0]] };
    expect(snapFinalGeometry(shortLine, 45)).toBe(shortLine);

    const line = snapFinalGeometry({ type: "LineString", coordinates: [[0, 0], [1, 0.2], [2, 1]] }, 90);
    expect(line.type).toBe("LineString");
    if (line.type === "LineString") expect(line.coordinates).toHaveLength(3);

    const polygon = snapFinalGeometry({
      type: "Polygon",
      coordinates: [
        [[0, 0], [1, 0.2], [1.2, 1], [0, 0]],
        [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]],
      ],
    }, 45);
    expect(polygon.type).toBe("Polygon");
    if (polygon.type === "Polygon") {
      expect(polygon.coordinates[0]?.at(-1)).toEqual(polygon.coordinates[0]?.[0]);
      expect(polygon.coordinates[1]).toHaveLength(3);
    }
  });

  it("straightens long lines and leaves other geometries unchanged", () => {
    const line: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [1, 2], [3, 4]] };
    expect(straightenLine(line)).toEqual({ type: "LineString", coordinates: [[0, 0], [3, 4]] });
    const short: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [1, 2]] };
    expect(straightenLine(short)).toBe(short);
    const point: GeoJsonGeometry = { type: "Point", coordinates: [0, 0] };
    expect(straightenLine(point)).toBe(point);
  });

  it("nudges point, line, and polygon coordinates by the same offset", () => {
    const offset: [number, number] = [0.5, -1];
    expect(nudgeGeometry({ type: "Point", coordinates: [1, 2] }, offset)).toEqual({ type: "Point", coordinates: [1.5, 1] });
    expect(nudgeGeometry({ type: "LineString", coordinates: [[1, 2], [3, 4]] }, offset)).toEqual({ type: "LineString", coordinates: [[1.5, 1], [3.5, 3]] });
    expect(nudgeGeometry({ type: "Polygon", coordinates: [[[1, 2], [3, 4], [1, 2]]] }, offset)).toEqual({ type: "Polygon", coordinates: [[[1.5, 1], [3.5, 3], [1.5, 1]]] });
  });
});
