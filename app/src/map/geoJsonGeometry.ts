import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import type Geometry from "ol/geom/Geometry";
import type { GeoJsonGeometry, RealmFeature } from "../backend";
import { assertGeometryWithinWorld } from "./geometryGuard";
import type { RealmMapMode } from "./contracts";

export const geometryFromGeoJson = (geometry: GeoJsonGeometry): Geometry => {
  assertGeometryWithinWorld(geometry);
  if (geometry.type === "Point") return new Point(geometry.coordinates);
  if (geometry.type === "LineString") return new LineString(geometry.coordinates);
  return new Polygon(geometry.coordinates);
};

export const geometryToGeoJson = (geometry: Geometry): GeoJsonGeometry => {
  const encoded: GeoJsonGeometry | null = geometry instanceof Point
    ? { type: "Point", coordinates: geometry.getCoordinates() as [number, number] }
    : geometry instanceof LineString
      ? { type: "LineString", coordinates: geometry.getCoordinates() as [number, number][] }
      : geometry instanceof Polygon
        ? { type: "Polygon", coordinates: geometry.getCoordinates() as [number, number][][] }
        : null;
  if (!encoded) throw new Error("Unsupported Realm geometry.");
  assertGeometryWithinWorld(encoded);
  return encoded;
};

export const drawTypeForMode = (mode: RealmMapMode): "Point" | "LineString" | "Polygon" => mode === "city" || mode === "town"
  ? "Point"
  : mode === "river" || mode === "coastline" || mode === "boundary"
    ? "LineString"
    : "Polygon";

export const featureGeometryIsValid = (feature: RealmFeature): boolean => {
  try {
    assertGeometryWithinWorld(feature.geometry);
    return true;
  } catch {
    return false;
  }
};
