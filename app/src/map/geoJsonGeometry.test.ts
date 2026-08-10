import Feature from "ol/Feature";
import GeometryCollection from "ol/geom/GeometryCollection";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import type { GeoJsonGeometry } from "../backend";
import { drawTypeForMode, featureGeometryIsValid, geometryFromGeoJson, geometryToGeoJson } from "./geoJsonGeometry";
import { createCellStyle, createFeatureStyle } from "./styles";

describe("map geometry modules", () => {
  it("converts every supported geometry in both directions", () => {
    const point: GeoJsonGeometry = { type: "Point", coordinates: [12, 34] };
    const line: GeoJsonGeometry = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    const polygon: GeoJsonGeometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] };

    expect(geometryFromGeoJson(point)).toBeInstanceOf(Point);
    expect(geometryFromGeoJson(line)).toBeInstanceOf(LineString);
    expect(geometryFromGeoJson(polygon)).toBeInstanceOf(Polygon);
    expect(geometryToGeoJson(new Point([12, 34]))).toEqual(point);
    expect(geometryToGeoJson(new LineString(line.coordinates.map((position) => [...position])))).toEqual(line);
    expect(geometryToGeoJson(new Polygon(polygon.coordinates.map((ring) => ring.map((position) => [...position]))))).toEqual(polygon);
    expect(() => geometryToGeoJson(new GeometryCollection([]))).toThrow("Unsupported Realm geometry");
    expect(() => geometryToGeoJson(new Point([181, 0]))).toThrow("bounded world");
  });

  it("maps feature modes and validates snapshot geometry", () => {
    expect(drawTypeForMode("city")).toBe("Point");
    expect(drawTypeForMode("town")).toBe("Point");
    expect(drawTypeForMode("river")).toBe("LineString");
    expect(drawTypeForMode("coastline")).toBe("LineString");
    expect(drawTypeForMode("boundary")).toBe("LineString");
    expect(drawTypeForMode("terrain")).toBe("Polygon");
    expect(featureGeometryIsValid({ id: "valid", featureType: "city", name: "Valid", geometry: { type: "Point", coordinates: [0, 0] } })).toBe(true);
    expect(featureGeometryIsValid({ id: "invalid", featureType: "city", name: "Invalid", geometry: { type: "Point", coordinates: [181, 0] } })).toBe(false);
  });

  it("caches feature and cell presentation by visible state", () => {
    const featureStyle = createFeatureStyle();
    const country = new Feature({ featureType: "country", name: "A" });
    const unknown = new Feature();
    expect(featureStyle(country)).toBe(featureStyle(country));
    expect(featureStyle(unknown).getText()).toBeNull();

    const cellStyle = createCellStyle();
    const empty = new Feature({ attributes: [], selected: false, showGrid: false });
    const layered = new Feature({
      attributes: [
        { cellId: "0:0", attribute: "country", value: "A" },
        { cellId: "0:0", attribute: "region", value: "B" },
      ],
      selected: true,
      showGrid: true,
    });
    expect(cellStyle(empty)).toBeUndefined();
    expect(cellStyle(layered)).toHaveLength(4);
    expect(cellStyle(layered)).toBe(cellStyle(layered));
  });
});
