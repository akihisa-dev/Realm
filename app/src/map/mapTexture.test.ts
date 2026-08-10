import { mapTextureDots } from "./mapTexture";

it("creates bounded deterministic paper texture dots for each theme", () => {
  const first = mapTextureDots(800, 600, "ink");
  expect(first).toEqual(mapTextureDots(800, 600, "ink"));
  expect(first).not.toEqual(mapTextureDots(800, 600, "midnight"));
  expect(first.length).toBeGreaterThan(20);
  expect(first.every(({ x, y, radius }) => x >= 0 && x <= 800 && y >= 0 && y <= 600 && radius > 0)).toBe(true);
  expect(mapTextureDots(0, 600, "ink")).toEqual([]);
  expect(mapTextureDots(20_000, 20_000, "atlas")).toHaveLength(12_000);
});
