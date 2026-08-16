import { RealmMapAdapter } from "./MapAdapter";
import Polygon from "ol/geom/Polygon";
import MultiLineString from "ol/geom/MultiLineString";
import VectorLayer from "ol/layer/Vector";
import { cellIdsToPolygonGeometries } from "../shared/mapShapeGeometry";
import type { MapShapeGeometry } from "../backend";

describe("RealmMapAdapter canonical map shapes", () => {
  it("renders saved terrain and regions with exact grid geometry by default", () => {
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
    expect((regionLayer.getSource()?.getFeatures()[0]?.getGeometry() as Polygon).getCoordinates()).toEqual(regionGeometry.coordinates);
    expect((adapter.getMap().getLayers().item(2) as VectorLayer).getSource()?.getFeatures()).toHaveLength(0);

    adapter.setPresentationMode(true);
    expect(terrainLayer.getSource()?.getFeatures()[0]?.getGeometry()).toBeInstanceOf(MultiLineString);
    expect((regionLayer.getSource()?.getFeatures()[0]?.getGeometry() as Polygon).getCoordinates()[0]!.length).toBeGreaterThan(regionGeometry.coordinates[0]!.length);
    expect(terrainLayer.getVisible()).toBe(true);
    expect((adapter.getMap().getLayers().item(2) as VectorLayer).getVisible()).toBe(false);

    adapter.dispose();
    host.remove();
  });

  it("keeps terrain and region outlines identical in the rendered preview", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const geometry = cellIdsToPolygonGeometries(["10:10", "11:10", "11:11"])[0]!;
    adapter.setMapShapes?.([
      { id: "11111111-1111-4111-8111-111111111111", layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry },
      { id: "22222222-2222-4222-8222-222222222222", layer: "region", regionId: "33333333-3333-4333-8333-333333333333", value: "#2468AC", geometryVersion: 1, snapGridVersion: 2, geometry },
    ]);
    adapter.setPresentationMode(true);

    const terrain = (adapter.getMap().getLayers().item(8) as VectorLayer).getSource()?.getFeatures()[0]?.getGeometry() as MultiLineString;
    const region = (adapter.getMap().getLayers().item(7) as VectorLayer).getSource()?.getFeatures()[0]?.getGeometry() as Polygon;
    expect(terrain.getCoordinates()).toEqual([region.getCoordinates()[0]]);

    adapter.dispose();
    host.remove();
  });

  it("keeps holes and disconnected region parts when rendering the preview", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const terrainGeometry = cellIdsToPolygonGeometries([
      "30:30", "31:30", "32:30",
      "30:31", "32:31",
      "30:32", "31:32", "32:32",
    ])[0]!;
    const regionGeometries = cellIdsToPolygonGeometries(["40:40", "50:50"]);
    adapter.setMapShapes?.([
      { id: "11111111-1111-4111-8111-111111111111", layer: "terrain", value: "terrain", geometryVersion: 1, snapGridVersion: 2, geometry: terrainGeometry },
      ...regionGeometries.map((geometry, index) => ({
        id: `${index === 0 ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333"}`,
        layer: "region" as const,
        regionId: "44444444-4444-4444-8444-444444444444",
        value: "#2468AC",
        geometryVersion: 1,
        snapGridVersion: 2,
        geometry,
      })),
    ]);
    adapter.setPresentationMode(true);

    const terrainFeature = ((adapter.getMap().getLayers().item(8) as VectorLayer).getSource()?.getFeatures() ?? [])[0];
    expect(terrainFeature?.getGeometry()).toBeInstanceOf(MultiLineString);
    expect((terrainFeature?.getGeometry() as MultiLineString).getCoordinates()).toHaveLength(2);
    const regionFeatures = (adapter.getMap().getLayers().item(7) as VectorLayer).getSource()?.getFeatures() ?? [];
    expect(regionFeatures).toHaveLength(2);
    expect(regionFeatures.every((feature) => feature.getGeometry() instanceof Polygon)).toBe(true);
    expect(regionFeatures.every((feature) => ((feature.getGeometry() as Polygon).getCoordinates()[0]?.length ?? 0) > 7)).toBe(true);
    expect(terrainGeometry.coordinates).toHaveLength(2);

    adapter.dispose();
    host.remove();
  });

  it("keeps a non-null grab preview as the raw continuous Polygon", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const rawGeometry: MapShapeGeometry = { type: "Polygon", coordinates: [[[0, 0], [12, 0], [12, 12], [0, 0]]] };
    const shape = {
      id: "11111111-1111-4111-8111-111111111111",
      layer: "terrain" as const,
      value: "terrain",
      geometryVersion: 1,
      snapGridVersion: 2,
      geometry: rawGeometry,
    };
    adapter.setMapShapes?.([shape]);
    const setPreview = (adapter as unknown as { setMapShapePreview: (shapes: Array<typeof shape> | null) => void }).setMapShapePreview.bind(adapter);
    setPreview([shape]);
    const preview = (adapter.getMap().getLayers().item(8) as VectorLayer).getSource()?.getFeatures()[0]?.getGeometry();
    expect(preview).toBeInstanceOf(Polygon);
    expect((preview as Polygon).getCoordinates()).toEqual(rawGeometry.coordinates);
    expect(shape.geometry).toEqual(rawGeometry);
    adapter.dispose();
    host.remove();
  });

  it("updates grab preview geometry in place without rebuilding the feature", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const source = (adapter.getMap().getLayers().item(8) as VectorLayer).getSource()!;
    const shape = {
      id: "11111111-1111-4111-8111-111111111111",
      layer: "terrain" as const,
      value: "terrain",
      geometryVersion: 1,
      snapGridVersion: 2,
      geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [12, 0], [12, 12], [0, 0]].map(([x, y]) => [x, y] as [number, number])] },
    };
    adapter.setMapShapes?.([shape]);
    const feature = source.getFeatureById(shape.id);
    const setPreview = (adapter as unknown as { setMapShapePreview: (shapes: Array<typeof shape> | null) => void }).setMapShapePreview.bind(adapter);
    setPreview([{ ...shape, geometry: { ...shape.geometry, coordinates: [[[1, 0], [13, 0], [13, 12], [1, 0]].map(([x, y]) => [x, y] as [number, number])] } }]);

    expect(source.getFeatureById(shape.id)).toBe(feature);
    expect((feature?.getGeometry() as Polygon).getCoordinates()).toEqual([[[1, 0], [13, 0], [13, 12], [1, 0]]]);
    setPreview(null);
    expect(source.getFeatureById(shape.id)).toBe(feature);
    expect((feature?.getGeometry() as Polygon).getCoordinates()).toEqual(shape.geometry.coordinates);

    adapter.dispose();
    host.remove();
  });

  it("uses the exact canonical Polygon for the grab affordance instead of cell attributes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const geometry = cellIdsToPolygonGeometries(["10:10"])[0]!;
    adapter.setMapShapes?.([{
      id: "11111111-1111-4111-8111-111111111111",
      layer: "terrain",
      value: "terrain",
      geometryVersion: 1,
      snapGridVersion: 2,
      geometry,
    }]);
    adapter.setMode("grab");
    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: geometry.coordinates[0]![0] } as never);
    expect(host.classList.contains("map-canvas-grab-target")).toBe(true);
    expect((adapter.getMap().getLayers().item(2) as VectorLayer).getSource()?.getFeatures()).toHaveLength(0);
    adapter.setMode("cell-select");
    expect(host.classList.contains("map-canvas-grab-target")).toBe(false);
    adapter.dispose();
    host.remove();
  });
});
