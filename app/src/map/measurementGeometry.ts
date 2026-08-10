import type { Position } from "../backend/types";
import { CELL_GRID_COLUMNS, CELL_GRID_ROWS } from "./gridGeometry";

/**
 * Measurements intentionally use a flat EPSG:4326 approximation: values are
 * returned in longitude/latitude degrees and square degrees, not kilometres.
 * This is suitable for the bounded authoring grid and avoids implying geodesic
 * accuracy at world scale.
 */
export const WORLD_GRID_CELL_SIZE: readonly [number, number] = [
  360 / CELL_GRID_COLUMNS,
  180 / CELL_GRID_ROWS,
];

const assertPosition = (value: unknown): Position => {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number"
    || !Number.isFinite(value[0]) || !Number.isFinite(value[1])
    || value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
    throw new Error("Measurement coordinates must be finite positions within the bounded world.");
  }
  return [value[0], value[1]];
};

const assertPath = (positions: readonly Position[]): Position[] => positions.map(assertPosition);

/** Returns a planar degree length for a polyline in EPSG:4326. */
export const polylineLengthDegrees = (positions: readonly Position[]): number => {
  const path = assertPath(positions);
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const dx = path[index]![0] - path[index - 1]![0];
    const dy = path[index]![1] - path[index - 1]![1];
    length += Math.hypot(dx, dy);
  }
  return length;
};

/** Alias suitable for UI measurement controls. */
export const lineLength = polylineLengthDegrees;

const signedRingArea = (ring: readonly Position[]): number => {
  if (ring.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
};

/**
 * Returns a polygon's planar square-degree area. For multiple rings, the first
 * ring is the shell and subsequent rings are holes; ring winding is ignored.
 */
export const polygonAreaSquareDegrees = (rings: readonly Position[] | readonly (readonly Position[])[]): number => {
  const ringList: readonly Position[][] = rings.length === 0
    ? []
    : (Array.isArray(rings[0]?.[0])
      ? (rings as readonly (readonly Position[])[]).map((ring) => assertPath(ring))
      : [assertPath(rings as readonly Position[])]);
  if (ringList.length === 0) return 0;
  const shell = Math.abs(signedRingArea(ringList[0]!));
  const holes = ringList.slice(1).reduce((total, ring) => total + Math.abs(signedRingArea(ring)), 0);
  return Math.max(0, shell - holes);
};

/** Alias suitable for geometry inspectors. */
export const polygonArea = polygonAreaSquareDegrees;
