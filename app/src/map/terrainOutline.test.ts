import { cellId, cellPolygon } from "./gridGeometry";
import { exactCellBoundaryRings, smoothCellBoundaryPolygons, smoothCellBoundaryRings, splitTerrainGridSegments, terrainOutlineSegments } from "./terrainOutline";

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

  it("builds deterministic bounded curves while retaining holes and islands", () => {
    const ids: string[] = [];
    for (let row = 10; row <= 14; row += 1) for (let column = 10; column <= 14; column += 1) if (row !== 12 || column !== 12) ids.push(cellId(row, column));
    ids.push(cellId(25, 25));
    const first = smoothCellBoundaryRings(ids);
    expect(first).toEqual(smoothCellBoundaryRings([...ids].reverse()));
    expect(first.every((ring) => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1])).toBe(true);
    expect(first.flat(2).every(Number.isFinite)).toBe(true);
    expect(smoothCellBoundaryPolygons(ids).some((polygon) => polygon.length > 1)).toBe(true);
    expect(first.length).toBeGreaterThan(1);
    expect(smoothCellBoundaryRings([cellId(10, 10)])[0]!.length).toBeGreaterThan(exactCellBoundaryRings([cellId(10, 10)])[0]!.length);
  });
});
