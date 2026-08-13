import type { FeatureType, GeoJsonGeometry, Position } from "../backend/types";
import { DrawingGeometryError } from "./errors";

/** Maximum number of coordinates retained for one line or polygon ring. */
export const MAX_DRAW_COORDINATES = 4096;

/** Minimum non-zero area (square degrees) accepted for a polygon ring. */
export const MIN_POLYGON_AREA = 1e-8;

/** Bounds the amount of resampling work a pointer stroke may request. */
export const MAX_SMOOTHING_PASSES = 4;

const WORLD_MIN_X = -180;
const WORLD_MAX_X = 180;
const WORLD_MIN_Y = -90;
const WORLD_MAX_Y = 90;

const samePosition = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

const removeConsecutiveDuplicates = (positions: readonly Position[]): Position[] => {
  const result: Position[] = [];
  for (const position of positions) {
    if (!result.at(-1) || !samePosition(result.at(-1)!, position)) result.push([...position] as Position);
  }
  return result;
};

const distanceSquared = (a: Position, b: Position): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

const assertPosition = (value: unknown): Position => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new DrawingGeometryError("drawing_coordinate_shape");
  }
  const longitude = value[0];
  const latitude = value[1];
  if (typeof longitude !== "number" || typeof latitude !== "number"
    || !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < WORLD_MIN_X || longitude > WORLD_MAX_X
    || latitude < WORLD_MIN_Y || latitude > WORLD_MAX_Y) {
    throw new DrawingGeometryError("drawing_outside_world");
  }
  return [longitude, latitude];
};

const assertPositions = (values: unknown): Position[] => {
  if (!Array.isArray(values)) throw new DrawingGeometryError("drawing_coordinate_collection");
  return values.map(assertPosition);
};

const toleranceForResolution = (resolution: number): number => {
  const safeResolution = Number.isFinite(resolution) && resolution > 0 ? resolution : 0.000_001;
  return Math.max(0.000_001, Math.min(1, safeResolution * 0.7));
};

const perpendicularDistanceSquared = (point: Position, start: Position, end: Position): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceSquared(point, start);
  const cross = (point[0] - start[0]) * dy - (point[1] - start[1]) * dx;
  return (cross * cross) / lengthSquared;
};

/** Iterative RDP keeps endpoints and avoids recursion limits on long pointer paths. */
const simplifyRamerDouglasPeucker = (positions: readonly Position[], tolerance: number): Position[] => {
  if (positions.length <= 2) return positions.map(([x, y]) => [x, y]);
  const kept = new Uint8Array(positions.length);
  kept[0] = 1;
  kept[positions.length - 1] = 1;
  const pending: Array<[number, number]> = [[0, positions.length - 1]];
  const toleranceSquared = tolerance * tolerance;
  while (pending.length > 0) {
    const [startIndex, endIndex] = pending.pop()!;
    let farthestIndex = -1;
    let farthestDistance = toleranceSquared;
    const start = positions[startIndex]!;
    const end = positions[endIndex]!;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistanceSquared(positions[index]!, start, end);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0) {
      kept[farthestIndex] = 1;
      pending.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  const result: Position[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    if (kept[index] === 1) result.push([...positions[index]!] as Position);
  }
  return result;
};

const capCoordinates = (positions: readonly Position[], closed: boolean): Position[] => {
  if (positions.length <= MAX_DRAW_COORDINATES) return positions.map(([x, y]) => [x, y]);
  const target = closed ? MAX_DRAW_COORDINATES - 1 : MAX_DRAW_COORDINATES;
  if (target < (closed ? 3 : 2)) throw new DrawingGeometryError("drawing_too_small");
  const result: Position[] = [];
  for (let index = 0; index < target; index += 1) {
    const sourceIndex = Math.round((index * (positions.length - 1)) / (target - 1));
    result.push([...positions[sourceIndex]!] as Position);
  }
  if (closed) result.push([...result[0]!] as Position);
  return result;
};

const smoothOpenLine = (positions: readonly Position[]): Position[] => {
  if (positions.length < 3) return positions.map(([x, y]) => [x, y]);
  const result: Position[] = [[...positions[0]!] as Position];
  for (let index = 0; index < positions.length - 1; index += 1) {
    const [ax, ay] = positions[index]!;
    const [bx, by] = positions[index + 1]!;
    result.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    result.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  result.push([...positions[positions.length - 1]!] as Position);
  return result;
};

const smoothClosedRing = (ring: readonly Position[]): Position[] => {
  const open = ring.length > 1 && samePosition(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : [...ring];
  if (open.length < 3) return ring.map(([x, y]) => [x, y]);
  const result: Position[] = [];
  for (let index = 0; index < open.length; index += 1) {
    const [ax, ay] = open[index]!;
    const [bx, by] = open[(index + 1) % open.length]!;
    result.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    result.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  result.push([...result[0]!] as Position);
  return result;
};

const signedArea = (ring: readonly Position[]): number => {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [ax, ay] = ring[index]!;
    const [bx, by] = ring[index + 1]!;
    sum += ax * by - bx * ay;
  }
  return sum / 2;
};

const orientation = (a: Position, b: Position, c: Position): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const onSegment = (a: Position, b: Position, point: Position): boolean =>
  point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0])
  && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);

const segmentsIntersect = (a: Position, b: Position, c: Position, d: Position): boolean => {
  const epsilon = 1e-12;
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon))
    && ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))) return true;
  return (Math.abs(first) <= epsilon && onSegment(a, b, c))
    || (Math.abs(second) <= epsilon && onSegment(a, b, d))
    || (Math.abs(third) <= epsilon && onSegment(c, d, a))
    || (Math.abs(fourth) <= epsilon && onSegment(c, d, b));
};

const assertRing = (ring: readonly Position[]): void => {
  if (ring.length < 4 || !samePosition(ring[0]!, ring[ring.length - 1]!)) {
    throw new DrawingGeometryError("drawing_ring_open");
  }
  for (let first = 0; first < ring.length - 1; first += 1) {
    for (let second = first + 1; second < ring.length - 1; second += 1) {
      if (second === first + 1 || (first === 0 && second === ring.length - 2)) continue;
      if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) {
        throw new DrawingGeometryError("drawing_self_intersection");
      }
    }
  }
  if (Math.abs(signedArea(ring)) < MIN_POLYGON_AREA) {
    throw new DrawingGeometryError("drawing_zero_area");
  }
};

const refineLine = (positions: readonly Position[], resolution: number, smoothingPasses: number): Position[] => {
  if (positions.length < 2) throw new DrawingGeometryError("drawing_line_too_short");
  const simplified = simplifyRamerDouglasPeucker(positions, toleranceForResolution(resolution));
  if (simplified.length < 2 || samePosition(simplified[0]!, simplified[simplified.length - 1]!)) {
    throw new DrawingGeometryError("drawing_line_too_short");
  }
  let refined = simplified;
  for (let pass = 0; pass < smoothingPasses; pass += 1) refined = smoothOpenLine(refined);
  return capCoordinates(refined, false);
};

const refineRing = (ring: readonly Position[], resolution: number, smoothingPasses: number): Position[] => {
  if (ring.length < 3) throw new DrawingGeometryError("drawing_ring_too_short");
  const normalized = removeConsecutiveDuplicates(ring);
  const closed = normalized.length > 1 && samePosition(normalized[0]!, normalized[normalized.length - 1]!)
    ? normalized
    : [...normalized, [...normalized[0]!] as Position];
  // Validate the geometry the user will actually save. Raw freehand samples
  // can contain stationary duplicates or tiny jitter that simplification removes.
  if (closed.length < 4) throw new DrawingGeometryError("drawing_ring_too_short");
  const open = simplifyRamerDouglasPeucker(closed, toleranceForResolution(resolution)).slice(0, -1);
  if (open.length < 3) throw new DrawingGeometryError("drawing_zero_area");
  let refined = [...open, open[0]!] as Position[];
  for (let pass = 0; pass < smoothingPasses; pass += 1) refined = smoothClosedRing(refined);
  const capped = capCoordinates(refined, true);
  assertRing(capped);
  return capped;
};

const assertGeometryObject = (geometry: GeoJsonGeometry): void => {
  if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
    throw new DrawingGeometryError("drawing_invalid_geometry");
  }
};

export type DrawingRefinementOptions = { smoothingPasses?: number };

const defaultSmoothingPasses = (featureType: FeatureType): number =>
  featureType === "terrain" || featureType === "forest" || featureType === "lake" ? 2 : 1;

const resolveSmoothingPasses = (featureType: FeatureType, options?: DrawingRefinementOptions): number => {
  const smoothingPasses = options?.smoothingPasses ?? defaultSmoothingPasses(featureType);
  if (!Number.isInteger(smoothingPasses) || smoothingPasses < 0 || smoothingPasses > MAX_SMOOTHING_PASSES) {
    throw new DrawingGeometryError("drawing_smoothing");
  }
  return smoothingPasses;
};

/** Refines raw pointer geometry while preserving feature semantics and world bounds. */
export const refineDrawnGeometry = (
  featureType: FeatureType,
  geometry: GeoJsonGeometry,
  resolution: number,
  options?: DrawingRefinementOptions,
): GeoJsonGeometry => {
  assertGeometryObject(geometry);
  const smoothingPasses = resolveSmoothingPasses(featureType, options);
  if (geometry.type === "Point") {
    assertPosition(geometry.coordinates);
    return geometry;
  }
  if (geometry.type === "LineString") {
    const positions = assertPositions(geometry.coordinates);
    return { type: "LineString", coordinates: refineLine(positions, resolution, smoothingPasses) };
  }
  if (geometry.type !== "Polygon") throw new DrawingGeometryError("drawing_unsupported_geometry");
  const rings = geometry.coordinates;
  if (!Array.isArray(rings) || rings.length === 0) throw new DrawingGeometryError("drawing_missing_ring");
  const coordinates = rings.map((rawRing) => refineRing(assertPositions(rawRing), resolution, smoothingPasses));
  return { type: "Polygon", coordinates };
};

/** Snaps an endpoint to the nearest multiple of an angle step from the previous point. */
export const snapPositionToAngle = (previous: Position, next: Position, stepDegrees: number): Position => {
  const start = assertPosition(previous);
  const end = assertPosition(next);
  if (!Number.isFinite(stepDegrees) || stepDegrees <= 0 || stepDegrees > 360) {
    throw new DrawingGeometryError("drawing_angle");
  }
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new DrawingGeometryError("drawing_zero_length");
  const stepRadians = stepDegrees * Math.PI / 180;
  const snappedAngle = Math.round(Math.atan2(dy, dx) / stepRadians) * stepRadians;
  const snapped: Position = [start[0] + Math.cos(snappedAngle) * length, start[1] + Math.sin(snappedAngle) * length];
  assertPosition(snapped);
  return snapped;
};
