import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import type { ThemeOverrides } from "./themes";
import { createFeatureStyle } from "./styles";

describe("feature style cache", () => {
  it("reuses a style for the same feature state and replaces only that feature's prior state", () => {
    const style = createFeatureStyle();
    const feature = new Feature({
      geometry: new Point([0, 0]),
      featureType: "city",
      name: "City",
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
    const style = createFeatureStyle();
    const firstFeature = new Feature({ geometry: new Point([0, 0]), featureType: "city", name: "City", properties: {} });
    const secondFeature = new Feature({ geometry: new Point([1, 1]), featureType: "city", name: "City", properties: {} });
    const first = style(firstFeature);
    const second = style(secondFeature);
    if (!first || !second) throw new Error("city styles should be created");
    expect(second).not.toBe(first);
  });

  it("reuses a feature style for semantically equal override records and separates changed state", () => {
    let overrides: ThemeOverrides = { label: "#112233", land: "#445566" };
    const style = createFeatureStyle(() => "ink", () => true, () => undefined, () => overrides);
    const feature = new Feature({ geometry: new Point([0, 0]), featureType: "city", name: "City", properties: {} });
    const first = style(feature);
    if (!first) throw new Error("city style should be created");

    overrides = { land: "#445566", label: "#112233" };
    expect(style(feature)).toBe(first);

    overrides = { land: "#445566", label: "#332211" };
    const changed = style(feature);
    if (!changed) throw new Error("changed theme style should be created");
    expect(changed).not.toBe(first);
  });
});
