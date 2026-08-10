import Feature from "ol/Feature";
import GeometryCollection from "ol/geom/GeometryCollection";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Icon from "ol/style/Icon";
import RegularShape from "ol/style/RegularShape";
import Style from "ol/style/Style";
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

  it("invalidates feature and cell style caches when theme overrides change", () => {
    let overrides: { river?: string; grid?: string } = { river: "#102030", grid: "#203040" };
    const featureStyle = createFeatureStyle(() => "ink", () => true, () => undefined, () => overrides);
    const river = new Feature({ featureType: "river", name: "River" });
    const before = featureStyle(river);
    expect((Array.isArray(before) ? before[1] : before)?.getStroke()?.getColor()).toBe("#102030");
    overrides = { river: "#405060", grid: "#506070" };
    const after = featureStyle(river);
    expect(after).not.toBe(before);
    expect((Array.isArray(after) ? after[1] : after)?.getStroke()?.getColor()).toBe("#405060");

    let cellOverrides: { grid?: string } = { grid: "#102030" };
    const cellStyle = createCellStyle(() => "ink", () => cellOverrides);
    const cell = new Feature({ id: "cell", attributes: [], selected: false, showGrid: true });
    const cellBefore = cellStyle(cell);
    cellOverrides = { grid: "#405060" };
    const cellAfter = cellStyle(cell);
    expect(cellAfter).not.toBe(cellBefore);
  });

  it("applies free-label font, colors, halo, rotation, and line placement", () => {
    const featureStyle = createFeatureStyle();
    const label = new Feature({ featureType: "label", name: "North", properties: {
      fontSize: 20,
      fontFamily: "serif",
      textColor: "#123456",
      haloColor: "#ffffff",
      haloWidth: 5,
      rotation: 0.5,
      labelPlacement: "point",
    } });
    const labelStyle = featureStyle(label);
    const labelText = (Array.isArray(labelStyle) ? labelStyle[0] : labelStyle)?.getText();
    expect(labelText?.getFont()).toContain("20px");
    expect(labelText?.getFont()).toContain("Georgia");
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

  it("renders distinct built-in compass and north-arrow symbols", () => {
    const featureStyle = createFeatureStyle();
    const compass = new Feature({ featureType: "symbol", name: "Compass", properties: { symbolKind: "compass" } });
    const north = new Feature({ featureType: "symbol", name: "North", properties: { symbolKind: "north" } });
    const compassImage = (featureStyle(compass) as Style).getImage() as RegularShape;
    const northImage = (featureStyle(north) as Style).getImage() as RegularShape;
    expect(compassImage.getPoints()).toBe(8);
    expect(northImage.getPoints()).toBe(3);
  });

  it("renders local overlay assets in a bbox renderer and keeps a safe fallback", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const featureStyle = createFeatureStyle(() => "ink", () => true, (assetId) => assetId === "asset-1" ? url : undefined);
    const overlay = new Feature({ featureType: "overlay", name: "Trace", properties: { assetId: "asset-1", opacity: 0.6, rotation: 0.25, blendMode: "multiply" } });
    const rendered = featureStyle(overlay);
    const style = Array.isArray(rendered) ? rendered[0] : rendered;
    expect(style?.getImage()).toBeInstanceOf(Icon);
    expect(typeof style?.getRenderer()).toBe("function");
    expect(style?.getZIndex()).toBe(24);
    expect(style).toBe(featureStyle(overlay));

    overlay.set("properties", { assetId: "asset-1", opacity: 0.35, rotation: 0.25, blendMode: "screen" });
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

  it("renders editable frame styles and invalidates the style cache for frame properties", () => {
    const featureStyle = createFeatureStyle(() => "ink", () => true);
    const frame = new Feature({ featureType: "frame", name: "Border", properties: { frameWidth: 5, frameColor: "#102030", frameStyle: "double" } });
    const doubleStyle = featureStyle(frame);
    expect(Array.isArray(doubleStyle)).toBe(true);
    expect(doubleStyle).toHaveLength(2);
    expect((doubleStyle as unknown as Array<Style>)[1]?.getStroke()?.getColor()).toBe("#102030");
    expect((doubleStyle as unknown as Array<Style>)[1]?.getStroke()?.getWidth()).toBe(5);

    frame.set("properties", { frameWidth: 2, frameColor: "#405060", frameStyle: "dashed" });
    const dashedStyle = featureStyle(frame);
    expect(dashedStyle).not.toBe(doubleStyle);
    const dashedStroke = (Array.isArray(dashedStyle) ? dashedStyle[0] : dashedStyle)?.getStroke();
    expect(dashedStroke?.getColor()).toBe("#405060");
    expect(dashedStroke?.getLineDash()).toEqual([12, 8]);
  });

  it("uses a bounded custom canvas renderer for scale bars", () => {
    const featureStyle = createFeatureStyle(() => "ink", () => true);
    const scale = new Feature({ featureType: "scale", name: "Scale", properties: { barLengthPx: 9999, segments: 99, unit: "km", unitsPerDegree: 2.5, opacity: 0.5 } });
    const styled = featureStyle(scale);
    const style = Array.isArray(styled) ? styled[0] : styled;
    const renderer = style?.getRenderer();
    expect(typeof renderer).toBe("function");
    const calls: string[] = [];
    const context = {
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: () => calls.push("translate"),
      rotate: () => calls.push("rotate"),
      beginPath: () => calls.push("beginPath"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      stroke: () => calls.push("stroke"),
      fillText: () => calls.push("fillText"),
    } as unknown as CanvasRenderingContext2D;
    renderer?.([50, 60], { context, pixelRatio: 1, feature: scale, geometry: new Point([0, 0]), resolution: 1, rotation: 0 });
    expect(calls[0]).toBe("save");
    expect(calls).toContain("stroke");
    expect(calls).toContain("fillText");
    expect(context.globalAlpha).toBeCloseTo(0.5);
  });
});
