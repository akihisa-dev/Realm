import type { GeoJsonGeometry, Position } from "../backend";
import { assertGeometryWithinWorld } from "./geometryGuard";

type TransformOptions = { rotationRadians?: number; flipX?: boolean; flipY?: boolean; offset?: Position };

const positions = (geometry: GeoJsonGeometry): Position[] => geometry.type === "Point"
  ? [geometry.coordinates]
  : geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();

export const geometryCenter = (geometry: GeoJsonGeometry): Position => {
  const points = positions(geometry);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

export const transformGeometry = (geometry: GeoJsonGeometry, options: TransformOptions): GeoJsonGeometry => {
  const [centerX, centerY] = geometryCenter(geometry);
  const angle = options.rotationRadians ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [offsetX, offsetY] = options.offset ?? [0, 0];
  const transform = ([x, y]: Position): Position => {
    const localX = (x - centerX) * (options.flipX ? -1 : 1);
    const localY = (y - centerY) * (options.flipY ? -1 : 1);
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

export const duplicateOffset = (geometry: GeoJsonGeometry, distance = 2): Position => {
  const points = positions(geometry);
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  return [maxX + distance <= 180 ? distance : minX - distance >= -180 ? -distance : 0, maxY + distance <= 90 ? distance : minY - distance >= -90 ? -distance : 0];
};
