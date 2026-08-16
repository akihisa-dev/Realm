import Draw from "ol/interaction/Draw";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import Modify from "ol/interaction/Modify";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import * as SelectModule from "ol/interaction/Select";
import Translate from "ol/interaction/Translate";
import MultiLineString from "ol/geom/MultiLineString";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import { RealmMapAdapter } from "./MapAdapter";

describe("RealmMapAdapter presentation preview", () => {
  it("keeps navigation active while disabling feature editing in the preview", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setActiveLayer("object");
    adapter.setMode("pan");
    adapter.setPresentationMode(true);
    adapter.setMode("city");

    const interactions = adapter.getMap().getInteractions().getArray();
    const selection = interactions.find((interaction) => interaction instanceof SelectModule.default);
    const modify = interactions.find((interaction) => interaction instanceof Modify);
    const translate = interactions.find((interaction) => interaction instanceof Translate);
    const dragPan = interactions.find((interaction) => interaction instanceof DragPan && interaction !== (adapter as unknown as { middleDragPan: DragPan }).middleDragPan);
    const wheelZoom = interactions.find((interaction) => interaction instanceof MouseWheelZoom);

    expect(selection?.getActive()).toBe(false);
    expect(modify?.getActive()).toBe(false);
    expect(translate?.getActive()).toBe(false);
    expect(dragPan?.getActive()).toBe(true);
    expect(wheelZoom?.getActive()).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardPan && interaction.getActive())).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof Draw)).toBe(false);

    adapter.dispose();
    host.remove();
  });

  it("hides presentation guides and restores exact transient geometry when preview closes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const terrainLayer = adapter.getMap().getLayers().item(8) as VectorLayer;
    const regionLayer = adapter.getMap().getLayers().item(7) as VectorLayer;
    const cellLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    const cellGridLayer = adapter.getMap().getLayers().item(4) as VectorLayer;
    const gridLayer = adapter.getMap().getLayers().item(3) as VectorLayer;
    const attributes = [
      { cellId: "10:10", attribute: "terrain" as const, value: "terrain" },
      { cellId: "11:10", attribute: "terrain" as const, value: "terrain" },
      { cellId: "10:10", attribute: "region" as const, value: "#2468AC" },
      { cellId: "11:10", attribute: "region" as const, value: "#2468AC" },
    ];

    adapter.setGridOptions({ kind: "hex", color: "#102030", width: 1, spacingDegrees: 30 });
    adapter.setGridVisible(true);
    adapter.setCellGridVisible(true);
    adapter.setCellAttributes(attributes);
    const exactTerrainCoordinates = ((terrainLayer.getSource()?.getFeatures()[0]?.getGeometry()) as MultiLineString).getCoordinates()[0]!;
    const exactRegionCoordinates = ((regionLayer.getSource()?.getFeatures()[0]?.getGeometry()) as Polygon).getCoordinates()[0]!;

    adapter.setPresentationMode(true);
    const previewTerrainCoordinates = ((terrainLayer.getSource()?.getFeatures()[0]?.getGeometry()) as MultiLineString).getCoordinates()[0]!;
    const previewRegionCoordinates = ((regionLayer.getSource()?.getFeatures()[0]?.getGeometry()) as Polygon).getCoordinates()[0]!;
    expect(previewTerrainCoordinates.length).toBeGreaterThan(exactTerrainCoordinates.length);
    expect(previewRegionCoordinates.length).toBeGreaterThan(exactRegionCoordinates.length);
    expect(cellLayer.getVisible()).toBe(false);
    expect(cellGridLayer.getVisible()).toBe(false);
    expect(gridLayer.getVisible()).toBe(false);

    adapter.setPresentationMode(false);
    expect(((terrainLayer.getSource()?.getFeatures()[0]?.getGeometry()) as MultiLineString).getCoordinates()[0]).toEqual(exactTerrainCoordinates);
    expect(((regionLayer.getSource()?.getFeatures()[0]?.getGeometry()) as Polygon).getCoordinates()[0]).toEqual(exactRegionCoordinates);
    expect(cellLayer.getVisible()).toBe(true);
    expect(cellGridLayer.getVisible()).toBe(true);
    expect(gridLayer.getVisible()).toBe(true);

    adapter.dispose();
    host.remove();
  });
});
