import { cellCenter, cellId, cellPolygon } from "./gridGeometry";
import { exactCellBoundaryRings, smoothCellBoundaryPolygons, smoothCellBoundaryRings, splitTerrainGridSegments, terrainCellCenters, terrainOutlineSegments } from "./terrainOutline";
import { mapShapeCellCenter, mapShapeCellPolygon } from "../shared/mapShapeGeometry";

describe("terrainOutlineSegments", () => {
  it("uses the persisted map-shape grid geometry for the renderer grid", () => {
    for (const [row, column] of [[0, 0], [1, 0], [36, 63], [72, 127]] as const) {
      expect(cellCenter(row, column)).toEqual(mapShapeCellCenter({ row, column }));
      expect(cellPolygon(row, column)).toEqual(mapShapeCellPolygon({ row, column }));
    }
  });

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

  it("derives one center marker per valid terrain cell", () => {
    expect(terrainCellCenters([cellId(10, 10), cellId(10, 10), "outside", cellId(11, 10)])).toEqual([
      cellCenter(10, 10),
      cellCenter(11, 10),
    ]);
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

  it("reduces hex-step waves without changing ring topology or bounds", () => {
    const ids: string[] = [];
    for (let row = 20; row <= 28; row += 1) {
      for (let column = 20; column <= 28; column += 1) {
        if (row !== 24 || column !== 24) ids.push(cellId(row, column));
      }
    }
    ids.push(cellId(34, 34));
    const exact = exactCellBoundaryRings(ids);
    const smooth = smoothCellBoundaryRings(ids);
    expect(smooth).toEqual(smoothCellBoundaryRings([...ids].reverse()));
    expect(smooth.length).toBe(exact.length);
    expect(smooth.every((ring) => ring.length < exact[0]!.length * 4)).toBe(true);

    const bounds = (rings: typeof exact): [number, number, number, number] => {
      const points = rings.flat();
      return [Math.min(...points.map(([x]) => x)), Math.max(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y)), Math.max(...points.map(([, y]) => y))];
    };
    const exactBounds = bounds(exact);
    for (const [minimum, maximum, axis] of [[exactBounds[0], exactBounds[1], 0], [exactBounds[2], exactBounds[3], 1]] as const) {
      expect(smooth.flat().every((point) => point[axis] >= minimum && point[axis] <= maximum)).toBe(true);
    }
    expect(smooth.flat(2).every(Number.isFinite)).toBe(true);
    expect(smooth.every((ring) => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1])).toBe(true);
    expect(smoothCellBoundaryPolygons(ids).some((polygon) => polygon.length > 1)).toBe(true);
    expect(smoothCellBoundaryPolygons(ids)).toHaveLength(2);
  });

  it("handles the complete active grid as one bounded transient outline", () => {
    const ids: string[] = [];
    for (let row = 0; row < 73; row += 1) {
      for (let column = 0; column < 128; column += 1) ids.push(cellId(row, column));
    }
    const rings = smoothCellBoundaryRings(ids);
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(rings[0]!.at(-1));
    expect(rings.flat(2).every(Number.isFinite)).toBe(true);
    expect(rings.flat().length).toBeLessThanOrEqual(65_536);
  });

  it("collapses long grid waves while retaining the macro boundary", () => {
    const ids: string[] = [];
    for (let row = 20; row <= 22; row += 1) {
      for (let column = 10; column <= 80; column += 1) ids.push(cellId(row, column));
    }
    const exact = exactCellBoundaryRings(ids);
    const smooth = smoothCellBoundaryRings(ids);
    expect(exact).toHaveLength(1);
    expect(smooth).toHaveLength(1);
    expect(exact[0]!.length).toBeGreaterThan(200);
    expect(smooth[0]!.length).toBeLessThanOrEqual(64);
    expect(smooth[0]![0]).toEqual(smooth[0]!.at(-1));
    expect(smooth.flat(2).every(Number.isFinite)).toBe(true);
  });
});
