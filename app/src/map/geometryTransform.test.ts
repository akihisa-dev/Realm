import { combinedGeometryCenter, duplicateOffset, geometryCenter, transformGeometries, transformGeometry } from "./geometryTransform";
import type { GeoJsonGeometry } from "../backend";

describe("geometry transforms", () => {
  it("finds the bounding-box center and mirrors a line", () => {
    const line: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [4, 2]] };
    expect(geometryCenter(line)).toEqual([2, 1]);
    expect(transformGeometry(line, { flipX: true })).toEqual({ type: "LineString", coordinates: [[4, 0], [0, 2]] });
  });

  it("rotates closed polygons without opening their rings", () => {
    const polygon: GeoJsonGeometry = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
    const rotated = transformGeometry(polygon, { rotationRadians: Math.PI / 2 });
    if (rotated.type === "Polygon") expect(rotated.coordinates[0]?.[0]).toEqual(rotated.coordinates[0]?.at(-1));
  });

  it("chooses an inward duplicate offset at the world edge", () => {
    expect(duplicateOffset({ type: "Point", coordinates: [179, 89] })).toEqual([-2, -2]);
    expect(transformGeometry({ type: "Point", coordinates: [179, 89] }, { offset: [-2, -2] })).toEqual({ type: "Point", coordinates: [177, 87] });
  });

  it("rejects transforms outside the bounded world", () => {
    expect(() => transformGeometry({ type: "Point", coordinates: [180, 90] }, { offset: [1, 0] })).toThrow("bounded world");
  });

  it("computes one bbox center across points, lines, polygons, and holes", () => {
    const geometries: GeoJsonGeometry[] = [
      { type: "Point", coordinates: [-2, -1] },
      { type: "LineString", coordinates: [[0, 0], [2, 4]] },
      { type: "Polygon", coordinates: [[[1, 1], [4, 1], [4, 3], [1, 1]], [[2, 1.5], [3, 1.5], [3, 2], [2, 1.5]]] },
    ];
    expect(combinedGeometryCenter(geometries)).toEqual([1, 1.5]);
  });

  it("transforms all geometries around their shared pivot and preserves polygon holes", () => {
    const geometries: GeoJsonGeometry[] = [
      { type: "Point", coordinates: [0, 0] },
      { type: "LineString", coordinates: [[4, 0], [4, 2]] },
      { type: "Polygon", coordinates: [[[1, 1], [3, 1], [3, 3], [1, 1]], [[1.5, 1.5], [2, 1.5], [1.5, 2], [1.5, 1.5]]] },
    ];
    const original = structuredClone(geometries);
    const transformed = transformGeometries(geometries, { flipX: true, offset: [1, 2] });
    expect(transformed).toEqual([
      { type: "Point", coordinates: [5, 2] },
      { type: "LineString", coordinates: [[1, 2], [1, 4]] },
      { type: "Polygon", coordinates: [[[4, 3], [2, 3], [2, 5], [4, 3]], [[3.5, 3.5], [3, 3.5], [3.5, 4], [3.5, 3.5]]] },
    ]);
    expect(geometries).toEqual(original);
    expect(transformGeometries(geometries, { flipX: true, offset: [1, 2] })).toEqual(transformed);
  });

  it("scales single and grouped geometry around the applicable bbox center", () => {
    expect(transformGeometry({ type: "LineString", coordinates: [[0, 0], [4, 2]] }, { scale: 0.5 })).toEqual({
      type: "LineString",
      coordinates: [[1, 0.5], [3, 1.5]],
    });
    expect(transformGeometries([
      { type: "Point", coordinates: [0, 0] },
      { type: "Point", coordinates: [4, 2] },
    ], { scale: 0.5 })).toEqual([
      { type: "Point", coordinates: [1, 0.5] },
      { type: "Point", coordinates: [3, 1.5] },
    ]);
  });

  it("rejects empty collections, empty geometries, and non-finite inputs", () => {
    expect(() => combinedGeometryCenter([])).toThrow("At least one geometry");
    expect(() => combinedGeometryCenter([{ type: "LineString", coordinates: [] }])).toThrow("at least one coordinate");
    expect(() => combinedGeometryCenter([{ type: "Point", coordinates: [Number.NaN, 0] }])).toThrow("bounded world");
    expect(() => transformGeometries([{ type: "Point", coordinates: [0, 0] }], { offset: [Infinity, 0] })).toThrow("finite");
    expect(() => transformGeometry({ type: "Point", coordinates: [0, 0] }, { scale: 0 })).toThrow("greater than zero");
    expect(() => transformGeometry({ type: "Point", coordinates: [0, 0] }, { scale: 101 })).toThrow("at most 100");
  });
});
