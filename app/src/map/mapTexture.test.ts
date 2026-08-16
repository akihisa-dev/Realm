import { describe, expect, it, vi } from "vitest";
import { mapTextureDots, paintMapTexture } from "./mapTexture";

describe("map texture", () => {
  it("returns deterministic bounded dots for each theme and rejects invalid sizes", () => {
    expect(mapTextureDots(0, 100, "ink")).toEqual([]);
    expect(mapTextureDots(Number.NaN, 100, "atlas")).toEqual([]);
    for (const theme of ["ink", "atlas", "midnight"] as const) {
      const dots = mapTextureDots(200, 100, theme);
      expect(dots.length).toBeGreaterThan(0);
      expect(dots).toEqual(mapTextureDots(200, 100, theme));
      expect(dots.every(({ x, y, radius }) => x >= 0 && x <= 200 && y >= 0 && y <= 100 && radius > 0)).toBe(true);
    }
  });

  it("paints both light and dark dots with theme-specific colors", () => {
    const context = {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    paintMapTexture(context, 120, 120, "midnight");
    expect(context.beginPath).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    paintMapTexture(context, 120, 120, "ink");
    expect(context.fill).toHaveBeenCalled();
  });
});
