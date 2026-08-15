import type { Position } from "../backend";
import { cellCenter, cellPolygon, parseCellId } from "./gridGeometry";

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
 * Derives only the exposed edges of a transient terrain-cell set derived from
 * canonical map shapes. Shared edges cancel, so adjacent cells render as one
 * unfilled terrain mass rather than as individually painted hexagons.
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

/** Returns one renderer-only marker position for each valid terrain cell. */
export const terrainCellCenters = (cellIds: Iterable<string>): Position[] => {
  const centers: Position[] = [];
  for (const id of new Set(cellIds)) {
    const position = parseCellId(id);
    if (!position) continue;
    centers.push([...cellCenter(...position)] as Position);
  }
  return centers;
};

export type CellBoundaryRing = Position[];
export type CellBoundaryPolygon = CellBoundaryRing[];
const RING_EPSILON = 1e-8;
const pointKey = ([x, y]: Position): string => `${x.toFixed(9)},${y.toFixed(9)}`;
const samePoint = (a: Position, b: Position): boolean => Math.abs(a[0] - b[0]) <= RING_EPSILON && Math.abs(a[1] - b[1]) <= RING_EPSILON;
const ringArea = (ring: readonly Position[]): number => { let area = 0; for (let index = 1; index < ring.length; index += 1) area += ring[index - 1]![0] * ring[index]![1] - ring[index]![0] * ring[index - 1]![1]; return area / 2; };
const pointInRing = (point: Position, ring: readonly Position[]): boolean => { let inside = false; for (let index = 1; index < ring.length; index += 1) { const a = ring[index - 1]!; const b = ring[index]!; if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const polygonsFromRings = (rings: readonly CellBoundaryRing[]): CellBoundaryPolygon[] => {
  const shells = rings.filter((ring) => ringArea(ring) > 0); const holes = rings.filter((ring) => ringArea(ring) < 0); const polygons = shells.map((ring) => [ring]);
  for (const hole of holes) { const owner = polygons.find(([shell]) => shell && pointInRing(hole[0]!, shell)); if (owner) owner.push(hole); }
  return polygons;
};

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

const cross = (a: Position, b: Position, c: Position): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const distanceSquared = (a: Position, b: Position): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const pointSegmentDistanceSquared = (point: Position, start: Position, end: Position): number => {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return distanceSquared(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return distanceSquared(point, [start[0] + t * dx, start[1] + t * dy]);
};
const segmentsIntersect = (a: Position, b: Position, c: Position, d: Position): boolean => {
  const epsilon = 1e-9;
  const orientation = (first: Position, second: Position, third: Position): number => cross(first, second, third);
  const abC = orientation(a, b, c); const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a); const cdB = orientation(c, d, b);
  const onSegment = (point: Position, start: Position, end: Position): boolean =>
    point[0] >= Math.min(start[0], end[0]) - epsilon && point[0] <= Math.max(start[0], end[0]) + epsilon
    && point[1] >= Math.min(start[1], end[1]) - epsilon && point[1] <= Math.max(start[1], end[1]) + epsilon;
  return (abC * abD < -(epsilon ** 2) && cdA * cdB < -(epsilon ** 2))
    || (Math.abs(abC) <= epsilon && onSegment(c, a, b)) || (Math.abs(abD) <= epsilon && onSegment(d, a, b))
    || (Math.abs(cdA) <= epsilon && onSegment(a, c, d)) || (Math.abs(cdB) <= epsilon && onSegment(b, c, d));
};
const hasSelfIntersection = (ring: readonly Position[]): boolean => {
  if (ring.length > 512) return false;
  for (let first = 1; first < ring.length; first += 1) {
    for (let second = first + 1; second < ring.length; second += 1) {
      if (second === first + 1 || (first === 1 && second === ring.length - 1)) continue;
      if (segmentsIntersect(ring[first - 1]!, ring[first]!, ring[second - 1]!, ring[second]!)) return true;
    }
  }
  return false;
};

const turnAngle = (start: Position, vertex: Position, end: Position): number => {
  const incomingX = vertex[0] - start[0]; const incomingY = vertex[1] - start[1];
  const outgoingX = end[0] - vertex[0]; const outgoingY = end[1] - vertex[1];
  return Math.atan2(cross(start, vertex, end), incomingX * outgoingX + incomingY * outgoingY);
};

const simplifyOpenBoundaryPath = (path: readonly Position[], tolerance: number): CellBoundaryRing => {
  if (path.length <= 2) return path.map((point) => [...point] as Position);
  const keep = new Set<number>([0, path.length - 1]);
  const pending: [number, number][] = [[0, path.length - 1]];
  const toleranceSquared = tolerance ** 2;
  while (pending.length > 0) {
    const [start, end] = pending.pop()!;
    let maximumDistance = toleranceSquared; let maximumIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = pointSegmentDistanceSquared(path[index]!, path[start]!, path[end]!);
      if (distance > maximumDistance) { maximumDistance = distance; maximumIndex = index; }
    }
    if (maximumIndex >= 0) {
      keep.add(maximumIndex);
      pending.push([start, maximumIndex], [maximumIndex, end]);
    }
  }
  return path.filter((_, index) => keep.has(index)).map((point) => [...point] as Position);
};

/** Removes alternating hex-grid waves while keeping accumulated turns as anchors. */
const simplifyBoundaryRing = (ring: CellBoundaryRing): CellBoundaryRing => {
  const input = ring.slice(0, -1);
  if (input.length < 24) return ring;
  const lengths = input.map((point, index) => Math.sqrt(distanceSquared(point, input[(index + 1) % input.length]!))).sort((a, b) => a - b);
  const medianEdge = lengths[Math.floor(lengths.length / 2)] ?? 0;
  if (!Number.isFinite(medianEdge) || medianEdge <= 0) return ring;

  const featureTurnThreshold = Math.PI * 0.36;
  const curvatureWindow = 2;
  const anchors = input.flatMap((_, index) => {
    let accumulatedTurn = 0;
    for (let offset = -curvatureWindow; offset <= curvatureWindow; offset += 1) {
      const vertex = (index + offset + input.length) % input.length;
      accumulatedTurn += turnAngle(
        input[(vertex - 1 + input.length) % input.length]!,
        input[vertex]!,
        input[(vertex + 1) % input.length]!,
      );
    }
    return Math.abs(accumulatedTurn) > featureTurnThreshold ? [index] : [];
  });
  if (anchors.length < 2) return ring;

  const simplified: CellBoundaryRing = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const start = anchors[anchorIndex]!;
    const end = anchors[(anchorIndex + 1) % anchors.length]!;
    const path: CellBoundaryRing = [];
    for (let index = start; ; index = (index + 1) % input.length) {
      path.push(input[index]!);
      if (index === end) break;
    }
    const span = simplifyOpenBoundaryPath(path, medianEdge * 0.85);
    simplified.push(...span.slice(0, -1));
  }
  if (simplified.length < 4) return ring;
  const closed = [...simplified, [...simplified[0]!] as Position];
  const originalArea = ringArea(ring); const simplifiedArea = ringArea(closed);
  return Math.sign(simplifiedArea) === Math.sign(originalArea) && Math.abs(simplifiedArea) > RING_EPSILON ? closed : ring;
};

type RingBounds = [minX: number, maxX: number, minY: number, maxY: number];
const ringBounds = (ring: readonly Position[]): RingBounds | null => {
  if (ring.length === 0) return null;
  let minX = ring[0]![0]; let maxX = minX; let minY = ring[0]![1]; let maxY = minY;
  for (const [x, y] of ring.slice(1)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return [minX, maxX, minY, maxY];
};
const boundsOverlap = (first: RingBounds, second: RingBounds): boolean =>
  first[0] <= second[1] && second[0] <= first[1] && first[2] <= second[3] && second[2] <= first[3];
const sameRing = (first: readonly Position[], second: readonly Position[]): boolean =>
  first.length === second.length && first.every((point, index) => point[0] === second[index]![0] && point[1] === second[index]![1]);

const simplificationKeepsOriginalRing = (exact: readonly Position[], simplified: readonly Position[]): boolean => {
  if (sameRing(exact, simplified)) return true;
  const input = exact.slice(0, -1);
  const indexesByPoint = new Map(input.map((point, index) => [pointKey(point), index] as const));
  const indexes = simplified.slice(0, -1).map((point) => indexesByPoint.get(pointKey(point)) ?? -1);
  if (indexes.some((index) => index < 0) || new Set(indexes).size !== indexes.length || indexes.length < 4) return false;
  for (let index = 0; index < indexes.length; index += 1) {
    const start = indexes[index]!; const end = indexes[(index + 1) % indexes.length]!;
    for (let cursor = end; cursor !== start; cursor = (cursor + 1) % input.length) {
      const next = (cursor + 1) % input.length;
      if (cursor === start || next === start || cursor === end || next === end) continue;
      if (segmentsIntersect(input[start]!, input[end]!, input[cursor]!, input[next]!)) return false;
    }
  }
  return true;
};

const simplificationKeepsSeparateRings = (exact: readonly CellBoundaryRing[], simplified: readonly CellBoundaryRing[]): boolean => {
  if (simplified.some(hasSelfIntersection)) return false;
  const changed = simplified.map((ring, index) => !sameRing(ring, exact[index] ?? []));
  const changedIndexes = changed.flatMap((isChanged, index) => isChanged ? [index] : []);
  if (changedIndexes.length === 0) return true;
  if (changedIndexes.some((index) => !simplificationKeepsOriginalRing(exact[index]!, simplified[index]!))) return false;
  const exactBounds = exact.map(ringBounds); const simplifiedBounds = simplified.map(ringBounds);
  const intersects = (leftIndex: number, rightIndex: number): boolean => {
    if (!simplifiedBounds[leftIndex] || !exactBounds[rightIndex] || !boundsOverlap(simplifiedBounds[leftIndex]!, exactBounds[rightIndex]!)) return false;
    const left = simplified[leftIndex]!; const right = exact[rightIndex]!;
    for (let leftEdge = 1; leftEdge < left.length; leftEdge += 1) {
      for (let rightEdge = 1; rightEdge < right.length; rightEdge += 1) {
        if (segmentsIntersect(left[leftEdge - 1]!, left[leftEdge]!, right[rightEdge - 1]!, right[rightEdge]!)) return true;
      }
    }
    return false;
  };
  for (const first of changedIndexes) {
    for (let second = 0; second < simplified.length; second += 1) {
      if (first === second || (changed[second] && second < first)) continue;
      if (intersects(first, second) || (changed[second] && intersects(second, first))) return false;
    }
  }
  return true;
};

/** Produces presentation-only curves and falls back to exact rings on unsafe output. */
export const smoothCellBoundaryRings = (cellIds: Iterable<string>): CellBoundaryRing[] => {
  const exact = exactCellBoundaryRings(cellIds); const simplified = exact.map(simplifyBoundaryRing);
  const safeSimplification = simplificationKeepsSeparateRings(exact, simplified);
  const smooth = (safeSimplification ? simplified : exact).map((ring) => chaikin(chaikin(ring)));
  const valid = smooth.flat().length <= 65536 && smooth.every((ring) => ring.length >= 4 && samePoint(ring[0]!, ring.at(-1)!) && ring.flat().every(Number.isFinite) && Math.abs(ringArea(ring)) > RING_EPSILON && ring.every(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90));
  return valid ? smooth : exact;
};

export const exactCellBoundaryPolygons = (cellIds: Iterable<string>): CellBoundaryPolygon[] => polygonsFromRings(exactCellBoundaryRings(cellIds));
export const smoothCellBoundaryPolygons = (cellIds: Iterable<string>): CellBoundaryPolygon[] => polygonsFromRings(smoothCellBoundaryRings(cellIds));
