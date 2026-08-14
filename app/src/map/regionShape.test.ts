import { describe, expect, it, vi } from "vitest";
import type { CellAttributeSnapshot } from "../backend";
import { RegionShapeController } from "./RegionShapeController";

const region = (cellId: string, value: string, regionId?: string): CellAttributeSnapshot => ({ cellId, attribute: "region", value, ...(regionId ? { regionId } : {}) });
const terrain = (cellId: string): CellAttributeSnapshot => ({ cellId, attribute: "terrain", value: "land" });
const event = (coordinate: [number, number], button = 0): { originalEvent: { isPrimary: boolean; button: number }; coordinate: [number, number] } => ({ originalEvent: { isPrimary: true, button }, coordinate });
const interactionOf = (controller: RegionShapeController) => controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleUpEvent: (event: unknown) => boolean };

describe("RegionShapeController", () => {
  it("clears every disconnected cell with the same logical region identity", () => {
    const attributes = new Map<string, readonly CellAttributeSnapshot[]>([
      ["1:1", [region("1:1", "red", "north")]],
      ["2:1", [region("2:1", "red", "north"), terrain("2:1")]],
      ["20:20", [region("20:20", "blue", "south")]],
      ["30:30", [region("30:30", "red", "north")]],
    ]);
    const emit = vi.fn();
    const controller = new RegionShapeController({ cellAt: (position) => position[0] === 0 ? "1:1" : null, attributes: () => attributes, emit });
    const interaction = interactionOf(controller);
    expect(interaction.handleDownEvent(event([0, 0]))).toBe(true);
    interaction.handleUpEvent(event([0, 0]));
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ cellIds: ["1:1", "30:30"], attribute: "region", value: null });
    controller.dispose();
  });

  it("does nothing for empty or fully terrain-backed regions", () => {
    const attributes = new Map<string, readonly CellAttributeSnapshot[]>([
      ["1:1", [region("1:1", "red"), terrain("1:1")]],
      ["2:1", [region("2:1", "red"), terrain("2:1")]],
      ["3:1", [terrain("3:1")]],
    ]);
    const emit = vi.fn();
    const controller = new RegionShapeController({ cellAt: (position) => position[0] === 0 ? "1:1" : position[0] === 1 ? "3:1" : null, attributes: () => attributes, emit });
    const interaction = interactionOf(controller);
    interaction.handleDownEvent(event([0, 0]));
    interaction.handleUpEvent(event([0, 0]));
    expect(interaction.handleDownEvent(event([1, 0]))).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("requires release on the pressed cell and cancels safely", () => {
    const attributes = new Map([["1:1", [region("1:1", "red")]]]);
    const emit = vi.fn();
    const controller = new RegionShapeController({ cellAt: (position) => position[0] === 0 ? "1:1" : "2:1", attributes: () => attributes, emit });
    const interaction = interactionOf(controller);
    interaction.handleDownEvent(event([0, 0]));
    interaction.handleUpEvent(event([1, 0]));
    expect(emit).not.toHaveBeenCalled();
    interaction.handleDownEvent(event([0, 0]));
    controller.cancel();
    interaction.handleUpEvent(event([0, 0]));
    expect(emit).not.toHaveBeenCalled();
    controller.dispose();
  });
});
