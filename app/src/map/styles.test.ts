import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import type { ThemeOverrides } from "./themes";
import { createCellStyle, createObjectStyle } from "./styles";

describe("object style cache", () => {
  it("reuses a style for the same feature state and replaces only that feature's prior state", () => {
    const style = createObjectStyle();
    const feature = new Feature({
      geometry: new Point([0, 0]),
      kind: "city",
      label: "City",
      properties: { labelColor: "#102030" },
    });

    const first = style(feature);
    if (!first) throw new Error("city style should be created");
    expect(style(feature)).toBe(first);

    feature.set("properties", { labelColor: "#304050" });
    const changed = style(feature);
    if (!changed) throw new Error("changed city style should be created");
    expect(changed).not.toBe(first);
    expect(style(feature)).toBe(changed);
  });

  it("keeps independent feature entries instead of sharing a global history key", () => {
    const style = createObjectStyle();
    const firstFeature = new Feature({ geometry: new Point([0, 0]), kind: "city", label: "City", properties: {} });
    const secondFeature = new Feature({ geometry: new Point([1, 1]), kind: "city", label: "City", properties: {} });
    const first = style(firstFeature);
    const second = style(secondFeature);
    if (!first || !second) throw new Error("city styles should be created");
    expect(second).not.toBe(first);
  });

  it("reuses a feature style for semantically equal override records and separates changed state", () => {
    let overrides: ThemeOverrides = { label: "#112233", land: "#445566" };
    const style = createObjectStyle(() => "ink", () => true, () => undefined, () => overrides);
    const feature = new Feature({ geometry: new Point([0, 0]), kind: "city", label: "City", properties: {} });
    const first = style(feature);
    if (!first) throw new Error("city style should be created");

    overrides = { land: "#445566", label: "#112233" };
    expect(style(feature)).toBe(first);

    overrides = { land: "#445566", label: "#332211" };
    const changed = style(feature);
    if (!changed) throw new Error("changed theme style should be created");
    expect(changed).not.toBe(first);
  });

  it("renders each canonical object kind and exercises local presentation guards", () => {
    const style = createObjectStyle(
      () => "midnight",
      () => true,
      (assetId) => assetId === "local" ? "blob:local-image" : assetId === "data" ? "data:image/png;base64,AA" : "https://example.invalid/image",
      () => ({ label: "#ffffff", land: "#112233" }),
    );
    const properties = {
      labelColor: "#ffffff",
      labelHaloColor: "#000000",
      fontSize: 96,
      fontFamily: "serif",
      labelPlacement: "line",
      labelHaloWidth: 16,
      labelRotation: Math.PI,
      labelOffsetX: 12,
      labelOffsetY: -12,
      labelRepeat: 20,
      labelMaxAngle: Math.PI / 3,
      labelPath: [[-1, -1], [0, 0], [1, 1]],
      strokeColor: "#123456",
      fillColor: "#abcdef",
      fillOpacity: 0.8,
      casingColor: "#010203",
      lineStyle: "dashed",
      lineProfile: "angular",
      roughness: 0.9,
      frameStyle: "double",
      frameWidth: 24,
      barLengthPx: 640,
      segments: 12,
      unit: "km",
      symbolKind: "mountain",
      flipX: true,
      unitsPerDegree: 100,
      zIndex: 10,
      opacity: 0.5,
      blendMode: "multiply",
      cropLeft: 0.4,
      cropTop: 0.4,
      cropRight: 0.4,
      cropBottom: 0.4,
    };
    const city = new Feature({ geometry: new Point([0, 0]), kind: "city", label: "City", properties });
    const cityStyle = style(city);
    expect(cityStyle).toBeDefined();
    expect(style(city)).toBe(cityStyle);

    const terrain = new Feature({ geometry: new Point([0, 0]), kind: "terrain", label: "", properties: { opacity: 0 } });
    expect(style(terrain)).toHaveLength(2);
    const regionColors = ["#123", "#1234", "#12345678", "rgb(1, 2, 3)", "rgba(1, 2, 3, 50%)", "rgba(1, 2, 3, 0.5)", "not-a-color"];
    for (const color of regionColors) {
      expect(style(new Feature({ geometry: new Point([0, 0]), kind: "region", label: "", properties: { color } }))).toBeDefined();
    }

    const mountainWithAsset = new Feature({ geometry: new Point([0, 0]), kind: "mountain", label: "Peak", properties: { assetId: "local", scale: 8, rotation: Math.PI / 4, opacity: 0.5 } });
    const mountainStyle = style(mountainWithAsset);
    expect(mountainStyle).toBeDefined();
    const mountainFallback = new Feature({ geometry: new Point([0, 0]), kind: "mountain", label: "Peak", properties: { assetId: "data", lineStyle: "dotted", lineProfile: "rough", roughness: 0 } });
    expect(style(mountainFallback)).toBeDefined();
    expect(style(new Feature({ geometry: new Point([0, 0]), kind: "forest", label: "Forest", properties: {} }))).toBeDefined();
    expect(style(new Feature({ geometry: new Point([0, 0]), kind: "text", label: "Text", properties: { fontFamily: "handwritten", labelPlacement: "point" } }))).toBeDefined();

    const hidden = createObjectStyle(() => "ink", () => false);
    expect(hidden(city)).toBeUndefined();
    expect(style(new Feature({ geometry: new Point([0, 0]), kind: "city", label: "", properties: { visible: false } }))).toBeUndefined();
  });

  it("renders transient cell states independently and keeps their cache stable", () => {
    const style = createCellStyle(() => "atlas", () => ({ region: "#112233", land: "#334455" }));
    const empty = new Feature({ geometry: new Point([0, 0]), attributes: [] });
    expect(style(empty)).toBeUndefined();

    const region = new Feature({
      geometry: new Point([0, 0]),
      attributes: [{ cellId: "10:10", layer: "region", value: "#2468AC", regionId: "r1" }],
      regionAnimationOpacity: 0.4,
      selected: true,
      paintPreview: true,
      preview: true,
      erasePreview: true,
      grabPreview: true,
      grabHover: true,
    });
    const regionStyles = style(region);
    expect(regionStyles).toBeDefined();
    expect(style(region)).toBe(regionStyles);

    const terrain = new Feature({
      geometry: new Point([0, 0]),
      attributes: [{ cellId: "10:11", layer: "terrain", value: "terrain" }],
      grabPreview: true,
      grabSourceHidden: false,
      selected: true,
    });
    expect(style(terrain)).toBeDefined();

    const hiddenRegion = new Feature({
      geometry: new Point([0, 0]),
      attributes: [{ cellId: "10:12", layer: "region", value: "invalid" }],
      grabSourceHidden: true,
      grabPreview: true,
    });
    expect(style(hiddenRegion)).toBeDefined();

    const noVisibleState = new Feature({
      geometry: new Point([0, 0]),
      attributes: [{ cellId: "10:13", layer: "region", value: "#2468AC" }],
    });
    expect(style(noVisibleState)).toBeUndefined();
  });
});
