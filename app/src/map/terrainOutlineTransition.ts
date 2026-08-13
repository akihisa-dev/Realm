import type { Position } from "../backend";
import { cellPolygon, parseCellId } from "./gridGeometry";
import { terrainOutlineSegments, type TerrainOutlineSegment } from "./terrainOutline";

export type TerrainOutlineTransitionSegment = TerrainOutlineSegment;

const key = (point: Position): string => `${point[0].toFixed(9)},${point[1].toFixed(9)}`;
const edgeKey = (a: Position, b: Position): string => {
  const first = key(a); const second = key(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};
const midpoint = (segment: TerrainOutlineSegment): Position => [
  (segment[0][0] + segment[1][0]) / 2,
  (segment[0][1] + segment[1][1]) / 2,
];
const lerp = (from: Position, to: Position, progress: number): Position => [
  from[0] + (to[0] - from[0]) * progress,
  from[1] + (to[1] - from[1]) * progress,
];
const interpolate = (from: TerrainOutlineSegment, to: TerrainOutlineSegment, progress: number): TerrainOutlineSegment => [
  lerp(from[0], to[0], progress),
  lerp(from[1], to[1], progress),
];

type Edge = { segment: TerrainOutlineSegment; cellId: string };

const cellEdges = (ids: Iterable<string>): Edge[] => {
  const result: Edge[] = [];
  for (const id of new Set(ids)) {
    const parsed = parseCellId(id); if (!parsed) continue;
    const ring = cellPolygon(...parsed); if (!ring) continue;
    for (let index = 1; index < ring.length; index += 1) result.push({ segment: [[...ring[index - 1]!], [...ring[index]!]], cellId: id });
  }
  return result;
};

const edgesByCell = (edges: readonly Edge[]): Map<string, TerrainOutlineSegment[]> => {
  const grouped = new Map<string, TerrainOutlineSegment[]>();
  for (const { cellId, segment } of edges) {
    const current = grouped.get(cellId) ?? [];
    current.push(segment);
    grouped.set(cellId, current);
  }
  return grouped;
};

const cellCenterFallback = (edges: readonly TerrainOutlineSegment[]): Position | undefined => {
  if (edges.length === 0) return undefined;
  const points = edges.flatMap((segment) => segment);
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
};

const contactTarget = (edges: readonly TerrainOutlineSegment[], otherEdgeKeys: ReadonlySet<string>): Position | undefined => {
  const contact = edges.find((segment) => otherEdgeKeys.has(edgeKey(segment[0], segment[1])));
  return contact ? midpoint(contact) : undefined;
};

/**
 * Animates the exposed terrain boundary between two cell sets. Shared edges
 * are omitted at every completed state; changed edges grow from a contacting
 * edge (or the cell centre when isolated) and shrink toward the same target.
 */
export const terrainOutlineTransitionSegments = (
  beforeCellIds: Iterable<string>,
  afterCellIds: Iterable<string>,
  progress: number,
): TerrainOutlineTransitionSegment[] => {
  const before = new Set(beforeCellIds);
  const after = new Set(afterCellIds);
  const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (t === 1) return terrainOutlineSegments(after);

  const beforeOutline = terrainOutlineSegments(before);
  const afterOutline = terrainOutlineSegments(after);
  const beforeMap = new Map(beforeOutline.map((segment) => [edgeKey(segment[0], segment[1]), segment]));
  const afterMap = new Map(afterOutline.map((segment) => [edgeKey(segment[0], segment[1]), segment]));
  const beforeCellEdges = cellEdges(before);
  const afterCellEdges = cellEdges(after);
  const beforeEdgesByCell = edgesByCell(beforeCellEdges);
  const afterEdgesByCell = edgesByCell(afterCellEdges);
  const beforeEdgeKeys = new Set(beforeCellEdges.map(({ segment }) => edgeKey(segment[0], segment[1])));
  const afterEdgeKeys = new Set(afterCellEdges.map(({ segment }) => edgeKey(segment[0], segment[1])));
  const beforeOwners = new Map(beforeCellEdges.map(({ segment, cellId }) => [edgeKey(segment[0], segment[1]), cellId]));
  const afterOwners = new Map(afterCellEdges.map(({ segment, cellId }) => [edgeKey(segment[0], segment[1]), cellId]));
  const result: TerrainOutlineTransitionSegment[] = [];

  for (const [edge, segment] of afterMap) {
    const prior = beforeMap.get(edge);
    if (prior) result.push(interpolate(prior, segment, t));
    else {
      const owner = afterOwners.get(edge);
      const ownerEdges = owner ? afterEdgesByCell.get(owner) ?? [] : [];
      const target = contactTarget(ownerEdges, beforeEdgeKeys);
      const start = target ?? cellCenterFallback(ownerEdges) ?? midpoint(segment);
      result.push(interpolate([start, start], segment, t));
    }
  }
  for (const [edge, segment] of beforeMap) {
    if (afterMap.has(edge)) continue;
    const owner = beforeOwners.get(edge);
    const ownerEdges = owner ? beforeEdgesByCell.get(owner) ?? [] : [];
    const target = contactTarget(ownerEdges, afterEdgeKeys);
    const end = target ?? cellCenterFallback(ownerEdges) ?? midpoint(segment);
    result.push(interpolate(segment, [end, end], t));
  }
  return result;
};

export const terrainOutlineTransition = terrainOutlineTransitionSegments;
