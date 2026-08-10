import type { GeoJsonGeometry, Position } from "../backend";
import { assertGeometryWithinWorld } from "./geometryGuard";

export type TransformOptions = { rotationRadians?: number; flipX?: boolean; flipY?: boolean; offset?: Position; scale?: number };

const positions = (geometry: GeoJsonGeometry): Position[] => geometry.type === "Point"
  ? [geometry.coordinates]
  : geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();

const transformablePositions = (geometry: GeoJsonGeometry): Position[] => {
  const points = positions(geometry);
  if (points.length === 0) throw new Error("Geometry must contain at least one coordinate.");
  assertGeometryWithinWorld(geometry);
  return points;
};

const assertTransformOptions = (options: TransformOptions): { angle: number; offsetX: number; offsetY: number; scale: number } => {
  const angle = options.rotationRadians ?? 0;
  const [offsetX, offsetY] = options.offset ?? [0, 0];
  const scale = options.scale ?? 1;
  if (!Number.isFinite(angle) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(scale)) {
    throw new Error("Transform options must contain finite values.");
  }
  if (scale <= 0 || scale > 100) throw new Error("Transform scale must be greater than zero and at most 100.");
  return { angle, offsetX, offsetY, scale };
};

export const geometryCenter = (geometry: GeoJsonGeometry): Position => {
  const points = transformablePositions(geometry);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/** Returns the center of the combined bounding box for a non-empty geometry collection. */
export const combinedGeometryCenter = (geometries: readonly GeoJsonGeometry[]): Position => {
  if (geometries.length === 0) throw new Error("At least one geometry is required.");
  const points = geometries.flatMap(transformablePositions);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

const transformAroundPivot = (geometry: GeoJsonGeometry, pivot: Position, options: TransformOptions): GeoJsonGeometry => {
  const { angle, offsetX, offsetY, scale } = assertTransformOptions(options);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [centerX, centerY] = pivot;
  const transform = ([x, y]: Position): Position => {
    const localX = (x - centerX) * scale * (options.flipX ? -1 : 1);
    const localY = (y - centerY) * scale * (options.flipY ? -1 : 1);
    return [centerX + localX * cos - localY * sin + offsetX, centerY + localX * sin + localY * cos + offsetY];
  };
  const transformed: GeoJsonGeometry = geometry.type === "Point"
    ? { type: "Point", coordinates: transform(geometry.coordinates) }
    : geometry.type === "LineString"
      ? { type: "LineString", coordinates: geometry.coordinates.map(transform) }
      : { type: "Polygon", coordinates: geometry.coordinates.map((ring) => ring.map(transform)) };
  assertGeometryWithinWorld(transformed);
  return transformed;
};

export const transformGeometry = (geometry: GeoJsonGeometry, options: TransformOptions): GeoJsonGeometry => {
  return transformAroundPivot(geometry, geometryCenter(geometry), options);
};

/** Applies one transform to every geometry around the collection's shared bbox center. */
export const transformGeometries = (geometries: readonly GeoJsonGeometry[], options: TransformOptions): GeoJsonGeometry[] => {
  const pivot = combinedGeometryCenter(geometries);
  assertTransformOptions(options);
  return geometries.map((geometry) => transformAroundPivot(geometry, pivot, options));
};

export const duplicateOffset = (geometry: GeoJsonGeometry, distance = 2): Position => {
  const points = positions(geometry);
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  return [maxX + distance <= 180 ? distance : minX - distance >= -180 ? -distance : 0, maxY + distance <= 90 ? distance : minY - distance >= -90 ? -distance : 0];
};
