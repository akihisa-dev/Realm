import type { GeoJsonGeometry, Position } from "../backend";
import { snapPositionToAngle } from "./drawingGeometry";

const samePosition = (first: Position, second: Position): boolean => first[0] === second[0] && first[1] === second[1];

/** Returns the resolution needed to keep the complete extent visible. */
export const resolutionForFittingExtent = (extent: readonly [number, number, number, number], size: readonly [number, number]): number => {
  const [width, height] = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return Number.NaN;
  const extentWidth = extent[2] - extent[0]; const extentHeight = extent[3] - extent[1];
  if (!Number.isFinite(extentWidth) || !Number.isFinite(extentHeight) || extentWidth <= 0 || extentHeight <= 0) return Number.NaN;
  return Math.max(extentWidth / width, extentHeight / height);
};

export const snapFinalGeometry = (geometry: GeoJsonGeometry, stepDegrees: number): GeoJsonGeometry => {
  if (geometry.type === "Point") return geometry;
  if (geometry.type === "LineString") {
    if (geometry.coordinates.length < 2) return geometry;
    const coordinates = geometry.coordinates.map(([x, y]) => [x, y] as Position);
    for (let index = 1; index < coordinates.length; index += 1) coordinates[index] = snapPositionToAngle(coordinates[index - 1]!, coordinates[index]!, stepDegrees);
    return { type: "LineString", coordinates };
  }
  const coordinates = geometry.coordinates.map((rawRing) => {
    const ring = rawRing.map(([x, y]) => [x, y] as Position); const closed = ring.length > 1 && samePosition(ring[0]!, ring.at(-1)!); const endpoint = closed ? ring.length - 2 : ring.length - 1;
    for (let index = 1; index <= endpoint; index += 1) ring[index] = snapPositionToAngle(ring[index - 1]!, ring[index]!, stepDegrees);
    if (closed) ring[ring.length - 1] = [...ring[0]!] as Position; return ring;
  });
  return { type: "Polygon", coordinates };
};

export const straightenLine = (geometry: GeoJsonGeometry): GeoJsonGeometry => geometry.type === "LineString" && geometry.coordinates.length > 2
  ? { type: "LineString", coordinates: [geometry.coordinates[0]!, geometry.coordinates.at(-1)!] } : geometry;

export const nudgeGeometry = (geometry: GeoJsonGeometry, offset: Position): GeoJsonGeometry => {
  const move = ([longitude, latitude]: Position): Position => [longitude + offset[0], latitude + offset[1]];
  if (geometry.type === "Point") return { type: "Point", coordinates: move(geometry.coordinates) };
  if (geometry.type === "LineString") return { type: "LineString", coordinates: geometry.coordinates.map(move) };
  return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => ring.map(move)) };
};
