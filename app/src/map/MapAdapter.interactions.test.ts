import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import PointerInteraction from "ol/interaction/Pointer";
import Select from "ol/interaction/Select";
import { describe, expect, it, vi } from "vitest";
import type { MapObject, MapShape } from "../backend";
import { cellCenter, cellIdsWithinPaintPath, RealmMapAdapter } from "./MapAdapter";
import { cellPolygon } from "./gridGeometry";
import { unionMapShapeGeometries } from "../shared/mapShapeGeometry";

const object = (id: string, coordinates: [number, number], locked = false): MapObject => ({
  id,
  kind: "city",
  label: id,
  geometry: { type: "Point", coordinates },
  properties: {},
  zIndex: 0,
  locked,
});

const hostFor = (): HTMLDivElement => {
  const host = document.createElement("div");
  host.style.width = "640px";
  host.style.height = "480px";
  document.body.append(host);
  return host;
};

const pointerEvent = (button = 0): MouseEvent => {
  const event = new MouseEvent("pointerdown", { button, bubbles: true });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
};

const shape = (id: string, layer: "terrain" | "region", coordinates: [number, number][], regionId?: string): MapShape => ({
  id,
  layer,
  ...(regionId ? { regionId } : {}),
  value: layer === "terrain" ? "terrain" : "#2468AC",
  geometryVersion: 1,
  snapGridVersion: 2,
  geometry: { type: "Polygon", coordinates: [coordinates] },
});

describe("RealmMapAdapter interactions", () => {
  it("keeps cell paint and erase previews scoped to the active cell tool", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const cellLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    const center = cellCenter(10, 10);

    adapter.setActiveLayer("terrain");
    adapter.setMode("cell-select");
    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: center } as never);
    const painted = cellLayer.getSource()?.getFeatureById("10:10");
    expect(painted?.get("preview")).toBe(true);

    adapter.setCellPaintRadius(0);
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(1);
    adapter.setCellEraseRadius(1);
    adapter.setMode("cell-erase");
    expect(cellLayer.getSource()?.getFeatureById("10:10")?.get("erasePreview")).toBe(true);

    host.dispatchEvent(new Event("pointerleave"));
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);
    adapter.dispose();
    host.remove();
  });

  it("commits a cell stroke when the pointer leaves the canvas", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    adapter.onCellSelect(selected);
    adapter.setActiveLayer("terrain");
    adapter.setMode("cell-select");
    const paint = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    const center = cellCenter(10, 10);
    paint.handleEvent({ type: "pointerdown", originalEvent: pointerEvent(), coordinate: center, activePointers: [] } as never);
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    expect(selected).toHaveBeenCalledWith(expect.arrayContaining(["10:10"]));
    adapter.dispose();
    host.remove();
  });

  it("fills cells skipped by sparse pointer events during a fast stroke", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    adapter.onCellSelect(selected);
    adapter.setActiveLayer("terrain");
    adapter.setCellPaintRadius(0);
    adapter.setMode("cell-select");
    const paint = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    const methods = paint as unknown as {
      handleDownEvent: (event: { originalEvent: MouseEvent; coordinate: [number, number] }) => boolean;
      handleDragEvent: (event: { originalEvent: MouseEvent; coordinate: [number, number] }) => void;
      handleUpEvent: (event: { originalEvent: MouseEvent; coordinate: [number, number] }) => boolean;
    };
    const startCell = cellCenter(10, 10);
    const endCell = cellCenter(10, 14);
    const start: [number, number] = [startCell[0] + 0.4, startCell[1] + 0.2];
    const end: [number, number] = [endCell[0] + 0.4, endCell[1] + 0.2];

    expect(cellIdsWithinPaintPath([startCell, endCell], 0)).toEqual(expect.arrayContaining(["10:10", "11:10", "12:10", "13:10", "14:10"]));
    expect(methods.handleDownEvent({ originalEvent: pointerEvent(), coordinate: start })).toBe(true);
    methods.handleDragEvent({ originalEvent: pointerEvent(), coordinate: end });
    methods.handleUpEvent({ originalEvent: pointerEvent(), coordinate: end });

    expect(selected).toHaveBeenLastCalledWith(expect.arrayContaining(["10:10", "11:10", "12:10", "13:10", "14:10"]));
    adapter.dispose();
    host.remove();
  });

  it("supports area painting on terrain and grid painting on region", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    adapter.onCellSelect(selected);

    adapter.setActiveLayer("terrain");
    adapter.setMode("cell-region");
    const areaDraw = adapter.getMap().getInteractions().getArray().find((item) => item instanceof Draw) as Draw;
    const center = cellCenter(10, 10);
    areaDraw.dispatchEvent({ type: "drawend", feature: new Feature({ geometry: new Polygon([[[center[0] - 4, center[1] - 4], [center[0] + 4, center[1] - 4], [center[0] + 4, center[1] + 4], [center[0] - 4, center[1] + 4], [center[0] - 4, center[1] - 4]]]) }) } as never);
    expect(selected).toHaveBeenLastCalledWith(expect.arrayContaining(["10:10"]));

    selected.mockClear();
    adapter.setActiveLayer("region");
    adapter.setCellPaintRadius(0);
    adapter.setMode("cell-select");
    const paint = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    paint.handleEvent({ type: "pointerdown", originalEvent: pointerEvent(), coordinate: center, activePointers: [] } as never);
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    expect(selected).toHaveBeenLastCalledWith(expect.arrayContaining(["10:10"]));

    adapter.dispose();
    host.remove();
  });

  it("filters locked and hidden objects, then modifies and erases only editable objects", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    const modified = vi.fn();
    const erased = vi.fn();
    adapter.setActiveLayer("object");
    adapter.setObjects([object("open", [0, 0]), object("locked", [1, 1], true), object("hidden", [2, 2])]);
    adapter.onSelectObjects(selected);
    adapter.onModifyObjects(modified);
    adapter.onEraseObjects(erased);
    adapter.setObjectKindVisibility("city", false);
    adapter.setSelectedObjects(["open", "locked", "hidden"]);
    expect(adapter.getMap().getInteractions().getArray().find((item) => item instanceof Select)).toBeDefined();
    expect(selected).not.toHaveBeenLastCalledWith(["open", "locked", "hidden"]);

    adapter.setObjectKindVisibility("city", true);
    adapter.setSelectedObjects(["open"]);
    const modify = adapter.getMap().getInteractions().getArray().find((item) => item instanceof Modify) as Modify;
    const source = (adapter.getMap().getLayers().item(1) as VectorLayer).getSource();
    const openFeature = source?.getFeatureById("open");
    expect(openFeature).toBeDefined();
    modify.dispatchEvent({ type: "modifyend", features: { getArray: () => [openFeature!] } } as never);
    expect(modified).toHaveBeenCalledWith([{ id: "open", geometry: { type: "Point", coordinates: [0, 0] } }]);

    adapter.setMode("pan");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(erased).toHaveBeenCalledWith(["open"]);
    adapter.dispose();
    host.remove();
  });

  it("nudges selected objects and reports a bounded-world error", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const modified = vi.fn();
    const errors = vi.fn();
    adapter.setActiveLayer("object");
    adapter.setObjects([object("open", [0, 0]), object("locked", [1, 1], true)]);
    adapter.setSelectedObjects(["open", "locked"]);
    adapter.onModifyObjects(modified);
    adapter.onError(errors);
    const nudge = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    host.dispatchEvent(nudge);
    expect(nudge.defaultPrevented).toBe(true);
    expect(modified).toHaveBeenLastCalledWith([{ id: "open", geometry: { type: "Point", coordinates: [0.25, 0] } }]);

    adapter.setObjects([object("edge", [180, 0])]);
    adapter.setSelectedObjects(["edge"]);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(errors).toHaveBeenCalledWith("feature_outside_world");
    adapter.dispose();
    host.remove();
  });

  it("draws object geometry with the selected layer and applies drawing options", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const drawn = vi.fn();
    const errors = vi.fn();
    adapter.setActiveLayer("object");
    adapter.onDraw(drawn);
    adapter.onError(errors);
    adapter.setDrawingOptions({ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 });
    adapter.setMode("text");
    const draw = adapter.getMap().getInteractions().getArray().find((item) => item instanceof Draw) as Draw;
    expect(draw.getFreehand()).toBe(false);
    draw.dispatchEvent({ type: "drawend", feature: new Feature({ geometry: new Point([1, 2]) }) } as never);
    expect(drawn).toHaveBeenCalledWith({ type: "Point", coordinates: [1, 2] });
    host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(errors).not.toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("uses the region-only enclosure tool and never creates an object", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    const drawn = vi.fn();
    adapter.setActiveLayer("region");
    adapter.onCellSelect(selected);
    adapter.onDraw(drawn);
    adapter.setMode("cell-region");
    const draw = adapter.getMap().getInteractions().getArray().find((item) => item instanceof Draw) as Draw;
    const center = cellCenter(10, 10);
    draw.dispatchEvent({ type: "drawend", feature: new Feature({ geometry: new Polygon([[[center[0] - 4, center[1] - 4], [center[0] + 4, center[1] - 4], [center[0] + 4, center[1] + 4], [center[0] - 4, center[1] + 4], [center[0] - 4, center[1] - 4]]]) }) } as never);
    expect(selected).toHaveBeenCalledWith(expect.arrayContaining(["10:10"]));
    expect(drawn).not.toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("selects objects with a modifier lasso and supports additive selection", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const selected = vi.fn();
    adapter.setActiveLayer("object");
    adapter.setObjects([object("inside", [0, 0]), object("outside", [4, 4])]);
    adapter.onSelectObjects(selected);
    const lasso = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    const methods = lasso as unknown as {
      handleDownEvent: (event: unknown) => boolean;
      handleDragEvent: (event: unknown) => void;
      handleUpEvent: (event: unknown) => boolean;
    };
    const drawLasso = (points: [number, number][], shiftKey = false): void => {
      const start = new MouseEvent("pointerdown", { button: 0, shiftKey });
      Object.defineProperty(start, "isPrimary", { value: true });
      expect(methods.handleDownEvent({ originalEvent: start, coordinate: points[0] })).toBe(true);
      for (const point of points.slice(1, -1)) methods.handleDragEvent({ coordinate: point });
      methods.handleUpEvent({ coordinate: points.at(-1) });
    };
    drawLasso([[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]], true);
    expect(selected).toHaveBeenLastCalledWith(["inside"]);
    drawLasso([[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]], true);
    expect(selected).toHaveBeenLastCalledWith(["inside", "outside"]);
    adapter.dispose();
    host.remove();
  });

  it("moves canonical shapes with grab and clips regions with shaping", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const edited = vi.fn();
    adapter.onMapShapeEdit(edited);
    const terrainPolygon = cellPolygon(10, 10)!;
    const adjacentPolygon = cellPolygon(10, 11)!;
    const terrain = shape("terrain-shape", "terrain", terrainPolygon);
    const regionPolygon = unionMapShapeGeometries([{ type: "Polygon", coordinates: [terrainPolygon] }, { type: "Polygon", coordinates: [adjacentPolygon] }])[0]!;
    const region = { ...shape("region-shape", "region", regionPolygon.coordinates[0]!, "region-a"), geometry: regionPolygon };
    adapter.setMapShapes([terrain]);
    adapter.setActiveLayer("terrain");
    adapter.setMode("grab");
    const grab = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    const grabMethods = grab as unknown as { handleDownEvent: (event: unknown) => boolean; handleDragEvent: (event: unknown) => void; handleUpEvent: (event: unknown) => boolean };
    expect(grabMethods.handleDownEvent({ originalEvent: pointerEvent(), coordinate: cellCenter(10, 10) })).toBe(true);
    grabMethods.handleDragEvent({ coordinate: cellCenter(10, 11) });
    grabMethods.handleUpEvent({ coordinate: cellCenter(10, 11) });

    edited.mockClear();
    adapter.setMapShapes([terrain, region]);
    adapter.setActiveLayer("region");
    adapter.setMode("shape");
    const regionShape = adapter.getMap().getInteractions().getArray().at(-1) as PointerInteraction;
    const shapeMethods = regionShape as unknown as { handleDownEvent: (event: unknown) => boolean; handleUpEvent: (event: unknown) => boolean };
    expect(shapeMethods.handleDownEvent({ originalEvent: pointerEvent(), coordinate: cellCenter(10, 10) })).toBe(true);
    shapeMethods.handleUpEvent({ coordinate: cellCenter(10, 10) });
    expect(edited).toHaveBeenCalled();
    adapter.dispose();
    host.remove();
  });

  it("validates drawing options and handles temporary navigation shortcuts", () => {
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setActiveLayer("object");
    expect(() => adapter.setDrawingOptions({ gesture: "invalid" as never, smoothingPasses: 0, snapAngleDegrees: null })).toThrow("drawing_gesture");
    expect(() => adapter.setDrawingOptions({ gesture: "freehand", smoothingPasses: -1, snapAngleDegrees: null })).toThrow("drawing_smoothing");
    expect(() => adapter.setDrawingOptions({ gesture: "freehand", smoothingPasses: 0, snapAngleDegrees: 0 })).toThrow("drawing_angle");
    adapter.setMode("city");
    const spaceDown = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true });
    host.dispatchEvent(spaceDown);
    expect(spaceDown.defaultPrevented).toBe(true);
    host.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true, cancelable: true }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "0", metaKey: true, bubbles: true, cancelable: true }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true, cancelable: true }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    adapter.dispose();
    host.remove();
  });

  it("animates a new region and a changing terrain outline, then cancels both on disposal", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrame++;
      callbacks.set(id, callback);
      return id;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { callbacks.delete(id); });
    const now = vi.spyOn(window.performance, "now").mockReturnValue(1_000);
    const host = hostFor();
    const adapter = new RealmMapAdapter({ target: host });
    const outlineLayer = adapter.getMap().getLayers().item(6) as VectorLayer;
    const smoothLayer = adapter.getMap().getLayers().item(8) as VectorLayer;
    const first = { cellId: "10:10", layer: "terrain" as const, value: "terrain" };
    const adjacent = { cellId: "10:11", layer: "terrain" as const, value: "terrain" };
    adapter.setCellAttributes([first]);
    expect(outlineLayer.getVisible()).toBe(false);
    expect(smoothLayer.getVisible()).toBe(true);
    adapter.setCellAttributes([first, adjacent]);
    expect(outlineLayer.getVisible()).toBe(true);
    callbacks.forEach((callback) => callback(1_240));
    expect(outlineLayer.getVisible()).toBe(false);
    expect(smoothLayer.getVisible()).toBe(true);
    adapter.setCellAttributes([{ cellId: "10:10", layer: "region" as const, value: "#2468AC", regionId: "r1" }]);
    adapter.setCellAttributes([{ cellId: "10:10", layer: "region" as const, value: "#E45756", regionId: "r1" }]);
    expect(callbacks.size).toBeGreaterThan(0);
    adapter.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    host.remove();
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
    now.mockRestore();
  });
});
