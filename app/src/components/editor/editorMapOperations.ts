import type { MapShape } from "../../backend";
import { cellIdsToPolygonGeometries, mapShapeCellIds } from "../../shared/mapShapeGeometry";
import type { RegionComponent, RegionEntry } from "./regionObjects";

export type MergeRegionShapesResult =
  | { kind: "merged"; shapes: MapShape[]; target: RegionEntry }
  | { kind: "legacy" }
  | null;

/** Reassigns selected logical region parts to the first selected region. */
export const mergeRegionShapes = (
  mapShapes: readonly MapShape[],
  regions: readonly RegionEntry[],
): MergeRegionShapesResult => {
  if (regions.length < 2) return null;
  const target = regions[0];
  if (!target) return null;
  if (!target.persistentId || regions.some((region) => region.persistentId === null)) return { kind: "legacy" };
  const selectedIds = new Set(regions.map((region) => region.persistentId).filter((id): id is string => id !== null));
  const shapes = mapShapes.map((shape) => shape.layer === "region" && shape.regionId && selectedIds.has(shape.regionId)
    ? { ...shape, regionId: target.persistentId!, value: target.color }
    : shape);
  return { kind: "merged", shapes, target };
};

/** Splits one disconnected component into a new logical region. */
export const splitRegionComponentShapes = (
  mapShapes: readonly MapShape[],
  region: RegionEntry,
  component: RegionComponent,
  newRegionId: string,
  createShapeId: () => string = () => crypto.randomUUID(),
): MapShape[] | null => {
  if (!region.persistentId || region.components.length < 2) return null;
  const componentCells = new Set(component.cellIds);
  const next: MapShape[] = [];
  for (const shape of mapShapes) {
    if (shape.layer !== "region" || shape.regionId !== region.persistentId) {
      next.push(shape);
      continue;
    }
    const ownCells = mapShapeCellIds(shape);
    const inside = new Set([...ownCells].filter((cell) => componentCells.has(cell)));
    const outside = new Set([...ownCells].filter((cell) => !componentCells.has(cell)));
    if (inside.size === 0) {
      next.push(shape);
      continue;
    }
    const outsideGeometry = cellIdsToPolygonGeometries(outside);
    outsideGeometry.forEach((geometry, index) => next.push({ ...shape, id: index === 0 ? shape.id : createShapeId(), geometry }));
    const insideGeometry = cellIdsToPolygonGeometries(inside);
    insideGeometry.forEach((geometry, index) => next.push({ ...shape, id: outsideGeometry.length === 0 && index === 0 ? shape.id : createShapeId(), regionId: newRegionId, geometry }));
  }
  return next;
};
