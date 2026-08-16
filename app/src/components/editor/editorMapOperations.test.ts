import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../../shared/mapShapeGeometry";
import type { MapShape } from "../../backend";
import { mergeRegionShapes, splitRegionComponentShapes } from "./editorMapOperations";
import type { RegionComponent, RegionObject } from "./regionObjects";

const regionShape = (cells: string[], regionId: string, id: string, value = "#2468AC"): MapShape => ({
  id,
  layer: "region",
  regionId,
  value,
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: cellIdsToPolygonGeometries(cells)[0]!,
});

const region = (id: string, persistentId: string | null, color = "#2468AC"): RegionObject => ({
  id,
  persistentId,
  label: id,
  color,
  cellIds: [],
  components: [],
});

const component = (id: string, cellIds: string[]): RegionComponent => ({ id, cellIds });

describe("editor map operations", () => {
  it("merges persistent region ids while preserving the selected target", () => {
    const target = region("region-a", "persistent-a");
    const other = region("region-b", "persistent-b", "#E45756");
    const result = mergeRegionShapes([
      regionShape(["1:1"], "persistent-a", "shape-a"),
      regionShape(["8:8"], "persistent-b", "shape-b", "#E45756"),
    ], [target, other]);
    expect(result?.kind).toBe("merged");
    if (result?.kind !== "merged") return;
    expect(result.target).toBe(target);
    expect(result.shapes.every((shape) => shape.regionId === "persistent-a" && shape.value === "#2468AC")).toBe(true);
  });

  it("rejects legacy regions without changing the shape set", () => {
    const result = mergeRegionShapes([], [region("region-a", null), region("region-b", "persistent-b")]);
    expect(result).toEqual({ kind: "legacy" });
  });

  it("moves a selected disconnected component to a new region id", () => {
    const current = [regionShape(["1:1"], "persistent-a", "shape-a"), regionShape(["8:8"], "persistent-a", "shape-b")];
    const regionWithComponents = { ...region("region-a", "persistent-a"), components: [component("component-a", ["1:1"]), component("component-b", ["8:8"])] };
    const next = splitRegionComponentShapes(current, regionWithComponents, component("component-b", ["8:8"]), "persistent-b", () => "new-shape");
    expect(next).toBeDefined();
    expect(next?.filter((shape) => shape.regionId === "persistent-b")).toHaveLength(1);
    expect(next?.find((shape) => shape.regionId === "persistent-b")?.id).toBe("shape-b");
    expect(next?.flatMap((shape) => [...mapShapeCellIds(shape)]).sort()).toEqual(["1:1", "8:8"]);
  });
});
