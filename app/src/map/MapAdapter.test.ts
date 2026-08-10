import { CELL_GRID_CELL_COUNT, RealmMapAdapter, assertGeometryWithinWorld, cellCenter, cellIdsWithinBrushPath, isGeometryWithinWorld } from "./MapAdapter";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import KeyboardZoom from "ol/interaction/KeyboardZoom";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import Draw from "ol/interaction/Draw";
import PointerInteraction from "ol/interaction/Pointer";
import Style from "ol/style/Style";
import CircleStyle from "ol/style/Circle";

describe("RealmMapAdapter", () => {
  it("selects a thick brush stroke and expands its footprint with radius", () => {
    const oneCell = cellCenter(128, 256);
    const narrow = cellIdsWithinBrushPath([oneCell, [oneCell[0] + 0.7, oneCell[1]]], 0.25);
    const wide = cellIdsWithinBrushPath([oneCell, [oneCell[0] + 0.7, oneCell[1]]], 2);
    expect(narrow).toContain("256:128");
    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(cellIdsWithinBrushPath([], 1)).toEqual([]);
    expect(cellIdsWithinBrushPath([oneCell], -1)).toEqual([]);
    expect(cellIdsWithinBrushPath([oneCell], Number.NaN)).toEqual([]);
    expect(cellIdsWithinBrushPath([cellCenter(0, 0)], 0)).toEqual(["0:0"]);
    expect(cellIdsWithinBrushPath([[-180, -90]], 1)).toContain("0:0");
    expect(cellIdsWithinBrushPath([[180, 90]], 1)).toContain("511:255");
    expect(cellIdsWithinBrushPath([[-Infinity, -90], [Infinity, 90]], 1)).toEqual([]);
  });

  it("guards feature geometry at the bounded world edge", () => {
    expect(isGeometryWithinWorld({ type: "Point", coordinates: [180, 90] })).toBe(true);
    expect(isGeometryWithinWorld({ type: "Point", coordinates: [180.01, 90] })).toBe(false);
    expect(isGeometryWithinWorld({ type: "LineString", coordinates: [[0, 0], [0, 91]] })).toBe(false);
    expect(isGeometryWithinWorld({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] })).toBe(true);
    expect(() => assertGeometryWithinWorld({ type: "Point", coordinates: [181, 0] })).toThrow("bounded world");
  });

  it("creates a bounded world view and disposes its OpenLayers target", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);

    const adapter = new RealmMapAdapter({ target: host });
    expect(adapter.getMap().getView().getProjection().getCode()).toBe("EPSG:4326");
    const graticule = adapter.getMap().getLayers().item(0);
    expect(graticule).toBeInstanceOf(Graticule);
    // Keep labels inset at the top/left so coordinate text remains readable.
    expect((graticule as unknown as { lonLabelPosition_: number }).lonLabelPosition_).toBeCloseTo(0.96);
    expect((graticule as unknown as { latLabelPosition_: number }).latLabelPosition_).toBeCloseTo(0.035);
    const referenceAxes = adapter.getMap().getLayers().item(1);
    expect(referenceAxes).toBeInstanceOf(VectorLayer);
    expect((referenceAxes as VectorLayer).getSource()?.getFeatures()).toHaveLength(2);
    adapter.setFeatures([
      { id: "city-1", featureType: "city", name: "City", geometry: { type: "Point", coordinates: [12, 34] } },
      { id: "river-1", featureType: "river", name: "River", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "terrain-1", featureType: "terrain", name: "Land", geometry: { type: "Polygon", coordinates: [[[-2, -2], [2, -2], [2, 2], [-2, -2]]] } },
      { id: "country-1", featureType: "country", name: "Country", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { id: "region-1", featureType: "region", name: "Region", geometry: { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]]] } },
      { id: "forest-1", featureType: "forest", name: "Forest", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { id: "coast-1", featureType: "coastline", name: "Coast", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "boundary-1", featureType: "boundary", name: "Boundary", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "town-1", featureType: "town", name: "Town", geometry: { type: "Point", coordinates: [1, 1] } },
    ]);
    const featureLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    const featureSource = featureLayer.getSource();
    const styleFunction = featureLayer.getStyleFunction();
    const styleFor = (id: string): Style => {
      const feature = featureSource?.getFeatureById(id);
      const renderedStyle = feature && styleFunction?.(feature, 1);
      const style = Array.isArray(renderedStyle) ? renderedStyle[0] : renderedStyle;
      expect(style).toBeInstanceOf(Style);
      return style as Style;
    };
    expect(featureSource?.getFeatures()).toHaveLength(9);
    const terrainStyle = styleFor("terrain-1");
    const countryStyle = styleFor("country-1");
    const regionStyle = styleFor("region-1");
    styleFor("forest-1"); styleFor("coast-1"); styleFor("boundary-1"); styleFor("town-1");
    expect(terrainStyle.getZIndex()).toBeLessThan(countryStyle.getZIndex() ?? 0);
    expect(countryStyle.getZIndex()).toBeLessThan(regionStyle.getZIndex() ?? 0);
    expect(countryStyle.getFill()?.getColor()).not.toBe(regionStyle.getFill()?.getColor());
    expect(countryStyle.getText()?.getText()).toBe("Country");
    expect(regionStyle.getText()?.getText()).toBe("Region");
    expect(regionStyle.getStroke()?.getLineDash()).toEqual([5, 4]);
    adapter.setSelected("city-1");
    adapter.setSelectedCells(["0:0"]);
    adapter.setSelectedCells([]);
    adapter.setCellAttributes([]);
    expect((adapter.getMap().getLayers().item(3) as VectorLayer).getSource()?.getFeatures()).toHaveLength(1);
    adapter.setMode("river");
    const riverDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(riverDraw).toBeInstanceOf(Draw);
    expect((riverDraw as Draw).getFreehand()).toBe(true);
    adapter.setMode("terrain");
    const terrainDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(terrainDraw).toBeInstanceOf(Draw);
    expect((terrainDraw as Draw).getFreehand()).toBe(true);
    for (const mode of ["coastline", "boundary", "country", "region", "town", "forest"] as const) {
      adapter.setMode(mode);
      adapter.setMode("pan");
    }
    adapter.setMode("city");
    const cityDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(cityDraw).toBeInstanceOf(Draw);
    expect((cityDraw as Draw).getFreehand()).toBe(false);
    adapter.setMode("pan");
    expect(adapter.getMap().getInteractions().getArray().some((interaction) => interaction instanceof Draw)).toBe(false);
    const interactions = adapter.getMap().getInteractions().getArray();
    expect(interactions.some((interaction) => interaction instanceof DragPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof MouseWheelZoom)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardZoom)).toBe(true);

    adapter.setMode("cell-select");
    const cellLayer = adapter.getMap().getLayers().item(3) as VectorLayer;
    expect(cellLayer.getVisible()).toBe(true);
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(CELL_GRID_CELL_COUNT);
    adapter.setCellAttributes([
      { cellId: "1:0", attribute: "forest", value: "forest" },
      { cellId: "3:0", attribute: "country", value: "A" },
      { cellId: "4:0", attribute: "region", value: "B" },
    ]);
    const cellStyleFunction = cellLayer.getStyleFunction();
    const forestCell = cellLayer.getSource()?.getFeatureById("1:0");
    const forestStyle = (cellStyleFunction?.(forestCell!, 1) as Style[])[0]!;
    expect((forestStyle.getImage() as CircleStyle).getFill()?.getColor()).toBe("#3f7c55");
    const cellBrush = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof PointerInteraction && !(interaction instanceof DragPan));
    expect(cellBrush).toBeInstanceOf(PointerInteraction);
    expect(interactions.find((interaction) => interaction instanceof DragPan)?.getActive()).toBe(false);
    expect(interactions.find((interaction) => interaction instanceof KeyboardPan)?.getActive()).toBe(false);
    const onCellSelect = vi.fn();
    const stopCellSelect = adapter.onCellSelect(onCellSelect);
    adapter.setSelectedCells(["0:0"]);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCellSelect).toHaveBeenCalledWith([]);
    host.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    stopCellSelect();
    adapter.setMode("pan");
    expect(cellLayer.getVisible()).toBe(true);
    const emptyCell = cellLayer.getSource()?.getFeatureById("10:10");
    expect(cellStyleFunction?.(emptyCell!, 1)).toBeUndefined();
    adapter.setZoom(3);
    expect(adapter.getZoom()).toBe(3);
    adapter.setZoom(99);
    expect(adapter.getZoom()).toBe(8);
    adapter.setZoom(-99);
    expect(adapter.getZoom()).toBe(0);
    adapter.setCellBrushRadius(Number.NaN);
    adapter.setCellBrushRadius(999);
    adapter.setSelected("missing");
    adapter.getMap().getView().setCenter([42, -20]);
    adapter.setZoom(5);
    adapter.resetView();
    expect(adapter.getMap().getView().getCenter()).toEqual([0, 0]);
    expect(adapter.getZoom()).toBe(1);
    adapter.getMap().setSize([640, 480]);
    adapter.setZoom(1);
    adapter.updateSize();
    expect(adapter.getZoom()).toBe(1);
    const view = adapter.getMap().getView();
    const fittedResolution = view.getResolutionForExtent([-180, -90, 180, 90], [592, 432]);
    expect(view.getResolution()).toBeCloseTo(fittedResolution);
    expect(view.getZoom()).toBeCloseTo(view.getMinZoom() + 1);

    adapter.setZoom(3);
    adapter.getMap().setSize([900, 400]);
    adapter.updateSize();
    expect(adapter.getZoom()).toBe(3);
    const resizedFitResolution = view.getResolutionForExtent([-180, -90, 180, 90], [852, 352]);
    const resizedFitZoom = view.getZoomForResolution(resizedFitResolution);
    expect(resizedFitZoom).not.toBeUndefined();
    expect(view.getResolution()).toBeCloseTo(view.getResolutionForZoom((resizedFitZoom ?? 0) + 2));
    adapter.dispose();
    adapter.dispose();
    expect(adapter.getMap().getTarget()).toBeNull();
    host.remove();
  });
});
