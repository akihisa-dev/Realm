import { boundedHexGrid, boundedSquareGrid, fixedCellGridLines } from "./gridLayers";

describe("grid layer generation", () => {
  it("keeps configurable grids bounded and uniquely identified", () => {
    const square = boundedSquareGrid(30);
    const hex = boundedHexGrid(30);
    expect(square.length).toBeGreaterThan(0);
    expect(hex.length).toBeGreaterThan(0);
    expect(new Set(square.map((feature) => feature.getId())).size).toBe(square.length);
    expect(new Set(hex.map((feature) => feature.getId())).size).toBe(hex.length);
    expect(hex.length).toBeLessThanOrEqual(20_000);
  });

  it("derives a deduplicated fixed cell grid line set", () => {
    const lines = fixedCellGridLines();
    const keys = lines.map((line) => {
      const [first, second] = line;
      if (!first || !second) throw new Error("fixed cell grid lines must contain two positions");
      const a = `${first[0].toFixed(9)},${first[1].toFixed(9)}`;
      const b = `${second[0].toFixed(9)},${second[1].toFixed(9)}`;
      return a < b ? `${a}:${b}` : `${b}:${a}`;
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(lines.length);
  });
});
