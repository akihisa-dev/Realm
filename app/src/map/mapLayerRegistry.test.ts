import Feature from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import { describe, expect, it } from "vitest";
import { MapLayerRegistry } from "./mapLayerRegistry";

const createRegistry = (): MapLayerRegistry => new MapLayerRegistry({
  themeId: () => "ink",
  themeOverrides: () => ({}),
  objectKindVisible: () => true,
  assetUrl: () => undefined,
});

describe("MapLayerRegistry", () => {
  it("switches grid kinds, validates options, and updates visibility", () => {
    const registry = createRegistry();
    const map = new Map({ layers: registry.mapLayers, view: new View({ projection: "EPSG:4326", center: [0, 0], zoom: 1 }) });
    expect(() => registry.setGridOptions(map, { kind: "invalid" as never, color: "#123456", width: 1, spacingDegrees: 10 })).toThrow("Grid kind");
    expect(() => registry.setGridOptions(map, { kind: "square", color: "bad", width: 1, spacingDegrees: 10 })).toThrow("Grid color");
    expect(() => registry.setGridOptions(map, { kind: "square", color: "#123456", width: 0, spacingDegrees: 10 })).toThrow("Grid width");
    expect(() => registry.setGridOptions(map, { kind: "square", color: "#123456", width: 1, spacingDegrees: 1 })).toThrow("Grid spacing");

    registry.setGridVisible(true);
    registry.setGridOptions(map, { kind: "square", color: "#123456", width: 1, spacingDegrees: 10 });
    expect(registry.gridSource.getFeatures().length).toBeGreaterThan(0);
    registry.setGridOptions(map, { kind: "hex", color: "#234567", width: 2, spacingDegrees: 12 });
    expect(registry.gridSource.getFeatures().length).toBeGreaterThan(0);
    registry.setGridOptions(map, { kind: "graticule", color: "#345678", width: 0.5, spacingDegrees: 15 });
    expect(map.getLayers().item(0)).toBeDefined();

    expect(() => registry.setCellGridOptions({ color: "bad", width: 1 })).toThrow("Cell grid color");
    expect(() => registry.setCellGridOptions({ color: "#123456", width: 8 })).toThrow("Cell grid width");
    registry.setCellGridOptions({ color: "#123456", width: 1.5 });
    registry.setCellGridVisible(true);
    expect(registry.cellGridLayer.getVisible()).toBe(true);
    expect(registry.terrainCellGridLayer.getVisible()).toBe(true);
    registry.setPresentationMode(true);
    expect(registry.cellLayer.getVisible()).toBe(false);
    expect(registry.cellGridLayer.getVisible()).toBe(false);
    registry.setPresentationMode(false);
    expect(registry.cellLayer.getVisible()).toBe(true);
    registry.setGridVisible(false);
    expect(registry.gridLayer.getVisible()).toBe(false);
    registry.setCellGridVisible(false);
    expect(registry.cellGridLayer.getVisible()).toBe(false);
    registry.invalidateTheme();
    registry.dispose(map);
    map.dispose();
  });

  it("renders and hides region smooth features according to preview state", () => {
    const registry = createRegistry();
    const region = new Feature({ regionIdentity: "region-a", regionColor: "#2468AC" });
    const style = registry.regionSmoothLayer.getStyleFunction();
    expect(style?.(region, 1)).toBeDefined();
    (registry as unknown as { regionSmoothHiddenIdentity: string | null }).regionSmoothHiddenIdentity = "region-a";
    expect(style?.(region, 1)).toEqual([]);
    (registry as unknown as { regionSmoothHiddenIdentity: string | null }).regionSmoothHiddenIdentity = null;
    registry.setPresentationMode(true);
    expect(style?.(region, 1)).toBeDefined();
    registry.setPresentationMode(false);
  });
});
