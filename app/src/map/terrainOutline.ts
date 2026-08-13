import type { Position } from "../backend";
import { cellPolygon, parseCellId } from "./gridGeometry";

export type TerrainOutlineSegment = [Position, Position];

const coordinateKey = ([x, y]: Position): string => `${x.toFixed(9)},${y.toFixed(9)}`;

const edgeKey = (start: Position, end: Position): string => {
  const first = coordinateKey(start);
  const second = coordinateKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};

/**
 * Derives only the exposed edges of the persisted terrain-cell set. Shared
 * edges cancel, so adjacent cells render as one unfilled terrain mass rather
 * than as individually painted hexagons.
 */
export const terrainOutlineSegments = (cellIds: Iterable<string>): TerrainOutlineSegment[] => {
  const edges = new Map<string, { count: number; segment: TerrainOutlineSegment }>();
  for (const id of new Set(cellIds)) {
    const position = parseCellId(id);
    if (!position) continue;
    const ring = cellPolygon(...position);
    if (!ring) continue;
    for (let index = 1; index < ring.length; index += 1) {
      const start = ring[index - 1]!;
      const end = ring[index]!;
      const key = edgeKey(start, end);
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { count: 1, segment: [[...start], [...end]] });
    }
  }
  return [...edges.values()].filter(({ count }) => count === 1).map(({ segment }) => segment);
};
