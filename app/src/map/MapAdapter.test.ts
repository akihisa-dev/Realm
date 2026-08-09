import { RealmMapAdapter } from "./MapAdapter";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import KeyboardZoom from "ol/interaction/KeyboardZoom";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import Draw from "ol/interaction/Draw";
import Style from "ol/style/Style";

describe("RealmMapAdapter", () => {
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
      { id: "city-1", featureType: "city", name: "City", validFromYear: 0, geometry: { type: "Point", coordinates: [12, 34] } },
      { id: "river-1", featureType: "river", name: "River", validFromYear: 0, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "terrain-1", featureType: "terrain", name: "Land", validFromYear: 0, geometry: { type: "Polygon", coordinates: [[[-2, -2], [2, -2], [2, 2], [-2, -2]]] } },
      { id: "country-1", featureType: "country", name: "Country", validFromYear: 0, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { id: "region-1", featureType: "region", name: "Region", validFromYear: 0, geometry: { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]]] } },
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
    expect(featureSource?.getFeatures()).toHaveLength(5);
    const terrainStyle = styleFor("terrain-1");
    const countryStyle = styleFor("country-1");
    const regionStyle = styleFor("region-1");
    expect(terrainStyle.getZIndex()).toBeLessThan(countryStyle.getZIndex() ?? 0);
    expect(countryStyle.getZIndex()).toBeLessThan(regionStyle.getZIndex() ?? 0);
    expect(countryStyle.getFill()?.getColor()).not.toBe(regionStyle.getFill()?.getColor());
    expect(countryStyle.getText()?.getText()).toBe("Country");
    expect(regionStyle.getText()?.getText()).toBe("Region");
    expect(regionStyle.getStroke()?.getLineDash()).toEqual([5, 4]);
    adapter.setSelected("city-1");
    adapter.setMode("river");
    const riverDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(riverDraw).toBeInstanceOf(Draw);
    expect((riverDraw as Draw).getFreehand()).toBe(true);
    adapter.setMode("terrain");
    const terrainDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(terrainDraw).toBeInstanceOf(Draw);
    expect((terrainDraw as Draw).getFreehand()).toBe(true);
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
    adapter.setZoom(3);
    expect(adapter.getZoom()).toBe(3);
    adapter.setZoom(99);
    expect(adapter.getZoom()).toBe(8);
    adapter.setZoom(-99);
    expect(adapter.getZoom()).toBe(0);
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
    expect(adapter.getMap().getTarget()).toBeNull();
    host.remove();
  });
});
