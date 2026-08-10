import Feature from "ol/Feature";
import GeometryCollection from "ol/geom/GeometryCollection";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Icon from "ol/style/Icon";
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
    expect(drawTypeForMode("road")).toBe("LineString");
    expect(drawTypeForMode("mountain")).toBe("Point");
    expect(drawTypeForMode("label")).toBe("Point");
    expect(drawTypeForMode("lake")).toBe("Polygon");
    expect(drawTypeForMode("terrain")).toBe("Polygon");
    expect(featureGeometryIsValid({ id: "valid", featureType: "city", name: "Valid", geometry: { type: "Point", coordinates: [0, 0] } })).toBe(true);
    expect(featureGeometryIsValid({ id: "invalid", featureType: "city", name: "Invalid", geometry: { type: "Point", coordinates: [181, 0] } })).toBe(false);
  });

  it("caches feature and cell presentation by visible state", () => {
    const featureStyle = createFeatureStyle();
    const country = new Feature({ featureType: "country", name: "A" });
    const unknown = new Feature();
    expect(featureStyle(country)).toBe(featureStyle(country));
    const unknownStyle = featureStyle(unknown);
    expect(unknownStyle && (Array.isArray(unknownStyle) ? unknownStyle[0]?.getText() : unknownStyle.getText())).toBeNull();

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

  it("invalidates feature style cache when renderer properties change", () => {
    const featureStyle = createFeatureStyle();
    const river = new Feature({ featureType: "river", name: "River", properties: { width: 1 } });
    const before = featureStyle(river);
    river.set("properties", { width: 6, strokeColor: "#102030", casingColor: "#f0f0f0", lineStyle: "dashed" });
    const after = featureStyle(river);
    expect(after).not.toBe(before);
    expect(Array.isArray(after) ? after[1]?.getStroke()?.getWidth() : after?.getStroke()?.getWidth()).toBe(6);
    expect(Array.isArray(after) ? after[1]?.getStroke()?.getColor() : after?.getStroke()?.getColor()).toBe("#102030");
    expect(Array.isArray(after) ? after[1]?.getStroke()?.getLineDash() : after?.getStroke()?.getLineDash()).toEqual([9, 6]);

    const mountain = new Feature({ featureType: "mountain", name: "Peak", properties: { scale: 1, rotation: 0 } });
    const mountainBefore = featureStyle(mountain);
    mountain.set("properties", { scale: 2, rotation: 0.4 });
    const mountainAfter = featureStyle(mountain);
    expect(mountainAfter).not.toBe(mountainBefore);
  });

  it("applies free-label font, colors, halo, rotation, and line placement", () => {
    const featureStyle = createFeatureStyle();
    const label = new Feature({ featureType: "label", name: "North", properties: {
      fontSize: 20,
      textColor: "#123456",
      haloColor: "#ffffff",
      haloWidth: 5,
      rotation: 0.5,
      labelPlacement: "point",
    } });
    const labelStyle = featureStyle(label);
    const labelText = (Array.isArray(labelStyle) ? labelStyle[0] : labelStyle)?.getText();
    expect(labelText?.getFont()).toContain("20px");
    expect(labelText?.getFill()?.getColor()).toBe("#123456");
    expect(labelText?.getStroke()?.getColor()).toBe("#ffffff");
    expect(labelText?.getStroke()?.getWidth()).toBe(5);
    expect(labelText?.getRotation()).toBe(0.5);

    const road = new Feature({ featureType: "road", name: "Road" });
    const roadStyle = featureStyle(road);
    const roadText = (Array.isArray(roadStyle) ? roadStyle[1] : roadStyle)?.getText();
    expect(roadText?.getPlacement()).toBe("line");
  });

  it("renders project-embedded image assets for symbol features", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const featureStyle = createFeatureStyle(() => "ink", () => true, (assetId) => assetId === "asset-1" ? url : undefined);
    const symbol = new Feature({ featureType: "symbol", name: "Marker", properties: { assetId: "asset-1", scale: 1.5, rotation: 0.2 } });
    const styled = featureStyle(symbol);
    const image = (Array.isArray(styled) ? styled[0] : styled)?.getImage();
    expect(image).toBeInstanceOf(Icon);
    expect((image as Icon).getSrc()).toBe(url);
  });

  it("renders local overlay assets in a bbox renderer and keeps a safe fallback", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const featureStyle = createFeatureStyle(() => "ink", () => true, (assetId) => assetId === "asset-1" ? url : undefined);
    const overlay = new Feature({ featureType: "overlay", name: "Trace", properties: { assetId: "asset-1", opacity: 0.6, rotation: 0.25 } });
    const rendered = featureStyle(overlay);
    const style = Array.isArray(rendered) ? rendered[0] : rendered;
    expect(style?.getImage()).toBeInstanceOf(Icon);
    expect(typeof style?.getRenderer()).toBe("function");
    expect(style?.getZIndex()).toBe(24);
    expect(style).toBe(featureStyle(overlay));

    overlay.set("properties", { assetId: "asset-1", opacity: 0.35, rotation: 0.25 });
    expect(featureStyle(overlay)).not.toBe(rendered);

    const remoteOverlay = new Feature({ featureType: "overlay", name: "Remote", properties: { assetId: "remote", opacity: 0.6 } });
    const fallbackStyle = featureStyle(remoteOverlay);
    const fallback = Array.isArray(fallbackStyle) ? fallbackStyle[0] : fallbackStyle;
    expect(fallback?.getRenderer()).toBeNull();
    expect(fallback?.getFill()?.getColor()).toContain("rgba");

    const symbolWithRemoteAsset = new Feature({ featureType: "symbol", name: "Remote", properties: { assetId: "remote" } });
    const symbolStyle = featureStyle(symbolWithRemoteAsset);
    const symbolImage = (Array.isArray(symbolStyle) ? symbolStyle[0] : symbolStyle)?.getImage();
    expect(symbolImage).not.toBeInstanceOf(Icon);
  });

  it("applies bounded feature opacity to vector strokes and symbol images", () => {
    const featureStyle = createFeatureStyle(() => "ink", () => true, () => "data:image/png;base64,iVBORw0KGgo=");
    const river = new Feature({ featureType: "river", name: "River", properties: { opacity: 0.5 } });
    const riverStyle = featureStyle(river);
    const riverStroke = (Array.isArray(riverStyle) ? riverStyle[1] : riverStyle)?.getStroke();
    expect(riverStroke?.getColor()).toContain("rgba");

    const symbol = new Feature({ featureType: "symbol", name: "Marker", properties: { assetId: "asset-1", opacity: 0.4 } });
    const symbolStyle = featureStyle(symbol);
    const image = (Array.isArray(symbolStyle) ? symbolStyle[0] : symbolStyle)?.getImage();
    expect(image?.getOpacity()).toBeCloseTo(0.4);
  });

  it("honors saved visibility and relative feature order", () => {
    const featureStyle = createFeatureStyle();
    const hidden = new Feature({ featureType: "city", name: "Hidden", properties: { visible: false } });
    expect(featureStyle(hidden)).toBeUndefined();
    const raised = new Feature({ featureType: "country", name: "Raised", properties: { zIndex: 20 } });
    const styled = featureStyle(raised);
    expect((Array.isArray(styled) ? styled[0] : styled)?.getZIndex()).toBe(50);
  });
});
