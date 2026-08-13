import { cellId } from "./gridGeometry";
import { terrainOutlineSegments } from "./terrainOutline";
import { terrainOutlineTransitionSegments } from "./terrainOutlineTransition";

const finite = (segments: readonly (readonly (readonly number[])[])[]): boolean => segments.flat(2).every(Number.isFinite);

describe("terrainOutlineTransitionSegments", () => {
  it("expands an adjacent addition from its contacting edge", () => {
    const before = [cellId(10, 10)];
    const after = [...before, cellId(10, 11)];
    const halfway = terrainOutlineTransitionSegments(before, after, 0.5);
    expect(halfway).toHaveLength(11);
    expect(finite(halfway)).toBe(true);
    expect(terrainOutlineTransitionSegments(before, after, 1)).toEqual(terrainOutlineSegments(after));
  });

  it("closes an adjacent deletion toward the remaining contact edge", () => {
    const before = [cellId(10, 10), cellId(10, 11)];
    const after = [cellId(10, 10)];
    const halfway = terrainOutlineTransitionSegments(before, after, 0.5);
    expect(halfway).toHaveLength(11);
    expect(finite(halfway)).toBe(true);
    expect(terrainOutlineTransitionSegments(before, after, 1)).toEqual(terrainOutlineSegments(after));
  });

  it("uses a centre fallback for an isolated cell", () => {
    const id = cellId(10, 10);
    expect(terrainOutlineTransitionSegments([], [id], 0)).toHaveLength(6);
    expect(terrainOutlineTransitionSegments([id], [], 0.5)).toHaveLength(6);
    expect(finite(terrainOutlineTransitionSegments([id], [], 0.5))).toBe(true);
  });

  it("clamps progress and returns the completed outline exactly", () => {
    const before = [cellId(1, 1)]; const after = [cellId(1, 1), cellId(2, 1)];
    expect(terrainOutlineTransitionSegments(before, after, 2)).toEqual(terrainOutlineSegments(after));
    expect(finite(terrainOutlineTransitionSegments(before, after, 0.25))).toBe(true);
  });
});
