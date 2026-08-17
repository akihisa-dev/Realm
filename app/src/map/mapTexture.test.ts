import { describe, expect, it, vi } from "vitest";
import { paintMapTexture } from "./mapTexture";

describe("map texture", () => {
  it("rejects invalid sizes without painting", () => {
    const context = { createLinearGradient: vi.fn() } as unknown as CanvasRenderingContext2D;
    paintMapTexture(context, 0, 100, "ink");
    paintMapTexture(context, Number.NaN, 100, "atlas");
    expect(context.createLinearGradient).not.toHaveBeenCalled();
  });

  it("paints bounded continuous gradients for every theme", () => {
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const context = {
      createLinearGradient: vi.fn(() => gradient),
      createRadialGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    paintMapTexture(context, 120, 120, "midnight");
    expect(context.createLinearGradient).toHaveBeenCalled();
    expect(context.createRadialGradient).toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalled();
    paintMapTexture(context, 120, 120, "ink");
    expect(context.fillRect).toHaveBeenCalled();
  });
});
