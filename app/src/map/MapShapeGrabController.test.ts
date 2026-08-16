import { describe, expect, it, vi } from "vitest";
import type { MapShape } from "../shared/realmContract";
import { cellIdsToPolygonGeometries, hitTestMapShapeGeometry, mapShapeCellCenter, mapShapeCellIds } from "../shared/mapShapeGeometry";
import { MapShapeGrabController } from "./MapShapeGrabController";

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
const interactionOf = (controller: MapShapeGrabController) => controller.interaction as unknown as {
  handleDownEvent: (event: unknown) => boolean;
  handleDragEvent: (event: unknown) => void;
  handleUpEvent: (event: unknown) => boolean;
};

describe("MapShapeGrabController", () => {
  it("keeps a distant vertex pull as one connected shape with the original ID", () => {
    const original = shape("terrain", ["30:30"], "55555555-5555-4555-8555-555555555555");
    const ring = original.geometry.coordinates[0]!;
    let current: MapShape[] = [original];
    const commits: MapShape[][] = [];
    const controller = new MapShapeGrabController({
      shapes: () => current,
      hitTolerance: () => 0.1,
      setPreview: () => undefined,
      emit: (next) => { commits.push(next); current = next; },
    });
    const interaction = interactionOf(controller);
    expect(interaction.handleDownEvent(event(ring[0]!))).toBe(true);
    interaction.handleDragEvent(event([ring[0]![0], ring[0]![1] - 42]));
    interaction.handleUpEvent(event([ring[0]![0], ring[0]![1] - 42]));
    expect(commits).toHaveLength(1);
    expect(commits[0]).toHaveLength(1);
    expect(commits[0]?.[0]?.id).toBe(original.id);
    const cells = mapShapeCellIds(commits[0]![0]!);
    expect(cells).toContain("30:30");
    expect(cells).toContain("30:13");
    const rowWidths = new Map<number, number>();
    for (const cell of cells) {
      const row = Number(cell.split(":")[1]);
      rowWidths.set(row, (rowWidths.get(row) ?? 0) + 1);
    }
    expect(Math.max(...rowWidths.values())).toBeGreaterThan(1);
    controller.dispose();
  });

  it("previews a continuous Polygon edit and commits exactly once on pointerup", () => {
    const original = shape("terrain", ["10:10"], "11111111-1111-4111-8111-111111111111");
    let current: MapShape[] = [original];
    const previews: (readonly MapShape[] | null)[] = [];
    const commits: MapShape[][] = [];
    const controller = new MapShapeGrabController({
      shapes: () => current,
      hitTolerance: () => 0.1,
      setPreview: (next) => previews.push(next),
      emit: (next) => { commits.push(next); current = next; },
    });
    const interaction = interactionOf(controller);
    const start = mapShapeCellCenter({ row: 10, column: 10 });
    const target = mapShapeCellCenter({ row: 10, column: 12 });
    expect(interaction.handleDownEvent(event(start))).toBe(true);
    interaction.handleDragEvent(event([start[0] + (target[0] - start[0]) / 2, start[1]]));
    interaction.handleDragEvent(event(target));
    expect(previews.filter((preview) => preview !== null)).toHaveLength(3);
    expect(previews[1]).not.toEqual(previews[0]);
    expect(commits).toHaveLength(0);
    interaction.handleUpEvent(event(target));
    expect(commits).toHaveLength(1);
    expect(commits[0]?.[0]?.id).toBe(original.id);
    expect(mapShapeCellIds(commits[0]![0]!)).toEqual(new Set(["12:10"]));
    expect(previews.at(-1)).toBeNull();
    controller.dispose();
  });

  it("previews only the affected grid cells for a boundary pull before pointerup", () => {
    const original = shape("terrain", [
      "30:30", "31:30", "32:30",
      "30:31", "31:31", "32:31",
      "30:32", "31:32", "32:32",
    ], "33333333-3333-4333-8333-333333333333");
    const ring = original.geometry.coordinates[0]!;
    const target: [number, number] = [ring[0]![0] + 8, ring[0]![1] + 8];
    let current: MapShape[] = [original];
    const previews: (readonly MapShape[] | null)[] = [];
    const commits: MapShape[][] = [];
    const controller = new MapShapeGrabController({
      shapes: () => current,
      hitTolerance: () => 0.1,
      setPreview: (next) => previews.push(next),
      emit: (next) => { commits.push(next); current = next; },
    });
    const interaction = interactionOf(controller);
    expect(interaction.handleDownEvent(event(ring[0]!))).toBe(true);
    interaction.handleDragEvent(event(target));

    const preview = previews.at(-1)?.[0];
    expect(preview).toBeDefined();
    const previewCells = mapShapeCellIds(preview!);
    expect(previewCells).toContain("35:35");
    expect(previewCells).not.toContain("29:29");
    expect(previewCells).not.toContain("29:30");
    expect(previewCells).not.toContain("30:29");
    expect(commits).toHaveLength(0);

    interaction.handleUpEvent(event(target));
    expect(commits).toHaveLength(1);
    expect(mapShapeCellIds(commits[0]![0]!)).toEqual(previewCells);
    controller.dispose();
  });

  it("uses exact vertex and edge hits and cancels without emitting", () => {
    const original = shape("terrain", ["10:10"], "22222222-2222-4222-8222-222222222222");
    const ring = original.geometry.coordinates[0]!;
    const edgePoint: [number, number] = [(ring[0]![0] + ring[1]![0]) / 2, (ring[0]![1] + ring[1]![1]) / 2];
    expect(hitTestMapShapeGeometry(original.geometry, ring[0]!, 0.001)?.kind).toBe("vertex");
    expect(hitTestMapShapeGeometry(original.geometry, edgePoint, 0.001)?.kind).toBe("edge");
    const emit = vi.fn(); const setPreview = vi.fn();
    const controller = new MapShapeGrabController({ shapes: () => [original], hitTolerance: () => 0.1, setPreview, emit });
    const interaction = interactionOf(controller);
    expect(interaction.handleDownEvent(event(ring[0]!))).toBe(true);
    interaction.handleDragEvent(event([ring[0]![0] + 1, ring[0]![1] + 1]));
    controller.cancel();
    interaction.handleUpEvent(event([ring[0]![0] + 1, ring[0]![1] + 1]));
    expect(emit).not.toHaveBeenCalled();
    expect(setPreview.mock.calls.at(-1)?.[0]).toBeNull();
    controller.dispose();
  });
});
