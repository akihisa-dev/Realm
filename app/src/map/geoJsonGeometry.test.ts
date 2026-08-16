import Feature from "ol/Feature";
import GeometryCollection from "ol/geom/GeometryCollection";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import type { GeoJsonGeometry, MapObject } from "../backend";
import { drawTypeForMode, geometryFromGeoJson, geometryToGeoJson, objectGeometryIsValid } from "./geoJsonGeometry";
import { createCellStyle, createObjectStyle } from "./styles";

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

  it("maps canonical layer and object drawing modes", () => {
    expect(drawTypeForMode("city")).toBe("Point");
    expect(drawTypeForMode("text")).toBe("Point");
    expect(drawTypeForMode("mountain")).toBe("Point");
    expect(drawTypeForMode("forest")).toBe("Polygon");
    expect(drawTypeForMode("shape")).toBe("Polygon");
    const valid: MapObject = { id: "valid", kind: "city", label: "Valid", geometry: { type: "Point", coordinates: [0, 0] }, properties: {}, zIndex: 0, locked: false };
    expect(objectGeometryIsValid(valid)).toBe(true);
    expect(objectGeometryIsValid({ ...valid, geometry: { type: "Point", coordinates: [181, 0] } })).toBe(false);
  });

  it("caches canonical object and cell presentation by visible state", () => {
    const objectStyle = createObjectStyle();
    const city = new Feature({ kind: "city", label: "A", properties: {} });
    expect(objectStyle(city)).toBe(objectStyle(city));
    const hidden = new Feature({ kind: "city", label: "Hidden", properties: { visible: false } });
    expect(objectStyle(hidden)).toBeUndefined();
    const unknown = new Feature();
    expect(objectStyle(unknown)).toBeDefined();

    const cellStyle = createCellStyle();
    const empty = new Feature({ attributes: [], selected: false });
    const layered = new Feature({ attributes: [{ cellId: "0:0", layer: "terrain", value: "terrain" }], selected: true });
    expect(cellStyle(empty)).toBeUndefined();
    expect(cellStyle(layered)).toHaveLength(1);
    expect(cellStyle(layered)).toBe(cellStyle(layered));
  });

  it("invalidates object styles when properties or theme visibility change", () => {
    let visible = true;
    let overrides = { settlement: "#102030" };
    const objectStyle = createObjectStyle(() => "ink", () => visible, () => undefined, () => overrides);
    const city = new Feature({ kind: "city", label: "City", properties: {} });
    const before = objectStyle(city);
    city.set("properties", { scale: 2 });
    const after = objectStyle(city);
    expect(after).not.toBe(before);
    overrides = { settlement: "#405060" };
    expect(objectStyle(city)).not.toBe(after);
    visible = false;
    expect(objectStyle(city)).toBeUndefined();
  });
});
