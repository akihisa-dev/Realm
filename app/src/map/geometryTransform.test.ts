import { duplicateOffset, geometryCenter, transformGeometry } from "./geometryTransform";
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
});
