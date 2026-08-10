import { CELL_GRID_COLUMNS, CELL_GRID_ROWS } from "./gridGeometry";
import { WORLD_GRID_CELL_SIZE, lineLength, polygonArea, polygonAreaSquareDegrees, polylineLengthDegrees } from "./measurementGeometry";

describe("measurementGeometry", () => {
  it("measures polyline length with the flat EPSG:4326 degree approximation", () => {
    expect(polylineLengthDegrees([[0, 0], [3, 4], [3, 4]])).toBe(5);
    expect(lineLength([])).toBe(0);
    expect(WORLD_GRID_CELL_SIZE).toEqual([360 / CELL_GRID_COLUMNS, 180 / CELL_GRID_ROWS]);
  });

  it("measures open and closed polygon shells in square degrees", () => {
    const open = [[0, 0], [4, 0], [4, 3]] as [number, number][];
    const closed = [[0, 0], [4, 0], [4, 3], [0, 0]] as [number, number][];
    expect(polygonArea(open)).toBe(6);
    expect(polygonAreaSquareDegrees(closed)).toBe(6);
  });

  it("subtracts hole areas regardless of ring winding", () => {
    expect(polygonAreaSquareDegrees([
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[2, 2], [2, 4], [4, 4], [4, 2]],
    ])).toBe(96);
  });

  it("rejects non-finite or out-of-world coordinates", () => {
    expect(() => lineLength([[0, 0], [Number.NaN, 1]])).toThrow(/finite/);
    expect(() => polygonArea([[[-181, 0], [0, 0], [0, 1]]] as unknown as [number, number][][])).toThrow(/bounded world/);
  });
});
