import { describe, expect, it, vi } from "vitest";
import type { MapShape } from "../shared/realmContract";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../shared/mapShapeGeometry";
import { RegionShapeController } from "./RegionShapeController";

const shape = (layer: "terrain" | "region", cells: string[], id: string, regionId?: string): MapShape => ({
  id,
  layer,
  ...(regionId ? { regionId } : {}),
  value: layer === "terrain" ? "terrain" : "#2468AC",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: cellIdsToPolygonGeometries(cells)[0]!,
});

const event = (coordinate: [number, number]) => ({ originalEvent: { isPrimary: true, button: 0 }, coordinate });
const interactionOf = (controller: RegionShapeController) => controller.interaction as unknown as {
  handleDownEvent: (event: unknown) => boolean;
  handleUpEvent: (event: unknown) => boolean;
};

describe("RegionShapeController", () => {
  it("clips the complete logical region to terrain even when the layers overlap", () => {
    const terrain = shape("terrain", ["10:10"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const region = shape("region", ["10:10", "11:10"], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const shapes = [terrain, region];
    const emit = vi.fn();
    const controller = new RegionShapeController({ shapes: () => shapes, hitTolerance: () => 0.1, emit });
    const interaction = interactionOf(controller);
    const point = region.geometry.coordinates[0]![0]!;
    expect(interaction.handleDownEvent(event(point))).toBe(true);
    interaction.handleUpEvent(event(point));
    expect(emit).toHaveBeenCalledOnce();
    const next = emit.mock.calls[0]?.[0] as MapShape[];
    const clipped = next.filter((candidate) => candidate.layer === "region");
    expect(clipped).toHaveLength(1);
    expect(mapShapeCellIds(clipped[0]!)).toEqual(new Set(["10:10"]));
    expect(next.find((candidate) => candidate.id === terrain.id)).toEqual(terrain);
    controller.dispose();
  });

  it("does not emit when the pointer is cancelled or released outside the pressed part", () => {
    const region = shape("region", ["10:10"], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8bbb-cccccccccccc");
    const emit = vi.fn();
    const controller = new RegionShapeController({ shapes: () => [region], hitTolerance: () => 0.1, emit });
    const interaction = interactionOf(controller);
    const point = region.geometry.coordinates[0]![0]!;
    expect(interaction.handleDownEvent(event(point))).toBe(true);
    controller.cancel();
    interaction.handleUpEvent(event(point));
    expect(emit).not.toHaveBeenCalled();
    controller.dispose();
  });
});
