import { cellId, cellPolygon } from "./gridGeometry";
import { splitTerrainGridSegments, terrainOutlineSegments } from "./terrainOutline";

describe("terrainOutlineSegments", () => {
  it("keeps every edge of one interior terrain cell", () => {
    expect(terrainOutlineSegments([cellId(10, 10)])).toHaveLength(6);
  });

  it("removes the shared edge between adjacent terrain cells", () => {
    expect(terrainOutlineSegments([cellId(10, 10), cellId(10, 11)])).toHaveLength(10);
  });

  it("keeps separate terrain masses and ignores duplicate or invalid ids", () => {
    const segments = terrainOutlineSegments([
      cellId(10, 10),
      cellId(10, 10),
      cellId(20, 20),
      "outside",
    ]);
    expect(segments).toHaveLength(12);
  });

  it("separates grid edges inside terrain from those outside it", () => {
    const first = cellPolygon(10, 10)!;
    const second = cellPolygon(20, 20)!;
    const fixed = [
      [first[0]!, first[1]!],
      [first[1]!, first[2]!],
      [second[0]!, second[1]!],
    ];
    const split = splitTerrainGridSegments(fixed, [cellId(10, 10)]);
    expect(split.inside).toHaveLength(2);
    expect(split.outside).toHaveLength(1);
  });
});
