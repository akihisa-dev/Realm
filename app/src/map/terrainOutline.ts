import type { Position } from "../backend";
import { cellPolygon, parseCellId } from "./gridGeometry";

export type TerrainOutlineSegment = [Position, Position];
export type TerrainGridSegments = {
  inside: TerrainOutlineSegment[];
  outside: TerrainOutlineSegment[];
};

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

/** Splits the fixed editing grid into edges inside terrain and outside it. */
export const splitTerrainGridSegments = (
  fixedSegments: readonly Position[][],
  cellIds: Iterable<string>,
): TerrainGridSegments => {
  const insideKeys = new Set<string>();
  for (const id of new Set(cellIds)) {
    const position = parseCellId(id);
    if (!position) continue;
    const ring = cellPolygon(...position);
    if (!ring) continue;
    for (let index = 1; index < ring.length; index += 1) insideKeys.add(edgeKey(ring[index - 1]!, ring[index]!));
  }
  const result: TerrainGridSegments = { inside: [], outside: [] };
  for (const segment of fixedSegments) {
    const start = segment[0];
    const end = segment[1];
    if (!start || !end) continue;
    result[insideKeys.has(edgeKey(start, end)) ? "inside" : "outside"].push([[...start], [...end]]);
  }
  return result;
};

export type CellBoundaryRing = Position[];
export type CellBoundaryPolygon = CellBoundaryRing[];
const RING_EPSILON = 1e-8;
const pointKey = ([x, y]: Position): string => `${x.toFixed(9)},${y.toFixed(9)}`;
const samePoint = (a: Position, b: Position): boolean => Math.abs(a[0] - b[0]) <= RING_EPSILON && Math.abs(a[1] - b[1]) <= RING_EPSILON;
const ringArea = (ring: readonly Position[]): number => { let area = 0; for (let index = 1; index < ring.length; index += 1) area += ring[index - 1]![0] * ring[index]![1] - ring[index]![0] * ring[index - 1]![1]; return area / 2; };
const pointInRing = (point: Position, ring: readonly Position[]): boolean => { let inside = false; for (let index = 1; index < ring.length; index += 1) { const a = ring[index - 1]!; const b = ring[index]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };

/** Joins exposed cell edges into deterministic closed rings. */
export const exactCellBoundaryRings = (cellIds: Iterable<string>): CellBoundaryRing[] => {
  const edges = new Map<string, { count: number; start: Position; end: Position }>();
  for (const id of new Set(cellIds)) {
    const parsed = parseCellId(id); if (!parsed) continue;
    const polygon = cellPolygon(...parsed); if (!polygon) continue;
    for (let index = 1; index < polygon.length; index += 1) {
      const start = [...polygon[index - 1]!] as Position; const end = [...polygon[index]!] as Position;
      const key = edgeKey(start, end); const prior = edges.get(key);
      if (prior) prior.count += 1; else edges.set(key, { count: 1, start, end });
    }
  }
  const exposed = [...edges.values()].filter(({ count }) => count === 1);
  const outgoing = new Map<string, typeof exposed>();
  for (const edge of exposed) { const list = outgoing.get(pointKey(edge.start)) ?? []; list.push(edge); outgoing.set(pointKey(edge.start), list); }
  for (const list of outgoing.values()) list.sort((a, b) => pointKey(a.end).localeCompare(pointKey(b.end)));
  const identity = (edge: typeof exposed[number]): string => `${pointKey(edge.start)}>${pointKey(edge.end)}`;
  const used = new Set<string>(); const rings: CellBoundaryRing[] = [];
  for (const seed of exposed.slice().sort((a, b) => identity(a).localeCompare(identity(b)))) {
    if (used.has(identity(seed))) continue;
    const ring: CellBoundaryRing = [[...seed.start] as Position]; let current = seed; let closed = false;
    for (let guard = 0; guard < 65536; guard += 1) {
      used.add(identity(current)); ring.push([...current.end] as Position);
      if (samePoint(current.end, ring[0]!)) { closed = true; break; }
      const next = (outgoing.get(pointKey(current.end)) ?? []).find((candidate) => !used.has(identity(candidate)));
      if (!next) break; current = next;
    }
    if (closed && ring.length >= 4 && Math.abs(ringArea(ring)) > RING_EPSILON) rings.push(ring);
  }
  return rings;
};

const chaikin = (ring: CellBoundaryRing): CellBoundaryRing => {
  const input = ring.slice(0, -1); const output: CellBoundaryRing = [];
  for (let index = 0; index < input.length; index += 1) { const a = input[index]!; const b = input[(index + 1) % input.length]!; output.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
  output.push([...output[0]!] as Position); return output;
};

/** Produces presentation-only curves and falls back to exact rings on unsafe output. */
export const smoothCellBoundaryRings = (cellIds: Iterable<string>): CellBoundaryRing[] => {
  const exact = exactCellBoundaryRings(cellIds); const smooth = exact.map((ring) => chaikin(chaikin(ring)));
  const valid = smooth.flat().length <= 65536 && smooth.every((ring) => ring.length >= 4 && samePoint(ring[0]!, ring.at(-1)!) && ring.flat().every(Number.isFinite) && Math.abs(ringArea(ring)) > RING_EPSILON && ring.every(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90));
  return valid ? smooth : exact;
};

export const smoothCellBoundaryPolygons = (cellIds: Iterable<string>): CellBoundaryPolygon[] => {
  const rings = smoothCellBoundaryRings(cellIds); const shells = rings.filter((ring) => ringArea(ring) > 0); const holes = rings.filter((ring) => ringArea(ring) < 0); const polygons = shells.map((ring) => [ring]);
  for (const hole of holes) { const owner = polygons.find(([shell]) => shell && pointInRing(hole[0]!, shell)); if (owner) owner.push(hole); }
  return polygons;
};
