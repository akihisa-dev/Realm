import { RealmMapAdapter } from "./MapAdapter";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import { cellIdsToPolygonGeometries } from "../shared/mapShapeGeometry";

describe("RealmMapAdapter canonical map shapes", () => {
  it("renders saved Polygon geometry directly while keeping cell geometry transient", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const terrainLayer = adapter.getMap().getLayers().item(8) as VectorLayer;
    const regionLayer = adapter.getMap().getLayers().item(7) as VectorLayer;
    const terrainGeometry = cellIdsToPolygonGeometries(["10:10", "11:10"])[0]!;
    const regionGeometry = cellIdsToPolygonGeometries(["20:20"])[0]!;

    adapter.setMapShapes?.([
      { id: "11111111-1111-4111-8111-111111111111", layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: terrainGeometry },
      { id: "22222222-2222-4222-8222-222222222222", layer: "region", regionId: "33333333-3333-4333-8333-333333333333", value: "#2468AC", geometryVersion: 1, snapGridVersion: 2, geometry: regionGeometry },
    ]);

    expect(terrainLayer.getSource()?.getFeatures()).toHaveLength(1);
    expect(terrainLayer.getSource()?.getFeatures()[0]?.getGeometry()).toBeInstanceOf(Polygon);
    expect(regionLayer.getSource()?.getFeatures()).toHaveLength(1);
    expect(regionLayer.getSource()?.getFeatures()[0]?.getGeometry()).toBeInstanceOf(Polygon);
    expect((adapter.getMap().getLayers().item(2) as VectorLayer).getSource()?.getFeatures()).toHaveLength(0);

    adapter.dispose();
    host.remove();
  });
});
