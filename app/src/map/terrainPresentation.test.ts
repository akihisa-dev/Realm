import Feature from "ol/Feature";
import type { RenderFunction } from "ol/style/Style";
import { describe, expect, it, vi } from "vitest";
import { createTerrainPresentationStyle } from "./terrainPresentation";
import { mapTheme } from "./themes";

describe("terrain presentation renderer", () => {
  it("clips a deterministic gradient and low-contrast light/shadow patches to the land surface", () => {
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const fillRect = vi.fn();
    const context = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), save: vi.fn(), restore: vi.fn(),
      createLinearGradient: vi.fn(() => gradient), createRadialGradient: vi.fn(() => gradient), fillRect,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    const feature = new Feature({ terrainIdentity: "stable-terrain" });
    const renderer = createTerrainPresentationStyle(mapTheme("ink")).getRenderer();
    if (!renderer) throw new Error("terrain style should expose a renderer");
    const state = { context, feature, pixelRatio: 1, geometry: undefined, resolution: 1, rotation: 0 } as unknown as Parameters<RenderFunction>[1];

    renderer([[[0, 0], [120, 0], [120, 80], [0, 0]]], state);

    expect(context.createLinearGradient).toHaveBeenCalledTimes(1);
    expect(context.createRadialGradient).toHaveBeenCalled();
    expect(gradient.addColorStop).toHaveBeenCalled();
    expect(context.clip).toHaveBeenCalledWith("evenodd");
    expect(fillRect.mock.calls.length).toBeGreaterThan(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
  });

  it("creates a renderer for every built-in theme", () => {
    for (const themeId of ["ink", "atlas", "midnight"] as const) {
      expect(createTerrainPresentationStyle(mapTheme(themeId)).getRenderer()).toBeDefined();
    }
  });
});
