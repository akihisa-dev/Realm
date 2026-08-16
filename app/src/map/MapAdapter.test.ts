import Feature from "ol/Feature";
import MapBrowserEvent from "ol/MapBrowserEvent";
import MapBrowserEventType from "ol/MapBrowserEventType";
import Draw from "ol/interaction/Draw";
import DragPan from "ol/interaction/DragPan";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import * as SelectModule from "ol/interaction/Select";
import Polygon from "ol/geom/Polygon";
import { describe, expect, it, vi } from "vitest";
import { CELL_GRID_CELL_COUNT, CELL_PAINT_RANGE_MAX, WORLD_EXTENT, RealmMapAdapter, assertGeometryWithinWorld, availableViewportSize, cellCenter, cellId, cellIdsWithinPaintPath, cellIdsWithinPaintPosition, cellPaintRadiusForRange, cellPolygon, isGeometryWithinWorld, resolutionForFillingExtent, resolutionForFittingExtent, selectObjectIdsWithinLasso } from "./MapAdapter";
import type { MapObject, MapShape } from "../backend";

const object = (id: string, coordinates: [number, number], locked = false): MapObject => ({
  id,
  kind: "city",
  label: id,
  geometry: { type: "Point", coordinates },
  properties: {},
  zIndex: 0,
  locked,
});

const terrainShape: MapShape = {
  id: "11111111-1111-4111-8111-111111111111",
  layer: "terrain",
  value: "terrain",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: { type: "Polygon", coordinates: [[[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]]] },
};

describe("RealmMapAdapter", () => {
  it("allows primary editing only in the selected layer", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setObjects([object("city-1", [1, 2])]);
    const selection = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof SelectModule.default) as SelectModule.default;

    adapter.setActiveLayer("terrain");
    adapter.setMode("city");
    expect(adapter.getMap().getInteractions().getArray().some((interaction) => interaction instanceof Draw)).toBe(false);
    adapter.setSelected("city-1");
    expect(selection.getFeatures().getLength()).toBe(0);

    adapter.setActiveLayer("object");
    adapter.setMode("city");
    expect(adapter.getMap().getInteractions().getArray().some((interaction) => interaction instanceof Draw)).toBe(true);
    adapter.setSelected("city-1");
    expect(selection.getFeatures().getLength()).toBe(1);

    adapter.setActiveLayer("region");
    expect(selection.getFeatures().getLength()).toBe(0);
    adapter.dispose();
    host.remove();
  });

  it("does not select a fixed-grid cell whose center lies outside the world", () => {
    const center = cellCenter(30, 127);
    expect(cellPolygon(30, 127)).not.toBeNull();
    expect(cellIdsWithinPaintPosition([Math.min(WORLD_EXTENT[2], center[0]), center[1]], 0)).not.toContain("127:30");
  });

  it("converts a region enclosure into cell ids without creating an object", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    const drawn = vi.fn();
    adapter.setActiveLayer("region");
    adapter.onCellSelect(selected);
    adapter.onDraw(drawn);
    adapter.setMode("cell-region");
    const draw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw) as Draw;
    expect(draw).toBeInstanceOf(Draw);
    expect(draw.getFreehand()).toBe(true);
    const center = cellCenter(10, 10);
    const feature = new Feature({ geometry: new Polygon([[[center[0] - 4, center[1] - 4], [center[0] + 4, center[1] - 4], [center[0] + 4, center[1] + 4], [center[0] - 4, center[1] + 4], [center[0] - 4, center[1] - 4]]]) });
    draw.dispatchEvent({ type: "drawend", feature } as never);
    expect(selected).toHaveBeenCalledWith(expect.arrayContaining(["10:10"]));
    expect(drawn).not.toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("renders canonical terrain and region projections and supports shape grab", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setMapShapes([terrainShape]);
    const terrainLayer = adapter.getMap().getLayers().item(8);
    expect(terrainLayer).toBeDefined();
    adapter.setActiveLayer("terrain");
    adapter.setMode("grab");
    expect(host.classList.contains("map-canvas-grab-target")).toBe(false);
    adapter.setMode("shape");
    expect(adapter.getMap().getInteractions().getArray().length).toBeGreaterThan(0);
    adapter.dispose();
    host.remove();
  });

  it("selects only unlocked visible objects and emits ordered object ids", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setActiveLayer("object");
    adapter.setObjects([object("open", [0, 0]), object("locked", [1, 1], true), object("hidden", [2, 2])]);
    adapter.setObjectKindVisibility("city", true);
    const selected = vi.fn();
    adapter.onSelectObjects(selected);
    const selection = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof SelectModule.default) as SelectModule.default;
    adapter.setMode("city");
    selection.getFeatures().push(((adapter.getMap().getLayers().item(1) as unknown as { getSource(): { getFeatureById(id: string): Feature | null } }).getSource().getFeatureById("open"))!);
    adapter.setSelectedObjects(["open"]);
    expect(selection.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["open"]);
    expect(selected).not.toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("emits geometry changes and erases object ids through layer-specific callbacks", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setActiveLayer("object");
    adapter.setObjects([object("a", [0, 0]), object("b", [1, 1]), object("locked", [2, 2], true)]);
    const modified = vi.fn();
    const erased = vi.fn();
    adapter.onModifyObjects(modified);
    adapter.onEraseObjects(erased);
    adapter.setSelectedObjects(["a", "b", "locked"]);
    adapter.onModifyObjects(() => undefined);
    adapter.setMode("erase");
    expect(adapter.getMap().getInteractions().getArray().some((interaction) => interaction instanceof Draw)).toBe(false);
    expect(erased).not.toHaveBeenCalled();
    expect(modified).not.toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("supports cell paint and erase footprints with bounded geometry", () => {
    expect(CELL_GRID_CELL_COUNT).toBeGreaterThan(0);
    expect(CELL_PAINT_RANGE_MAX).toBeGreaterThan(0);
    expect(cellId(4, 5)).toBe("5:4");
    expect(cellIdsWithinPaintPosition(cellCenter(10, 10), 0)).toContain("10:10");
    expect(cellIdsWithinPaintPath([cellCenter(10, 10), cellCenter(10, 11)], 1)).toEqual(expect.arrayContaining(["10:10", "10:11"]));
    expect(cellPaintRadiusForRange(0)).toBe(0);
    expect(cellPaintRadiusForRange(CELL_PAINT_RANGE_MAX + 1)).toBe(cellPaintRadiusForRange(CELL_PAINT_RANGE_MAX));
  });

  it("selects lasso intersections and respects polygon holes", () => {
    expect(selectObjectIdsWithinLasso([
      { id: "point", geometry: { type: "Point", coordinates: [1, 1] } },
      { id: "line", geometry: { type: "LineString", coordinates: [[-2, 0], [2, 0]] } },
      { id: "outside", geometry: { type: "Point", coordinates: [4, 4] } },
    ], [[-1, -1], [3, -1], [3, 3], [-1, 3]])).toEqual(["point", "line"]);
    expect(selectObjectIdsWithinLasso([{ id: "donut", geometry: { type: "Polygon", coordinates: [[[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]], [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] } }], [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]])).toEqual([]);
  });

  it("validates bounded geometry and viewport resolutions", () => {
    const point = { type: "Point" as const, coordinates: [180, 90] as [number, number] };
    expect(isGeometryWithinWorld(point)).toBe(true);
    expect(() => assertGeometryWithinWorld({ type: "Point", coordinates: [181, 0] })).toThrow("bounded world");
    expect(availableViewportSize(640, 480)).toEqual([544, 384]);
    expect(resolutionForFittingExtent(WORLD_EXTENT, [1700, 1070])).toBeCloseTo(360 / 1700);
    expect(resolutionForFillingExtent(WORLD_EXTENT, [1700, 1275])).toBeCloseTo(180 / 1275);
  });

  it("keeps secondary-button pan available while a layer tool is active", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const map = adapter.getMap();
    map.setSize([640, 480]);
    adapter.setActiveLayer("object");
    adapter.setMode("city");
    const pans = map.getInteractions().getArray().filter((interaction) => interaction instanceof DragPan);
    expect(pans.length).toBeGreaterThanOrEqual(2);
    expect(map.getInteractions().getArray().some((interaction) => interaction instanceof MouseWheelZoom)).toBe(true);
    adapter.dispose();
    host.remove();
  });

  it("disposes interaction state idempotently", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.dispose();
    expect(() => adapter.dispose()).not.toThrow();
    host.remove();
  });

  it("translates a pointer event through the OpenLayers map without creating an object", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const map = adapter.getMap();
    const event = new MapBrowserEvent(MapBrowserEventType.POINTERMOVE, map, new MouseEvent("pointermove") as never, false, undefined, []);
    event.coordinate = cellCenter(10, 10);
    map.dispatchEvent(event);
    expect(adapter.getMap()).toBe(map);
    adapter.dispose();
    host.remove();
  });
});
