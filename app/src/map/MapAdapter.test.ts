import { CELL_PAINT_RANGE_MAX, CELL_GRID_CELL_COUNT, WORLD_EXTENT, RealmMapAdapter, assertGeometryWithinWorld, availableViewportSize, cellPaintRadiusForRange, cellCenter, cellIdsWithinPaintPath, cellIdsWithinPaintPosition, cellPolygon, isGeometryWithinWorld, resolutionForFittingExtent, selectFeatureIdsWithinLasso } from "./MapAdapter";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import KeyboardZoom from "ol/interaction/KeyboardZoom";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import * as SelectModule from "ol/interaction/Select";
import PointerInteraction from "ol/interaction/Pointer";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import Polygon from "ol/geom/Polygon";
import Point from "ol/geom/Point";
import Style from "ol/style/Style";

describe("RealmMapAdapter", () => {
  it("scales full-grid padding with the viewport while keeping practical bounds", () => {
    expect(availableViewportSize(320, 240)).toEqual([240, 160]);
    expect(availableViewportSize(640, 480)).toEqual([544, 384]);
    expect(availableViewportSize(1934, 972)).toEqual([1739.6, 777.6]);
    expect(availableViewportSize(4000, 2400)).toEqual([3680, 2080]);
  });
  it("uses a fit resolution so the complete bounded world stays inside the viewport", () => {
    expect(resolutionForFittingExtent([-180, -90, 180, 90], [1700, 1070])).toBeCloseTo(360 / 1700);
    expect(resolutionForFittingExtent([-180, -90, 180, 90], [900, 400])).toBeCloseTo(180 / 400);
    expect(resolutionForFittingExtent([-180, -90, 180, 90], [400, 900])).toBeCloseTo(360 / 400);
    expect(resolutionForFittingExtent([-180, -90, 180, 90], [0, 900])).toBeNaN();
  });

  it("selects points, crossing lines, and contained polygons with a lasso", () => {
    const features = [
      { id: "inside", geometry: { type: "Point", coordinates: [1, 1] as [number, number] } },
      { id: "crossing", geometry: { type: "LineString", coordinates: [[-2, 0], [2, 0]] as [number, number][] } },
      { id: "contained", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] as [number, number][][] } },
      { id: "outside", geometry: { type: "Point", coordinates: [4, 4] as [number, number] } },
    ] as const;
    expect(selectFeatureIdsWithinLasso(features, [[-1, -1], [3, -1], [3, 3], [-1, 3]])).toEqual(["inside", "crossing", "contained"]);
    expect(selectFeatureIdsWithinLasso(features, [[0, 0], [0, 1]])).toEqual([]);
  });

  it("respects polygon holes when deciding whether a lasso intersects", () => {
    const features = [{
      id: "donut",
      geometry: { type: "Polygon", coordinates: [
        [[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]],
        [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
      ] as [number, number][][] },
    }] as const;
    expect(selectFeatureIdsWithinLasso(features, [[-1, -1], [1, -1], [1, 1], [-1, 1]])).toEqual([]);
    expect(selectFeatureIdsWithinLasso(features, [[-3, -1], [-2, -1], [-2, 1], [-3, 1]])).toEqual(["donut"]);
  });

  it("refreshes the transient paint preview after mode and range changes without resurrecting it after pointerleave", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const cellLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    const center = cellCenter(10, 10);

    adapter.setMode("cell-select");
    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: center } as never);
    const initialPreviewIds = cellIdsWithinPaintPosition(center, 2);
    expect(initialPreviewIds.every((id) => cellLayer.getSource()?.getFeatureById(id)?.get("preview") === true)).toBe(true);

    adapter.setCellPaintRadius(0);
    const narrowPreviewIds = cellIdsWithinPaintPosition(center, 0);
    expect(narrowPreviewIds).toHaveLength(1);
    expect(narrowPreviewIds[0] && cellLayer.getSource()?.getFeatureById(narrowPreviewIds[0])?.get("preview")).toBe(true);
    expect(initialPreviewIds.filter((id) => !narrowPreviewIds.includes(id)).every((id) => cellLayer.getSource()?.getFeatureById(id) === null)).toBe(true);

    adapter.setCellPaintRadius(4);
    const widePreviewIds = cellIdsWithinPaintPosition(center, 4);
    expect(widePreviewIds.every((id) => cellLayer.getSource()?.getFeatureById(id)?.get("preview") === true)).toBe(true);

    adapter.setCellEraseOptions({ mode: "grid", radiusCells: 4 });
    adapter.setMode("cell-erase");
    expect(widePreviewIds.every((id) => {
      const feature = cellLayer.getSource()?.getFeatureById(id);
      return feature?.get("preview") !== true && feature?.get("erasePreview") === true;
    })).toBe(true);
    adapter.setMode("cell-select");
    expect(widePreviewIds.every((id) => cellLayer.getSource()?.getFeatureById(id)?.get("preview") === true)).toBe(true);

    host.dispatchEvent(new Event("pointerleave"));
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);
    adapter.setCellPaintRadius(0);
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);
    adapter.setMode("cell-erase");
    adapter.setMode("cell-select");
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);

    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: center } as never);
    expect(cellLayer.getSource()?.getFeatureById(narrowPreviewIds[0]!)?.get("preview")).toBe(true);
    adapter.dispose();
    host.remove();
  });

  it("keeps locked and hidden features out of multi-selection and clears all ids on Escape", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([
      { id: "open", featureType: "city", name: "Open", geometry: { type: "Point", coordinates: [0, 0] } },
      { id: "locked", featureType: "city", name: "Locked", geometry: { type: "Point", coordinates: [1, 1] }, properties: { locked: true } },
      { id: "hidden", featureType: "town", name: "Hidden", geometry: { type: "Point", coordinates: [2, 2] } },
    ]);
    const selected = vi.fn();
    adapter.onSelectFeatures(selected);
    adapter.setLayerVisibility("town", false);
    adapter.setSelectedFeatures(["open", "locked", "hidden"]);
    const selection = adapter.getMap().getInteractions().getArray().find((item) => item instanceof SelectModule.default) as SelectModule.default | undefined;
    expect(selection?.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["open"]);
    expect(selected).not.toHaveBeenCalled();
    const openFeature = selection?.getFeatures().item(0);
    expect(openFeature).toBeDefined();
    selection?.toggleFeature(openFeature!);
    expect(selection?.getFeatures().getArray()).toHaveLength(0);
    selection?.toggleFeature(openFeature!);
    expect(selection?.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["open"]);
    const selectionCallsBeforeHiddenSync = selected.mock.calls.length;
    adapter.setLayerVisibility("city", false);
    expect(selection?.getFeatures().getArray()).toHaveLength(0);
    expect(selected).toHaveBeenCalledTimes(selectionCallsBeforeHiddenSync);
    adapter.setLayerVisibility("city", true);
    adapter.setSelectedFeatures(["open"]);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(selected).toHaveBeenLastCalledWith([]);
    adapter.dispose();
    host.remove();
  });

  it("handles wheel zoom without requiring a platform modifier", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const map = adapter.getMap();
    const wheelZoom = map.getInteractions().getArray().find((item) => item instanceof MouseWheelZoom) as MouseWheelZoom | undefined;
    expect(wheelZoom).toBeDefined();

    const wheelEvent = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    const handled = wheelZoom?.handleEvent({
      type: "wheel",
      map,
      pixel: [320, 240],
      originalEvent: wheelEvent,
    } as never);

    expect(handled).toBe(false);
    expect(wheelEvent.defaultPrevented).toBe(true);
    adapter.dispose();
    host.remove();
  });

  it("keeps middle-button drag pan available in every tool mode", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const dragPans = adapter.getMap().getInteractions().getArray().filter((item): item is DragPan => item instanceof DragPan);
    expect(dragPans).toHaveLength(2);

    const middleButtonEvent = { originalEvent: new MouseEvent("pointerdown", { button: 1 }) } as never;
    const middleDragPan = dragPans.find((interaction) => (
      interaction as unknown as { condition_: (event: unknown) => boolean }
    ).condition_(middleButtonEvent));
    expect(middleDragPan).toBeDefined();

    const primaryDragPan = dragPans.find((interaction) => interaction !== middleDragPan);
    adapter.setMode("cell-select");
    expect(primaryDragPan?.getActive()).toBe(false);
    expect(middleDragPan?.getActive()).toBe(true);
    adapter.setMode("terrain");
    expect(middleDragPan?.getActive()).toBe(true);
    adapter.setMode("pan");
    expect(primaryDragPan?.getActive()).toBe(true);
    expect(middleDragPan?.getActive()).toBe(true);
    adapter.dispose();
    host.remove();
  });

  it("emits one modify batch for a multi-feature gesture", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([
      { id: "a", featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } },
      { id: "b", featureType: "city", name: "B", geometry: { type: "Point", coordinates: [1, 1] } },
    ]);
    adapter.setSelectedFeatures(["a", "b"]);
    const batch = vi.fn();
    adapter.onModifyFeatures(batch);
    const interaction = adapter.getMap().getInteractions().getArray().find((item) => item instanceof Modify) as Modify | undefined;
    const source = (adapter.getMap().getLayers().item(1) as VectorLayer).getSource();
    const features = [source?.getFeatureById("a"), source?.getFeatureById("b")].filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));
    interaction?.dispatchEvent({ type: "modifyend", features: { getArray: () => features } } as never);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toEqual([
      { id: "a", geometry: { type: "Point", coordinates: [0, 0] } },
      { id: "b", geometry: { type: "Point", coordinates: [1, 1] } },
    ]);
    adapter.dispose();
    host.remove();
  });

  it("emits one erase batch and never routes locked ids to deletion", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([
      { id: "a", featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } },
      { id: "b", featureType: "city", name: "B", geometry: { type: "Point", coordinates: [1, 1] } },
      { id: "locked", featureType: "city", name: "Locked", geometry: { type: "Point", coordinates: [2, 2] }, properties: { locked: true } },
    ]);
    adapter.setSelectedFeatures(["a", "b", "locked"]);
    const batch = vi.fn();
    adapter.onEraseFeatures(batch);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith(["a", "b"]);
    adapter.dispose();
    host.remove();
  });

  it("nudges selected features with Arrow and shifts their layer with Shift+Arrow", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([
      { id: "a", featureType: "city", name: "A", geometry: { type: "Point", coordinates: [0, 0] } },
      { id: "b", featureType: "city", name: "B", geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] }, properties: { locked: true } },
      { id: "c", featureType: "city", name: "C", geometry: { type: "Point", coordinates: [3, 3] } },
    ]);
    adapter.setSelectedFeatures(["a", "b", "c"]);
    const batch = vi.fn();
    adapter.onModifyFeatures(batch);
    const nudge = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    host.dispatchEvent(nudge);
    expect(nudge.defaultPrevented).toBe(true);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith([
      { id: "a", geometry: { type: "Point", coordinates: [0.25, 0] } },
      { id: "c", geometry: { type: "Point", coordinates: [3.25, 3] } },
    ]);
    const fineNudge = new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true });
    host.dispatchEvent(fineNudge);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1]?.[0]).toEqual([
      { id: "a", geometry: { type: "Point", coordinates: [0.25, 0.05] } },
      { id: "c", geometry: { type: "Point", coordinates: [3.25, 3.05] } },
    ]);
    const layerShift = vi.fn(); adapter.onLayerShift(layerShift);
    const shiftUp = new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true, cancelable: true });
    host.dispatchEvent(shiftUp);
    expect(shiftUp.defaultPrevented).toBe(true);
    expect(layerShift).toHaveBeenCalledWith(1);
    expect(batch).toHaveBeenCalledTimes(2);
    adapter.setSelectedFeatures([]);
    const navigation = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    host.dispatchEvent(navigation);
    expect(navigation.defaultPrevented).toBe(false);
    adapter.dispose();
    host.remove();
  });

  it("rejects a nudge that would leave the world without writing or emitting a batch", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([{ id: "edge", featureType: "city", name: "Edge", geometry: { type: "Point", coordinates: [180, 0] } }]);
    adapter.setSelected("edge");
    const batch = vi.fn();
    const error = vi.fn();
    adapter.onModifyFeatures(batch);
    adapter.onError(error);
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("feature_outside_world");
    const source = (adapter.getMap().getLayers().item(1) as VectorLayer).getSource();
    expect((source?.getFeatureById("edge")?.getGeometry() as Point).getCoordinates()).toEqual([180, 0]);
    adapter.dispose();
    host.remove();
  });

  it("selects a thick paint stroke and expands its footprint with radius", () => {
    const oneCell = cellCenter(18, 32);
    const narrow = cellIdsWithinPaintPath([oneCell, [oneCell[0] + 0.7, oneCell[1]]], 0.25);
    const wide = cellIdsWithinPaintPath([oneCell, [oneCell[0] + 0.7, oneCell[1]]], 2);
    expect(narrow).toContain("32:18");
    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(cellIdsWithinPaintPath([], 1)).toEqual([]);
    expect(cellIdsWithinPaintPath([oneCell], -1)).toEqual([]);
    expect(cellIdsWithinPaintPath([oneCell], Number.NaN)).toEqual([]);
    expect(cellIdsWithinPaintPath([cellCenter(0, 0)], 0)).toEqual(["0:0"]);
    expect(cellIdsWithinPaintPath([[-180, -90]], 1)).toContain("0:0");
    expect(cellIdsWithinPaintPath([cellCenter(36, 63)], 1)).toContain("63:36");
    expect(cellIdsWithinPaintPath([[-Infinity, -90], [Infinity, 90]], 1)).toEqual([]);
  });

  it("maps discrete range to hex-distance footprints without duplicates or out-of-bounds cells", () => {
    expect(cellPaintRadiusForRange(1)).toBe(0);
    expect(cellPaintRadiusForRange(CELL_PAINT_RANGE_MAX)).toBe(4);
    const center = cellCenter(18, 32);
    expect(cellIdsWithinPaintPosition(center, cellPaintRadiusForRange(1))).toEqual(["32:18"]);
    const footprint = cellIdsWithinPaintPosition(center, cellPaintRadiusForRange(3));
    expect(footprint).toHaveLength(19);
    expect(new Set(footprint).size).toBe(footprint.length);
    const edgeFootprint = cellIdsWithinPaintPosition(cellCenter(0, 0), cellPaintRadiusForRange(CELL_PAINT_RANGE_MAX));
    expect(new Set(edgeFootprint).size).toBe(edgeFootprint.length);
    expect(edgeFootprint.every((id) => /^\d+:\d+$/.test(id))).toBe(true);
    expect(edgeFootprint).not.toContain("-1:0");
    expect(edgeFootprint).not.toContain("0:-1");
  });

  it("keeps erase hover and drag previews unpainted", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setCellAttributes([{ cellId: "10:10", attribute: "terrain", value: "terrain" }]);
    adapter.setCellPaintRadius(4);
    adapter.setMode("cell-erase");
    const cellLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    const style = cellLayer.getStyleFunction();

    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: cellCenter(10, 10) } as never);
    const hovered = cellLayer.getSource()?.getFeatureById("10:10");
    expect(hovered?.get("erasePreview")).toBe(true);
    expect(cellLayer.getSource()?.getFeatures().filter((feature) => feature.get("erasePreview")).map((feature) => feature.getId())).toEqual(["10:10"]);
    expect(style?.(hovered!, 1)).toBeUndefined();

    const cellPaint = adapter.getMap().getInteractions().getArray().at(-1);
    const pointerDown = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointerDown, "isPrimary", { value: true });
    cellPaint?.handleEvent({ type: "pointerdown", originalEvent: pointerDown, coordinate: cellCenter(10, 10), activePointers: [pointerDown] } as never);
    const selected = cellLayer.getSource()?.getFeatureById("10:10");
    expect(selected?.get("selected")).not.toBe(true);
    expect(selected?.get("erasePreview")).toBe(true);
    expect(style?.(selected!, 1)).toBeUndefined();

    cellPaint?.handleEvent({ type: "pointerdrag", originalEvent: pointerDown, coordinate: cellCenter(10, 11), activePointers: [pointerDown] } as never);
    const dragged = cellLayer.getSource()?.getFeatureById("11:10");
    expect(dragged?.get("erasePreview")).toBe(true);
    expect(cellLayer.getSource()?.getFeatures().filter((feature) => feature.get("erasePreview")).map((feature) => feature.getId())).toEqual(["10:10", "11:10"]);
    expect(style?.(dragged!, 1)).toBeUndefined();

    adapter.dispose();
    host.remove();
  });

  it("commits paint and erase strokes when the pointer is released outside the canvas", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const pointer = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointer, "isPrimary", { value: true });
    const painted = vi.fn();
    adapter.onCellSelect(painted);

    adapter.setMode("cell-select");
    const paintInteraction = adapter.getMap().getInteractions().getArray().at(-1);
    paintInteraction?.handleEvent({ type: "pointerdown", originalEvent: pointer, coordinate: cellCenter(0, 0), activePointers: [pointer] } as never);
    host.dispatchEvent(new Event("pointerleave"));
    expect(painted).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    expect(painted).toHaveBeenCalledOnce();
    expect(painted.mock.calls[0]?.[0]).toContain("0:0");

    adapter.setCellAttributes([{ cellId: "0:0", attribute: "terrain", value: "terrain" }]);
    adapter.setMode("cell-erase");
    const eraseInteraction = adapter.getMap().getInteractions().getArray().at(-1);
    const erased = vi.fn();
    adapter.onCellSelect(erased);
    eraseInteraction?.handleEvent({ type: "pointerdown", originalEvent: pointer, coordinate: cellCenter(0, 0), activePointers: [pointer] } as never);
    host.dispatchEvent(new Event("pointerleave"));
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    expect(erased).toHaveBeenCalledOnce();
    expect(erased.mock.calls[0]?.[0]).toContain("0:0");

    adapter.dispose();
    host.remove();
  });

  it("erases one connected terrain cluster while leaving a separated cell intact", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setCellAttributes([
      { cellId: "10:10", attribute: "terrain", value: "terrain" },
      { cellId: "11:10", attribute: "terrain", value: "terrain" },
      { cellId: "13:10", attribute: "terrain", value: "terrain" },
    ]);
    adapter.setCellEraseOptions({ mode: "cluster", radiusCells: 0 });
    adapter.setMode("cell-erase");
    const erased = vi.fn();
    adapter.onCellSelect(erased);
    const interaction = adapter.getMap().getInteractions().getArray().at(-1);
    const pointer = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointer, "isPrimary", { value: true });
    const center = cellCenter(10, 10);
    interaction?.handleEvent({ type: "pointerdown", originalEvent: pointer, coordinate: center, activePointers: [pointer] } as never);
    interaction?.handleEvent({ type: "pointerup", originalEvent: pointer, coordinate: center, activePointers: [] } as never);
    expect(erased).toHaveBeenCalledWith(["10:10", "11:10"]);
    adapter.dispose();
    host.remove();
  });

  it("builds closed regular hex cells without deforming the grid edge", () => {
    const even = cellCenter(18, 32);
    const odd = cellCenter(19, 32);
    expect(odd[0]).toBeGreaterThan(even[0]);
    const interior = cellPolygon(18, 32);
    expect(interior).toHaveLength(7);
    expect(interior?.[0]).toEqual(interior?.at(-1));
    const sideLengths = interior?.slice(1).map(([x, y], index) => Math.hypot(x - interior[index]![0], y - interior[index]![1])) ?? [];
    expect(Math.max(...sideLengths) - Math.min(...sideLengths)).toBeLessThan(1e-8);
    expect(interior?.every(([longitude, latitude]) => longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90)).toBe(true);
    const edge = cellPolygon(1, 0);
    const edgeSideLengths = edge?.slice(1).map(([x, y], index) => Math.hypot(x - edge[index]![0], y - edge[index]![1])) ?? [];
    expect(Math.max(...edgeSideLengths) - Math.min(...edgeSideLengths)).toBeLessThan(1e-8);
    expect(cellPolygon(-1, 0)).toBeNull();
    expect(cellPolygon(0, 64)).toBeNull();
    for (const [row, column] of [[0, 0], [0, 63], [36, 0], [36, 63]] as const) {
      const boundaryCell = cellPolygon(row, column);
      expect(boundaryCell).not.toBeNull();
      expect(boundaryCell?.every(([longitude, latitude]) => longitude >= WORLD_EXTENT[0]
        && longitude <= WORLD_EXTENT[2] && latitude >= WORLD_EXTENT[1] && latitude <= WORLD_EXTENT[3])).toBe(true);
    }
  });

  it("rejects paint positions and paths outside the finite world extent", () => {
    expect(cellIdsWithinPaintPosition([-180.01, 0], 1)).toEqual([]);
    expect(cellIdsWithinPaintPosition([180.01, 0], 1)).toEqual([]);
    expect(cellIdsWithinPaintPosition([0, -90.01], 1)).toEqual([]);
    expect(cellIdsWithinPaintPosition([0, 90.01], 1)).toEqual([]);
    expect(cellIdsWithinPaintPath([[0, 0], [180.01, 0]], 1)).toEqual([]);
    expect(cellIdsWithinPaintPath([[-180, -90], [180, 90]], 1).length).toBeGreaterThan(0);
  });

  it("guards feature geometry at the bounded world edge", () => {
    expect(isGeometryWithinWorld({ type: "Point", coordinates: [180, 90] })).toBe(true);
    expect(isGeometryWithinWorld({ type: "Point", coordinates: [180.01, 90] })).toBe(false);
    expect(isGeometryWithinWorld({ type: "LineString", coordinates: [[0, 0], [0, 91]] })).toBe(false);
    expect(isGeometryWithinWorld({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] })).toBe(true);
    expect(() => assertGeometryWithinWorld({ type: "Point", coordinates: [181, 0] })).toThrow("bounded world");
  });

  it("validates grid options and keeps deterministic hex edges outside semantic selection", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    expect(() => adapter.setGridOptions({ kind: "hex", color: "red", width: 1, spacingDegrees: 10 })).toThrow(/RRGGBB/);
    expect(() => adapter.setGridOptions({ kind: "square", color: "#102030", width: 0.1, spacingDegrees: 10 })).toThrow(/width/);
    expect(() => adapter.setGridOptions({ kind: "square", color: "#102030", width: 1, spacingDegrees: 1 })).toThrow(/spacing/);
    adapter.setFeatures([{ id: "city", featureType: "city", name: "City", geometry: { type: "Point", coordinates: [0, 0] } }]);
    adapter.setGridOptions({ kind: "hex", color: "#102030", width: 1.25, spacingDegrees: 30 });
    const hexLayer = adapter.getMap().getLayers().item(3) as VectorLayer;
    const cellGridLayer = adapter.getMap().getLayers().item(4) as VectorLayer;
    expect(cellGridLayer.getSource()?.getFeatures()).toHaveLength(1);
    expect(cellGridLayer.getSource()?.getWrapX()).toBe(false);
    expect(cellGridLayer.getVisible()).toBe(false);
    adapter.setCellGridVisible(true);
    expect(cellGridLayer.getVisible()).toBe(true);
    adapter.setCellGridOptions({ color: "#203040", width: 0.75 });
    expect(cellGridLayer.getSource()?.getFeatures()[0]?.getGeometry()).toBeInstanceOf(MultiLineString);
    const insideGridLayer = adapter.getMap().getLayers().item(5) as VectorLayer;
    const outsideStyle = (cellGridLayer.getStyleFunction()?.(new Feature(), 1) as Style[])[0]!;
    const insideStyle = (insideGridLayer.getStyleFunction()?.(new Feature(), 1) as Style[])[0]!;
    expect(outsideStyle.getStroke()?.getColor()).toBe("rgba(32, 48, 64, 0.58)");
    expect(insideStyle.getStroke()?.getColor()).toBe("rgba(32, 48, 64, 0.28)");
    expect(() => adapter.setCellGridOptions({ color: "gray", width: 0.75 })).toThrow(/RRGGBB/);
    expect(() => adapter.setCellGridOptions({ color: "#203040", width: 0.1 })).toThrow(/width/);
    const firstEdges = hexLayer.getSource()?.getFeatures().map((feature) => feature.getId());
    expect(firstEdges?.length).toBeGreaterThan(0);
    for (const feature of hexLayer.getSource()?.getFeatures() ?? []) {
      const coordinates = (feature.getGeometry() as LineString).getCoordinates();
      expect(coordinates.every(([longitude, latitude]) => typeof longitude === "number" && typeof latitude === "number"
        && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90)).toBe(true);
    }
    adapter.setGridOptions({ kind: "hex", color: "#102030", width: 1.25, spacingDegrees: 30 });
    expect(hexLayer.getSource()?.getFeatures().map((feature) => feature.getId())).toEqual(firstEdges);
    adapter.setSelectedFeatures([firstEdges?.[0] ?? "city", "city"]);
    const select = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof SelectModule.default) as SelectModule.default;
    expect(select.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["city"]);
    adapter.setGridVisible(false);
    expect(hexLayer.getVisible()).toBe(false);
    adapter.setGridVisible(true);
    expect(hexLayer.getVisible()).toBe(true);
    adapter.setGridOptions({ kind: "graticule", color: "#405060", width: 2, spacingDegrees: 15 });
    expect(adapter.getMap().getLayers().item(0)).toBeInstanceOf(Graticule);
    expect((adapter.getMap().getLayers().item(3) as VectorLayer).getVisible()).toBe(false);
    adapter.dispose();
    expect(adapter.getMap().getTarget()).toBeNull();
    host.remove();
  });

  it("switches freehand and vertex gestures, finishes vertices on context menu, and refines the snapped endpoint", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setMode("river");
    let draw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw) as Draw;
    expect(draw.getFreehand()).toBe(true);

    adapter.setDrawingOptions({ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 });
    expect(draw.getFreehand()).toBe(false);
    const finish = vi.spyOn(draw, "finishDrawing");
    expect(host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(false);
    expect(finish).toHaveBeenCalledOnce();

    const onDraw = vi.fn();
    adapter.onDraw(onDraw);
    draw.dispatchEvent({
      type: "drawend",
      feature: new Feature({ geometry: new LineString([[0, 0], [1, 0.5], [2, 0.5]]) }),
    } as never);
    expect(onDraw).toHaveBeenCalledOnce();
    const snapped = onDraw.mock.calls[0]?.[0];
    expect(snapped.type).toBe("LineString");
    const lineStart = snapped.coordinates.at(-2);
    const lineEnd = snapped.coordinates.at(-1);
    expect(lineStart).toBeDefined();
    expect(lineEnd).toBeDefined();
    const lineAngle = Math.atan2(lineEnd![1] - lineStart![1], lineEnd![0] - lineStart![0]) * 180 / Math.PI;
    expect(Math.abs(lineAngle / 45 - Math.round(lineAngle / 45))).toBeLessThan(1e-8);

    adapter.setDrawingOptions({ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: null });
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true, shiftKey: true, bubbles: true }));
    draw.dispatchEvent({ type: "drawend", feature: new Feature({ geometry: new LineString([[0, 0], [1, 0.6]]) }) } as never);
    const modifierSnapped = onDraw.mock.calls[1]?.[0];
    expect(modifierSnapped.type).toBe("LineString");
    const modifierEnd = modifierSnapped.coordinates[1];
    expect(Math.atan2(modifierEnd![1], modifierEnd![0]) * 180 / Math.PI).toBeCloseTo(45);
    host.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));
    draw.dispatchEvent({ type: "drawend", feature: new Feature({ geometry: new LineString([[0, 0], [1, 2], [3, 1]]) }) } as never);
    expect(onDraw.mock.calls[2]?.[0]).toEqual({ type: "LineString", coordinates: [[0, 0], [3, 1]] });
    host.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));

    adapter.setMode("country");
    draw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw) as Draw;
    draw.dispatchEvent({
      type: "drawend",
      feature: new Feature({ geometry: new Polygon([[ [0, 0], [2, 0], [2, 2], [0, 0] ]]) }),
    } as never);
    const polygon = onDraw.mock.calls[3]?.[0];
    expect(polygon.type).toBe("Polygon");
    expect(polygon.coordinates[0]?.at(-1)).toEqual(polygon.coordinates[0]?.[0]);

    const onError = vi.fn();
    adapter.onError(onError);
    draw.dispatchEvent({
      type: "drawend",
      feature: new Feature({ geometry: new Polygon([[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]]) }),
    } as never);
    expect(onError).toHaveBeenCalledWith("drawing_self_intersection");
    expect(onDraw).toHaveBeenCalledTimes(4);

    adapter.setMode("river");
    draw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw) as Draw;
    const abort = vi.spyOn(draw, "abortDrawing");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(abort).toHaveBeenCalledOnce();
    expect(() => adapter.setDrawingOptions({ gesture: "freehand", smoothingPasses: 5, snapAngleDegrees: null })).toThrow("drawing_smoothing");
    expect(() => adapter.setDrawingOptions({ gesture: "freehand", smoothingPasses: 0, snapAngleDegrees: 0 })).toThrow("drawing_angle");
    adapter.dispose();
    host.remove();
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
    adapter.setGridVisible(false);
    expect(graticule.getVisible()).toBe(false);
    adapter.setGridVisible(true);
    expect(adapter.getMap().getLayers().getLength()).toBe(7);
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
    const featureLayer = adapter.getMap().getLayers().item(1) as VectorLayer;
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
    const retainedCity = featureSource?.getFeatureById("city-1");
    adapter.setFeatures([
      { id: "city-1", featureType: "city", name: "Renamed", geometry: { type: "Point", coordinates: [13, 35] }, properties: { zIndex: 1 } },
    ]);
    expect(featureSource?.getFeatures()).toHaveLength(1);
    expect(featureSource?.getFeatureById("city-1")).toBe(retainedCity);
    expect(featureSource?.getFeatureById("city-1")?.get("name")).toBe("Renamed");
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
    expect((adapter.getMap().getLayers().item(2) as VectorLayer).getSource()?.getFeatures()).toHaveLength(0);
    adapter.setMode("river");
    const riverDraw = adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof Draw);
    expect(riverDraw).toBeInstanceOf(Draw);
    expect((riverDraw as Draw).getFreehand()).toBe(true);
    host.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(adapter.getMap().getInteractions().getArray().find((interaction) => interaction instanceof DragPan)?.getActive()).toBe(true);
    expect((riverDraw as Draw).getActive()).toBe(false);
    host.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
    expect((riverDraw as Draw).getActive()).toBe(true);
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
    expect(host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(false);
    adapter.setMode("pan");
    expect(adapter.getMap().getInteractions().getArray().some((interaction) => interaction instanceof Draw)).toBe(false);
    const interactions = adapter.getMap().getInteractions().getArray();
    expect(interactions.some((interaction) => interaction instanceof DragPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof MouseWheelZoom)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardZoom)).toBe(true);

    adapter.setMode("cell-select");
    const cellLayer = adapter.getMap().getLayers().item(2) as VectorLayer;
    expect(cellLayer.getVisible()).toBe(true);
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);
    const hoverCellIds = cellIdsWithinPaintPosition(cellCenter(10, 10), 1);
    expect(hoverCellIds).toHaveLength(7);
    adapter.getMap().dispatchEvent({ type: "pointermove", coordinate: cellCenter(10, 10) } as never);
    expect(hoverCellIds.length).toBeGreaterThan(0);
    expect(hoverCellIds.every((id) => cellLayer.getSource()?.getFeatureById(id)?.get("preview") === true)).toBe(true);
    const previewFeature = cellLayer.getSource()?.getFeatureById(hoverCellIds[0]!);
    const previewStyles = cellLayer.getStyleFunction()?.(previewFeature!, 1) as Style[];
    expect(previewStyles.some((style) => style.getStroke()?.getLineDash())).toBeTruthy();
    host.dispatchEvent(new Event("pointerleave"));
    expect(cellLayer.getSource()?.getFeatures()).toHaveLength(0);
    adapter.setCellGridVisible(true);
    const fixedCellGridLayer = adapter.getMap().getLayers().item(4) as VectorLayer;
    expect(fixedCellGridLayer.getVisible()).toBe(true);
    expect(fixedCellGridLayer.getSource()?.getFeatures()).toHaveLength(1);
    adapter.setCellAttributes([{ cellId: "2:2", attribute: "terrain", value: "terrain" }]);
    expect(cellLayer.getSource()?.getFeatureById("2:2")).toBeDefined();
    adapter.setMode("pan");
    adapter.setCellAttributes([]);
    adapter.setMode("cell-select");
    expect(cellLayer.getSource()?.getFeatureById("2:2")).toBeNull();
    expect(fixedCellGridLayer.getVisible()).toBe(true);
    adapter.setCellAttributes([
      { cellId: "0:0", attribute: "terrain", value: "terrain" },
      { cellId: "1:0", attribute: "forest", value: "forest" },
      { cellId: "3:0", attribute: "country", value: "A" },
      { cellId: "4:0", attribute: "region", value: "B" },
    ]);
    const insideGridLayer = adapter.getMap().getLayers().item(5) as VectorLayer;
    const outsideGridStyles = fixedCellGridLayer.getStyleFunction()?.(fixedCellGridLayer.getSource()?.getFeatures()[0]!, 1) as Style[];
    const insideGridStyles = insideGridLayer.getStyleFunction()?.(insideGridLayer.getSource()?.getFeatures()[0]!, 1) as Style[];
    const outsideGridStyle = outsideGridStyles[0]!;
    const insideGridStyle = insideGridStyles[0]!;
    expect(outsideGridStyle.getStroke()?.getColor()).toBe("rgba(209, 215, 220, 0.58)");
    expect(insideGridStyle.getStroke()?.getColor()).toBe("rgba(209, 215, 220, 0.28)");
    expect(insideGridLayer.getVisible()).toBe(true);
    const terrainOutlineLayer = adapter.getMap().getLayers().item(6) as VectorLayer;
    const terrainOutline = terrainOutlineLayer.getSource()?.getFeatures()[0];
    expect(terrainOutline?.getGeometry()).toBeInstanceOf(MultiLineString);
    const outlineStyle = terrainOutlineLayer.getStyleFunction()?.(terrainOutline!, 1) as Style;
    expect(outlineStyle.getFill()).toBeNull();
    expect(outlineStyle.getStroke()?.getColor()).toBe("#443a2b");
    expect(cellLayer.getSource()?.getFeatures().length).toBeLessThan(CELL_GRID_CELL_COUNT);
    const cellStyleFunction = cellLayer.getStyleFunction();
    const forestCell = cellLayer.getSource()?.getFeatureById("1:0");
    const forestStyle = (cellStyleFunction?.(forestCell!, 1) as Style[])[0]!;
    expect(forestCell?.getGeometry()).toBeInstanceOf(Polygon);
    expect(forestStyle.getFill()?.getColor()).toBe("#426a45");
    expect(host.style.background).toBe("rgb(255, 255, 255)");
    adapter.setTheme("midnight");
    expect(host.dataset.mapTheme).toBe("midnight");
    expect(host.style.background).not.toBe("");
    adapter.setThemeOverrides({ canvas: "#010203", river: "#102030", grid: "#304050" });
    expect(host.style.background).toBe("rgb(1, 2, 3)");
    expect(() => adapter.setThemeOverrides({ canvas: "rgb(1, 2, 3)" })).toThrow(/RRGGBB/);
    expect(() => adapter.setThemeOverrides({ unknown: "#010203" } as never)).toThrow(/Unknown theme override/);
    const cellPaint = adapter.getMap().getInteractions().getArray().at(-1);
    expect(cellPaint).toBeInstanceOf(PointerInteraction);
    expect(interactions.find((interaction) => interaction instanceof DragPan)?.getActive()).toBe(false);
    expect(interactions.find((interaction) => interaction instanceof KeyboardPan)?.getActive()).toBe(false);
    const pointerDown = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointerDown, "isPrimary", { value: true });
    cellPaint?.handleEvent({ type: "pointerdown", originalEvent: pointerDown, coordinate: cellCenter(10, 10), activePointers: [pointerDown] } as never);
    expect((cellPaint as unknown as { handlingDownUpSequence: boolean }).handlingDownUpSequence).toBe(true);
    const paintedPreview = cellLayer.getSource()?.getFeatures().find((feature) => feature.get("selected") === true);
    expect(paintedPreview).toBeDefined();
    expect(paintedPreview?.get("paintPreview")).toBe(true);
    const paintedStyles = cellLayer.getStyleFunction()?.(paintedPreview!, 1) as Style[];
    expect(paintedStyles.at(-1)?.getFill()?.getColor()).toBe("#35463f");
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
    expect((cellPaint as unknown as { handlingDownUpSequence: boolean }).handlingDownUpSequence).toBe(false);
    expect(cellLayer.getSource()?.getFeatures().some((feature) => feature.get("selected") === true)).toBe(true);
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
    expect(emptyCell).toBeNull();
    adapter.setZoom(3);
    expect(adapter.getZoom()).toBe(3);
    adapter.setZoom(99);
    expect(adapter.getZoom()).toBe(8);
    adapter.setZoom(-99);
    expect(adapter.getZoom()).toBe(1);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true }));
    expect(adapter.getZoom()).toBe(1);
    adapter.setCellPaintRadius(Number.NaN);
    adapter.setCellPaintRadius(999);
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
    const fittedResolution = resolutionForFittingExtent([-180, -90, 180, 90], [544, 384]);
    expect(view.getResolution()).toBeCloseTo(fittedResolution);
    expect(view.getZoom()).toBeCloseTo(view.getMinZoom());
    const initialFitExtent = view.calculateExtent([640, 480]);
    expect(initialFitExtent[0]).toBeLessThanOrEqual(WORLD_EXTENT[0]);
    expect(initialFitExtent[1]).toBeLessThanOrEqual(WORLD_EXTENT[1]);
    expect(initialFitExtent[2]).toBeGreaterThanOrEqual(WORLD_EXTENT[2]);
    expect(initialFitExtent[3]).toBeGreaterThanOrEqual(WORLD_EXTENT[3]);
    view.setViewportSize([640, 480]);
    view.setCenter([400, 220]);
    const constrainedCenter = view.getCenter();
    expect(constrainedCenter?.[0]).toBeGreaterThanOrEqual(-180);
    expect(constrainedCenter?.[0]).toBeLessThanOrEqual(180);
    expect(constrainedCenter?.[1]).toBe(0);

    adapter.setZoom(3);
    view.setViewportSize([640, 480]);
    view.setCenter([400, 220]);
    const constrainedExtent = view.calculateExtent([640, 480]);
    expect(constrainedExtent[0]).toBeGreaterThanOrEqual(-180);
    expect(constrainedExtent[1]).toBeGreaterThanOrEqual(-90);
    expect(constrainedExtent[2]).toBeLessThanOrEqual(180);
    expect(constrainedExtent[3]).toBeLessThanOrEqual(90);
    adapter.getMap().setSize([900, 400]);
    adapter.updateSize();
    expect(adapter.getZoom()).toBe(3);
    const resizedFitResolution = resolutionForFittingExtent([-180, -90, 180, 90], [820, 320]);
    const resizedFitZoom = view.getZoomForResolution(resizedFitResolution);
    expect(resizedFitZoom).not.toBeUndefined();
    expect(view.getResolution()).toBeCloseTo(view.getResolutionForZoom((resizedFitZoom ?? 0) + 2));
    adapter.setZoom(1);
    const resizedFitExtent = view.calculateExtent([900, 400]);
    expect(resizedFitExtent[0]).toBeLessThanOrEqual(WORLD_EXTENT[0]);
    expect(resizedFitExtent[1]).toBeLessThanOrEqual(WORLD_EXTENT[1]);
    expect(resizedFitExtent[2]).toBeGreaterThanOrEqual(WORLD_EXTENT[2]);
    expect(resizedFitExtent[3]).toBeGreaterThanOrEqual(WORLD_EXTENT[3]);
    expect(view.getZoom()).toBeCloseTo(view.getMinZoom());
    adapter.getMap().setSize([2000, 1400]);
    adapter.updateSize();
    expect(view.getResolution()).toBeCloseTo(resolutionForFittingExtent([-180, -90, 180, 90], [1720, 1120]));
    expect(adapter.getZoom()).toBe(1);
    adapter.dispose();
    adapter.dispose();
    expect(adapter.getMap().getTarget()).toBeNull();
    host.remove();
  });

  it("rejects invalid or unsafe configured export dimensions before rendering", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    await expect(adapter.exportRaster("image/png", 1, "world", { width: 511, height: 1024 })).rejects.toThrow("512〜8192px");
    await expect(adapter.exportRaster("image/png", 2, "world", { width: 8192, height: 8192 })).rejects.toThrow("大きすぎます");
    await expect(adapter.exportRaster("image/jpeg", 1, "world", { width: 1024, height: 1024, quality: 0.49 })).rejects.toThrow("50〜100%");
    adapter.dispose();
    host.remove();
  });

  it("exports configured pixels without selection chrome and restores map state", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setFeatures([{ id: "selected", featureType: "city", name: "Selected", geometry: { type: "Point", coordinates: [0, 0] } }]);
    adapter.setSelectedFeatures(["selected"]);
    const map = adapter.getMap();
    map.setSize([640, 480]);
    const view = map.getView();
    view.setCenter([12, 8]);
    const originalResolution = view.getResolution();
    const renderSpy = vi.spyOn(map, "renderSync").mockImplementation(() => undefined);
    const fillRect = vi.fn(); const drawImage = vi.fn(); const beginPath = vi.fn(); const arc = vi.fn(); const fill = vi.fn();
    const context = { fillStyle: "", fillRect, drawImage, beginPath, arc, fill } as unknown as CanvasRenderingContext2D;
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = 640; sourceCanvas.height = 480; host.append(sourceCanvas);
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, mimeType, quality) => {
      expect(mimeType).toBe("image/png");
      expect(quality).toBe(0.8);
      callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob);
    });
    const raster = await adapter.exportRaster("image/png", 1, "viewport", { width: 512, height: 512, transparent: true, quality: 0.8 });
    expect(raster).toMatchObject({ width: 512, height: 512 });
    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(map.getSize()).toEqual([640, 480]);
    expect(view.getCenter()).toEqual([12, 8]);
    expect(view.getResolution()).toBe(originalResolution);
    const selection = map.getInteractions().getArray().find((item) => item instanceof SelectModule.default) as SelectModule.default;
    expect(selection.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["selected"]);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    toBlobSpy.mockRestore(); contextSpy.mockRestore(); renderSpy.mockRestore();
    adapter.dispose(); host.remove();
  });
});
