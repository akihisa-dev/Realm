import type { GeoJsonGeometry } from "../backend";

type Position = [number, number];

export const isPositionWithinWorld = ([longitude, latitude]: Position): boolean =>
  Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;

export const isGeometryWithinWorld = (geometry: GeoJsonGeometry): boolean => {
  if (geometry.type === "Point") return isPositionWithinWorld(geometry.coordinates);
  const positions = geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
  return positions.every(isPositionWithinWorld);
};

export const assertGeometryWithinWorld = (geometry: GeoJsonGeometry): void => {
  if (!isGeometryWithinWorld(geometry)) throw new Error("Geometry coordinates must be within the bounded world.");
};
