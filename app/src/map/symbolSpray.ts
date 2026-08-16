import type { Position } from "../backend/types";

export const WORLD_SPRAY_BOUNDS = Object.freeze({ minX: -180, maxX: 180, minY: -90, maxY: 90 });
export const MAX_SPRAY_COUNT = 10_000;

export type SprayBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type SprayObjectKind = "symbol" | "tree" | "mountain";

export type SprayRange = {
  min: number;
  max: number;
};

export type SprayPolygon = readonly (readonly (readonly [number, number])[])[];

export type SprayOptions = {
  seed: number | string;
  spacing: number;
  maxCount: number;
  bounds?: SprayBounds;
  polygon?: SprayPolygon;
  objectKind?: SprayObjectKind;
  scale?: SprayRange;
  rotation?: SprayRange;
};

export type SprayCandidate = {
  coordinates: Position;
  ordinal: number;
  scale: number;
  rotation: number;
  objectKind?: SprayObjectKind;
};

const DEFAULT_SCALE: SprayRange = { min: 0.85, max: 1.15 };
const DEFAULT_ROTATION: SprayRange = { min: -Math.PI, max: Math.PI };

const isFiniteRange = (range: SprayRange): boolean => Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max;

const seedToUint32 = (seed: number | string): number => {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new Error("The spray seed must be finite.");
    let value = Math.trunc(seed) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    return Math.imul(value, 0x846ca68b) ^ (value >>> 16);
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const makeRandom = (seed: number | string): (() => number) => {
  let state = seedToUint32(seed) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
};

const assertBounds = (bounds: SprayBounds): void => {
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY
    || bounds.minX < WORLD_SPRAY_BOUNDS.minX || bounds.maxX > WORLD_SPRAY_BOUNDS.maxX
    || bounds.minY < WORLD_SPRAY_BOUNDS.minY || bounds.maxY > WORLD_SPRAY_BOUNDS.maxY) {
    throw new Error("Spray bounds must be finite and within the bounded world.");
  }
};

const assertPolygon = (polygon: SprayPolygon): Position[][] => {
  if (polygon.length === 0) throw new Error("Spray polygon must contain a shell ring.");
  return polygon.map((ring) => {
    if (ring.length < 3) throw new Error("Spray polygon rings must contain at least three points.");
    return ring.map((position) => {
      if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)
        || position[0] < WORLD_SPRAY_BOUNDS.minX || position[0] > WORLD_SPRAY_BOUNDS.maxX
        || position[1] < WORLD_SPRAY_BOUNDS.minY || position[1] > WORLD_SPRAY_BOUNDS.maxY) {
        throw new Error("Spray polygon coordinates must be finite and within the bounded world.");
      }
      return [position[0]!, position[1]!] as Position;
    });
  });
};

const pointOnSegment = (point: Position, start: Position, end: Position): boolean => {
  const cross = (point[0] - start[0]) * (end[1] - start[1]) - (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > 1e-10) return false;
  return point[0] >= Math.min(start[0], end[0]) && point[0] <= Math.max(start[0], end[0])
    && point[1] >= Math.min(start[1], end[1]) && point[1] <= Math.max(start[1], end[1]);
};

const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index]!;
    const prior = ring[previous]!;
    if (pointOnSegment(point, prior, current)) return true;
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1])
      && point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0];
    if (crosses) inside = !inside;
  }
  return inside;
};

type RingBounds = { ring: readonly Position[]; minX: number; maxX: number; minY: number; maxY: number };

const prepareRingBounds = (rings: readonly (readonly Position[])[]): RingBounds[] => rings.map((ring) => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { ring, minX, maxX, minY, maxY };
});

const pointInPreparedRing = (point: Position, bounds: RingBounds): boolean =>
  point[0] >= bounds.minX && point[0] <= bounds.maxX && point[1] >= bounds.minY && point[1] <= bounds.maxY
  && pointInRing(point, bounds.ring);

const pointWithinValidatedPolygon = (point: Position, rings: readonly (readonly Position[])[]): boolean =>
  pointInRing(point, rings[0]!) && rings.slice(1).every((hole) => !pointInRing(point, hole));

/** Tests a candidate against a shell and optional holes. Boundary points count as inside. */
export const positionWithinPolygon = (point: Position, polygon: SprayPolygon): boolean => {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
    || point[0] < WORLD_SPRAY_BOUNDS.minX || point[0] > WORLD_SPRAY_BOUNDS.maxX
    || point[1] < WORLD_SPRAY_BOUNDS.minY || point[1] > WORLD_SPRAY_BOUNDS.maxY) {
    throw new Error("Spray point must be finite and within the bounded world.");
  }
  const rings = assertPolygon(polygon);
  return pointWithinValidatedPolygon(point, rings);
};

const polygonBounds = (polygon: readonly (readonly Position[])[]): SprayBounds => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
};

const valueInRange = (random: () => number, range: SprayRange): number => range.min + (range.max - range.min) * random();

/**
 * Produces user-requested, deterministic point candidates for symbol/tree/mountain tools.
 * Coordinates use a flat EPSG:4326 degree approximation; callers persist accepted
 * candidates as ordinary point Features rather than treating this as an implicit layer.
 */
export const generateSprayCandidates = (options: SprayOptions): SprayCandidate[] => {
  const polygon = options.polygon ? assertPolygon(options.polygon) : undefined;
  const bounds = options.bounds ?? (polygon ? polygonBounds(polygon) : WORLD_SPRAY_BOUNDS);
  assertBounds(bounds);
  if (!Number.isFinite(options.spacing) || options.spacing < 0) throw new Error("Spray spacing must be finite and non-negative.");
  if (!Number.isSafeInteger(options.maxCount) || options.maxCount < 0 || options.maxCount > MAX_SPRAY_COUNT) {
    throw new Error(`Spray count must be an integer between 0 and ${MAX_SPRAY_COUNT}.`);
  }
  const scale = options.scale ?? DEFAULT_SCALE;
  const rotation = options.rotation ?? DEFAULT_ROTATION;
  if (!isFiniteRange(scale) || scale.min < 0 || !isFiniteRange(rotation)) throw new Error("Spray ranges must be finite and ordered.");
  if (options.maxCount === 0) return [];

  const random = makeRandom(options.seed);
  const spacingSquared = options.spacing ** 2;
  const candidates: SprayCandidate[] = [];
  const preparedPolygon = polygon ? prepareRingBounds(polygon) : undefined;
  const buckets = new Map<string, SprayCandidate[]>();
  const bucketFor = (point: Position): [number, number] => [
    Math.floor((point[0] - bounds.minX) / options.spacing),
    Math.floor((point[1] - bounds.minY) / options.spacing),
  ];
  const bucketKey = (x: number, y: number): string => `${x}:${y}`;
  // A bounded attempt count makes sparse/large-spacing requests predictable and cheap.
  const attempts = Math.min(MAX_SPRAY_COUNT * 64, Math.max(128, options.maxCount * 64));
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  for (let attempt = 0; attempt < attempts && candidates.length < options.maxCount; attempt += 1) {
    const point: Position = [bounds.minX + random() * width, bounds.minY + random() * height];
    if (preparedPolygon && (!pointInPreparedRing(point, preparedPolygon[0]!)
      || preparedPolygon.slice(1).some((hole) => pointInPreparedRing(point, hole)))) continue;
    let separated = true;
    if (spacingSquared > 0) {
      const [bucketX, bucketY] = bucketFor(point);
      for (let x = bucketX - 1; x <= bucketX + 1 && separated; x += 1) {
        for (let y = bucketY - 1; y <= bucketY + 1; y += 1) {
          for (const candidate of buckets.get(bucketKey(x, y)) ?? []) {
            const dx = point[0] - candidate.coordinates[0];
            const dy = point[1] - candidate.coordinates[1];
            if (dx * dx + dy * dy < spacingSquared) {
              separated = false;
              break;
            }
          }
          if (!separated) break;
        }
      }
    }
    if (!separated) continue;
    const candidate: SprayCandidate = {
      coordinates: point,
      ordinal: candidates.length,
      scale: valueInRange(random, scale),
      rotation: valueInRange(random, rotation),
      ...(options.objectKind ? { objectKind: options.objectKind } : {}),
    };
    candidates.push(candidate);
    if (spacingSquared > 0) {
      const [bucketX, bucketY] = bucketFor(point);
      const key = bucketKey(bucketX, bucketY);
      const bucket = buckets.get(key) ?? [];
      bucket.push(candidate);
      buckets.set(key, bucket);
    }
  }
  return candidates;
};

/** Alias emphasizing that this is an explicit symbol-placement operation. */
export const generateSymbolSpray = generateSprayCandidates;
