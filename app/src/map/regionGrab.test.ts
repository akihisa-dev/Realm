import Feature from "ol/Feature";
import { describe, expect, it, vi } from "vitest";
import { RegionGrabController } from "./RegionGrabController";
import { connectedRegionCells, sameCellSet, translateRegionCells } from "./regionGrab";

const region = (cellId: string, value: string) => ({ cellId, attribute: "region" as const, value });

describe("region grab geometry", () => {
  it("collects one same-color hex-connected mass and excludes touching colors", () => {
    const cells = new Map([
      ["2:2", [region("2:2", "#AA0000")]],
      ["3:2", [region("3:2", "#AA0000")]],
      ["2:3", [region("2:3", "#AA0000")]],
      ["4:2", [region("4:2", "#00AA00")]],
      ["20:20", [region("20:20", "#AA0000")]],
    ]);
    expect(connectedRegionCells("2:2", cells)).toEqual(["2:2", "3:2", "2:3"]);
  });

  it("translates a mass using axial hex coordinates and rejects world overflow", () => {
    const source = ["2:2", "3:2", "2:3"];
    const target = translateRegionCells(source, "2:2", "5:3");
    expect(target).toEqual(["5:3", "6:3", "6:4"]);
    expect(sameCellSet(source, target ?? [])).toBe(false);
    expect(translateRegionCells(["127:72"], "127:72", "128:72")).toBeNull();
  });

  it("emits one move only for an in-world release and cancels an outside release", () => {
    const attributes = new Map([
      ["2:2", [region("2:2", "#AA0000")]],
      ["3:2", [region("3:2", "#AA0000")]],
      ["2:3", [{ cellId: "2:3", attribute: "terrain" as const, value: "terrain" }, region("2:3", "#AA0000")]],
    ]);
    const features = new Map<string, Feature>();
    const emitted: Array<{ sourceCellIds: string[]; targetCellIds: string[] }> = [];
    const controller = new RegionGrabController({
      cellAt: (position) => position[0] === 0 ? "2:2" : position[0] === 1 ? "5:3" : null,
      attributes: () => attributes,
      getFeature: (id) => features.get(id),
      ensureFeatures: (ids) => { for (const id of ids) if (!features.has(id)) { const feature = new Feature(); feature.setId(id); features.set(id, feature); } },
      removeUnused: (id) => { if (!attributes.has(id)) features.delete(id); },
      changed: vi.fn(),
      emit: (input) => emitted.push(input),
    });
    const interaction = controller.interaction as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    const pointer = { isPrimary: true, button: 0 };
    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: [0, 0] })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [1, 0] });
    expect(interaction.handleUpEvent({ originalEvent: pointer, coordinate: [1, 0] })).toBe(false);
    expect(emitted).toEqual([{ sourceCellIds: ["2:2", "3:2", "2:3"], targetCellIds: ["5:3", "6:3", "6:4"] }]);

    expect(interaction.handleDownEvent({ originalEvent: pointer, coordinate: [0, 0] })).toBe(true);
    interaction.handleDragEvent({ originalEvent: pointer, coordinate: [2, 0] });
    interaction.handleUpEvent({ originalEvent: pointer, coordinate: [2, 0] });
    expect(emitted).toHaveLength(1);
    expect(features.get("2:2")?.get("grabPreview")).toBeUndefined();
    controller.dispose();
  });
});
