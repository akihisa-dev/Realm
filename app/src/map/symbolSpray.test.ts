import { MAX_SPRAY_COUNT, generateSprayCandidates, positionWithinPolygon } from "./symbolSpray";

describe("generateSprayCandidates", () => {
  const options = { seed: "world-1:forest-1", spacing: 2, maxCount: 24, bounds: { minX: -20, maxX: 20, minY: -10, maxY: 10 }, featureType: "tree" as const };

  it("is deterministic for a seed and varies for a different seed", () => {
    const first = generateSprayCandidates(options);
    const second = generateSprayCandidates(options);
    const different = generateSprayCandidates({ ...options, seed: "world-1:forest-2" });
    expect(first).toEqual(second);
    expect(different).not.toEqual(first);
  });

  it("keeps candidates in bounds, separated, typed, and capped", () => {
    const candidates = generateSprayCandidates(options);
    expect(candidates.length).toBeLessThanOrEqual(options.maxCount);
    expect(candidates.every((candidate, index) => candidate.featureType === "tree" && candidate.ordinal === index
      && candidate.coordinates[0] >= -20 && candidate.coordinates[0] <= 20
      && candidate.coordinates[1] >= -10 && candidate.coordinates[1] <= 10
      && candidate.scale >= 0.85 && candidate.scale <= 1.15
      && candidate.rotation >= -Math.PI && candidate.rotation <= Math.PI)).toBe(true);
    for (let first = 0; first < candidates.length; first += 1) {
      for (let second = first + 1; second < candidates.length; second += 1) {
        const dx = candidates[first]!.coordinates[0] - candidates[second]!.coordinates[0];
        const dy = candidates[first]!.coordinates[1] - candidates[second]!.coordinates[1];
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(options.spacing ** 2);
      }
    }
  });

  it("supports zero spacing and an explicit maximum count", () => {
    expect(generateSprayCandidates({ seed: 1, spacing: 0, maxCount: 0 })).toEqual([]);
    expect(generateSprayCandidates({ seed: 1, spacing: 0, maxCount: 3 })).toHaveLength(3);
  });

  it("restricts candidates to a shell while excluding holes", () => {
    const polygon = [
      [[-10, -10], [10, -10], [10, 10], [-10, 10]],
      [[-2, -2], [2, -2], [2, 2], [-2, 2]],
    ] as const;
    expect(positionWithinPolygon([0, 0], polygon)).toBe(false);
    expect(positionWithinPolygon([5, 5], polygon)).toBe(true);
    const candidates = generateSprayCandidates({ seed: 7, spacing: 1, maxCount: 20, polygon });
    expect(candidates.every(({ coordinates }) => positionWithinPolygon(coordinates, polygon))).toBe(true);
    expect(() => positionWithinPolygon([181, 0], polygon)).toThrow(/bounded world/);
  });

  it("rejects invalid spacing, count, ranges, and world bounds", () => {
    expect(() => generateSprayCandidates({ seed: 1, spacing: -1, maxCount: 1 })).toThrow(/spacing/);
    expect(() => generateSprayCandidates({ seed: 1, spacing: 1, maxCount: MAX_SPRAY_COUNT + 1 })).toThrow(/count/);
    expect(() => generateSprayCandidates({ seed: 1, spacing: 1, maxCount: 1, bounds: { minX: -181, maxX: 1, minY: 0, maxY: 1 } })).toThrow(/bounds/);
    expect(() => generateSprayCandidates({ seed: 1, spacing: 1, maxCount: 1, scale: { min: 2, max: 1 } })).toThrow(/ranges/);
    expect(() => generateSprayCandidates({ seed: Number.NaN, spacing: 1, maxCount: 1 })).toThrow(/seed/);
  });
});
