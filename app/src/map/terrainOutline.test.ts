import { cellId } from "./gridGeometry";
import { terrainOutlineSegments } from "./terrainOutline";

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
});
