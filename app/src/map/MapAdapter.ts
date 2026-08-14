import Feature from "ol/Feature";
import Map from "ol/Map";
import type BaseEvent from "ol/events/Event";
import View from "ol/View";
import type Graticule from "ol/layer/Graticule";
import MultiLineString from "ol/geom/MultiLineString";
import Polygon from "ol/geom/Polygon";
import Draw from "ol/interaction/Draw";
import PointerInteraction from "ol/interaction/Pointer";
import Modify from "ol/interaction/Modify";
import Translate from "ol/interaction/Translate";
import * as SelectModule from "ol/interaction/Select";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import { singleClick } from "ol/events/condition";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import type { CellAttributeSnapshot, GeoJsonGeometry, MoveRegionCellsInput, Position, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import { CELL_PAINT_RADII, WORLD_EXTENT, availableViewportSize, cellIdsWithinPaintPath as gridCellIdsWithinPaintPath, cellIdsWithinPaintPosition as gridCellIdsWithinPaintPosition, cellPolygon as gridCellPolygon, parseCellId } from "./gridGeometry";
import { drawTypeForMode, geometryFromGeoJson as guardedGeometryFromGeoJson, geometryToGeoJson as guardedGeometryToGeoJson } from "./geoJsonGeometry";
import { MAX_SMOOTHING_PASSES, refineDrawnGeometry } from "./drawingGeometry";
import { DrawingGeometryError, mapErrorCode, type MapErrorCode } from "./errors";
import { createCellStyle, createFeatureStyle } from "./styles";
import { DEFAULT_MAP_THEME_ID, mapTheme, validateThemeOverrides, type MapThemeId, type ThemeOverrides } from "./themes";
import { paintMapTexture } from "./mapTexture";
import { assertGeometryWithinWorld } from "./geometryGuard";
import { exactCellBoundaryPolygons, smoothCellBoundaryPolygons, smoothCellBoundaryRings, splitTerrainGridSegments } from "./terrainOutline";
import { TerrainOutlineAnimator } from "./terrainOutlineAnimator";
import { CellRegionController } from "./CellRegionController";
import { boundedHexGrid, boundedSquareGrid, createGraticule, DEFAULT_GRID_OPTIONS, fixedCellGridLines } from "./gridLayers";
import { selectFeatureIdsWithinLasso } from "./lassoSelection";
import { RegionGrabController } from "./RegionGrabController";
import { adjacentCellIds, connectedCellComponents } from "./regionGrab";
import { nudgeGeometry, resolutionForFittingExtent, snapFinalGeometry, straightenLine } from "./mapAdapterGeometry";
import type { CellGridOptions, DrawingOptions, ExportCanvasSize, FeatureGeometryChange, GridOptions, MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";

export type { CellGridOptions, DrawingOptions, ExportCanvasSize, FeatureGeometryChange, GridOptions, MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";
export type { CellPaintSize } from "./gridGeometry";
export { CELL_PAINT_RADII, CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN, CELL_GRID_CELL_COUNT, CELL_GRID_COLUMNS, CELL_GRID_ROWS, WORLD_EXTENT, availableViewportSize, cellPaintRadiusForRange, cellCenter, cellId, cellIdsWithinPaintPath, cellIdsWithinPaintPosition, cellPolygon, parseCellId } from "./gridGeometry";
export { assertGeometryWithinWorld, isGeometryWithinWorld, isPositionWithinWorld } from "./geometryGuard";
export { selectFeatureIdsWithinLasso } from "./lassoSelection";
export { resolutionForFittingExtent } from "./mapAdapterGeometry";
const MAX_LASSO_POINTS = 4096;
const DEFAULT_CELL_GRID_OPTIONS: CellGridOptions = { color: "#d1d7dc", width: 0.65 };
const OUTSIDE_GRID_OPACITY = 0.58;
const INSIDE_GRID_OPACITY = 0.28;
const INSIDE_GRID_LINE_DASH = [1, 3];
const colorWithOpacity = (color: string, opacity: number): string => {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};
class CancelablePointerInteraction extends PointerInteraction {
  cancelSequence(): void {
    this.handlingDownUpSequence = false;
    this.targetPointers = [];
  }
}
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;
  private readonly worldExtent = WORLD_EXTENT;
  private activeThemeId: MapThemeId = DEFAULT_MAP_THEME_ID;
  private themeOverrides: ThemeOverrides = {};
  private readonly hiddenFeatureTypes = new Set<RealmFeature["featureType"]>();
  private assetUrls: Readonly<Record<string, string>> = {};
  private readonly featureSource = new VectorSource({ wrapX: false });
  private graticule: Graticule;
  private readonly featureLayer: VectorLayer;
  private readonly featureStyle = createFeatureStyle(() => this.activeThemeId, (featureType) => featureType === undefined || !this.hiddenFeatureTypes.has(featureType), (assetId) => this.assetUrls[assetId], () => this.themeOverrides);
  private readonly cellSource = new VectorSource({ wrapX: false });
  private readonly cellLayer: VectorLayer;
  private readonly terrainOutlineSource = new VectorSource({ wrapX: false });
  private readonly terrainOutlineLayer: VectorLayer;
  private readonly terrainSmoothSource = new VectorSource({ wrapX: false });
  private readonly terrainSmoothLayer: VectorLayer;
  private readonly regionSmoothSource = new VectorSource({ wrapX: false });
  private readonly regionSmoothLayer: VectorLayer;
  private readonly terrainOutlineAnimator: TerrainOutlineAnimator;
  private readonly cellRegion: CellRegionController;
  private readonly cellGridSource = new VectorSource({ wrapX: false });
  private readonly fixedCellGridLines = fixedCellGridLines();
  private readonly cellGridStroke = new Stroke({ color: colorWithOpacity(DEFAULT_CELL_GRID_OPTIONS.color, OUTSIDE_GRID_OPACITY), width: DEFAULT_CELL_GRID_OPTIONS.width });
  private readonly cellGridLayer: VectorLayer;
  private readonly terrainCellGridSource = new VectorSource({ wrapX: false });
  private readonly terrainCellGridStroke = new Stroke({ color: colorWithOpacity(DEFAULT_CELL_GRID_OPTIONS.color, INSIDE_GRID_OPACITY), width: DEFAULT_CELL_GRID_OPTIONS.width, lineDash: INSIDE_GRID_LINE_DASH, lineCap: "round" });
  private readonly terrainCellGridLayer: VectorLayer;
  private readonly gridSource = new VectorSource({ wrapX: false });
  private readonly gridStroke = new Stroke({ color: DEFAULT_GRID_OPTIONS.color, width: DEFAULT_GRID_OPTIONS.width });
  private readonly gridLayer = new VectorLayer({ source: this.gridSource, style: new Style({ stroke: this.gridStroke }), zIndex: -10, visible: false });
  private readonly cellStyle = createCellStyle(() => this.activeThemeId, () => this.themeOverrides);
  private readonly selection: SelectModule.default;
  private readonly modify: Modify;
  private readonly translate: Translate;
  private readonly lasso: PointerInteraction;
  private readonly middleDragPan = new DragPan({
    condition: ({ originalEvent }) => originalEvent instanceof MouseEvent && originalEvent.button === 1,
  });
  private readonly target: HTMLElement;
  private draw: Draw | null = null;
  private activeMode: RealmMapMode = "pan";
  private drawingGesture: DrawingOptions["gesture"] = "freehand";
  private drawingSmoothingPasses: number | undefined;
  private drawingSnapAngleDegrees: number | null = null;
  private modifierSnapAngleDegrees: number | null = null;
  private modifierStraighten = false;
  private gridOptions: GridOptions = { ...DEFAULT_GRID_OPTIONS };
  private gridVisible = true;
  private cellPaintRadius: number = CELL_PAINT_RADII.medium;
  private cellEraseRadius = 0;
  private paint: CancelablePointerInteraction | null = null;
  private eraser: PointerInteraction | null = null;
  private grab: RegionGrabController | null = null;
  private paintLastPoint: [number, number] | null = null;
  private paintStrokeSelection = new Set<string>();
  private paintSelectionBeforeStroke: string[] = [];
  private readonly cellFeatures = new globalThis.Map<string, Feature>();
  private cellAttributesById = new globalThis.Map<string, CellAttributeSnapshot[]>();
  private selectedCellIds = new Set<string>();
  private hoveredCellIds = new Set<string>();
  private lastPointerCoordinate: [number, number] | null = null;
  private pointerInside = false;
  private readonly drawListeners = new Set<(geometry: GeoJsonGeometry) => void>();
  private readonly selectFeaturesListeners = new Set<(featureIds: readonly string[]) => void>();
  private readonly selectListeners = new Set<(featureId: string | null) => void>();
  private readonly cellSelectListeners = new Set<(cellIds: readonly string[]) => void>();
  private readonly regionMoveListeners = new Set<(input: MoveRegionCellsInput) => void>();
  private readonly modifyFeaturesListeners = new Set<(changes: readonly FeatureGeometryChange[]) => void>();
  private readonly modifyListeners = new Set<(featureId: string, geometry: GeoJsonGeometry) => void>();
  private readonly eraseFeaturesListeners = new Set<(featureIds: readonly string[]) => void>();
  private readonly eraseListeners = new Set<(featureId: string) => void>();
  private readonly layerShiftListeners = new Set<(direction: -1 | 1) => void>();
  private readonly errorListeners = new Set<(code: MapErrorCode) => void>();
  private baseZoom = 0;
  private temporaryPan = false;
  private lassoPoints: Position[] = [];
  private lassoAdditive = false;
  private suppressSelectionUntil = 0;
  private disposed = false;

  private readonly handleSelection = (): void => { this.emitSelection(); };
  private selectedFeatureIds(): string[] {
    return this.selection.getFeatures().getArray()
      .map((feature) => feature.getId())
      .filter((id): id is string => typeof id === "string");
  }
  private emitSelection(): void {
    const ids = this.selectedFeatureIds();
    for (const listener of this.selectFeaturesListeners) listener(ids);
    for (const listener of this.selectListeners) listener(ids[0] ?? null);
  }
  private selectableFeature(feature: Feature): boolean {
    const featureType = feature.get("featureType") as RealmFeature["featureType"] | undefined;
    const properties = feature.get("properties") as Record<string, unknown> | undefined;
    return properties?.locked !== true && (featureType === undefined || !this.hiddenFeatureTypes.has(featureType));
  }
  private featureSnapshots(): Pick<RealmFeature, "id" | "geometry">[] {
    const snapshots: Pick<RealmFeature, "id" | "geometry">[] = [];
    for (const feature of this.featureSource.getFeatures()) {
      const id = feature.getId();
      const geometry = feature.getGeometry();
      if (typeof id !== "string" || !geometry || !this.selectableFeature(feature)) continue;
      try { snapshots.push({ id, geometry: guardedGeometryToGeoJson(geometry) }); } catch { /* invalid transient geometry is not selectable */ }
    }
    return snapshots;
  }

  private readonly handleModify = (event: { features: { getArray(): Feature[] } }): void => {
    const changes: FeatureGeometryChange[] = [];
    for (const feature of event.features.getArray()) {
      const id = feature.getId();
      const geometry = feature.getGeometry();
      if (typeof id !== "string" || !geometry || !this.selectableFeature(feature)) continue;
      let encoded: GeoJsonGeometry;
      try { encoded = guardedGeometryToGeoJson(geometry); } catch { continue; }
      changes.push({ id, geometry: encoded });
      for (const listener of this.modifyListeners) listener(id, encoded);
    }
    if (changes.length > 0) for (const listener of this.modifyFeaturesListeners) listener(changes);
  };

  private emitErase(featureIds: readonly string[]): void {
    const valid = [...new Set(featureIds)].filter((id) => {
      const feature = this.featureSource.getFeatureById(id);
      return feature instanceof Feature && this.selectableFeature(feature);
    });
    if (valid.length === 0) return;
    for (const listener of this.eraseFeaturesListeners) listener(valid);
    for (const id of valid) for (const listener of this.eraseListeners) listener(id);
  }

  constructor({ target }: MapAdapterOptions) {
    this.target = target;
    this.terrainOutlineAnimator = new TerrainOutlineAnimator(target.ownerDocument.defaultView, (segments, phase) => {
      this.terrainOutlineSource.clear();
      if (segments.length > 0) this.terrainOutlineSource.addFeature(new Feature({ geometry: new MultiLineString(segments) }));
      // Keep transition and completed boundaries mutually exclusive so the
      // visible layer cannot lag behind the optimistic cell state.
      this.terrainOutlineLayer.setVisible(phase === "transition");
      this.terrainSmoothLayer.setVisible(phase === "complete");
    });
    this.cellRegion = new CellRegionController(target.ownerDocument.defaultView, (feature) => this.featureStyle(feature));
    this.target.style.background = mapTheme(this.activeThemeId).canvas;
    this.graticule = createGraticule(this.gridOptions);

    this.featureLayer = new VectorLayer({ source: this.featureSource, style: this.featureStyle });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: this.cellStyle, visible: true });
    this.terrainOutlineLayer = new VectorLayer({
      source: this.terrainOutlineSource,
      style: () => new Style({ stroke: new Stroke({ color: mapTheme(this.activeThemeId, this.themeOverrides).landInk, width: 1.6 }) }),
      visible: false,
      zIndex: 7,
    });
    this.terrainSmoothLayer = new VectorLayer({ source: this.terrainSmoothSource, style: () => new Style({ stroke: new Stroke({ color: mapTheme(this.activeThemeId, this.themeOverrides).landInk, width: 1.8, lineJoin: "round", lineCap: "round" }) }), visible: false, zIndex: 8 });
    this.regionSmoothLayer = new VectorLayer({ source: this.regionSmoothSource, style: (feature) => { const color = String(feature.get("regionColor")); return new Style({ fill: new Fill({ color: colorWithOpacity(color, 0.2) }), stroke: new Stroke({ color: colorWithOpacity(color, 0.78), width: 1.1, lineJoin: "round", lineCap: "round" }) }); }, zIndex: 6 });
    this.cellGridSource.addFeature(new Feature({ geometry: new MultiLineString(this.fixedCellGridLines) }));
    this.cellGridLayer = new VectorLayer({
      source: this.cellGridSource,
      style: new Style({ stroke: this.cellGridStroke }),
      visible: false,
      zIndex: 4,
    });
    this.terrainCellGridLayer = new VectorLayer({
      source: this.terrainCellGridSource,
      style: new Style({ stroke: this.terrainCellGridStroke }),
      visible: false,
      zIndex: 4,
    });
    this.selection = new SelectModule.default({
      layers: [this.featureLayer],
      multi: true,
      condition: (event) => Date.now() >= this.suppressSelectionUntil && singleClick(event),
      filter: (feature) => this.selectableFeature(feature),
    });
    this.modify = new Modify({ features: this.selection.getFeatures() });
    this.translate = new Translate({ features: this.selection.getFeatures() });
    this.lasso = new PointerInteraction({
      handleDownEvent: (event) => {
        const pointer = event.originalEvent as PointerEvent;
        if (this.activeMode !== "pan" || !pointer.isPrimary || pointer.button !== 0 || !(pointer.shiftKey || pointer.altKey || pointer.metaKey || pointer.ctrlKey)) return false;
        this.lassoPoints = [[...(event.coordinate as Position)] as Position];
        this.lassoAdditive = pointer.shiftKey || pointer.metaKey || pointer.ctrlKey;
        return true;
      },
      handleDragEvent: (event) => {
        const point = event.coordinate as Position;
        const previous = this.lassoPoints[this.lassoPoints.length - 1];
        if ((!previous || previous[0] !== point[0] || previous[1] !== point[1]) && this.lassoPoints.length < MAX_LASSO_POINTS) this.lassoPoints.push([...(point)] as Position);
      },
      handleUpEvent: (event) => {
        const point = event.coordinate as Position;
        const previous = this.lassoPoints[this.lassoPoints.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
          if (this.lassoPoints.length < MAX_LASSO_POINTS) this.lassoPoints.push([...(point)] as Position);
          else this.lassoPoints[this.lassoPoints.length - 1] = [...point] as Position;
        }
        const completedLasso = this.lassoPoints.length >= 3;
        const candidates = completedLasso
          ? selectFeatureIdsWithinLasso(this.featureSnapshots(), this.lassoPoints)
          : [];
        if (completedLasso) {
          const current = this.selectedFeatureIds();
          const next = this.lassoAdditive ? [...new Set([...current, ...candidates])] : candidates;
          this.setSelectedFeatures(next);
          this.emitSelection();
        }
        this.lassoPoints = [];
        this.lassoAdditive = false;
        if (completedLasso) this.suppressSelectionUntil = Date.now() + 350;
        return false;
      },
      // Consume the pointer-down so Translate/Modify cannot treat a lasso
      // starting on a selected feature as a move. The selection interaction receives the later
      // singleclick event independently, so Shift-click still toggles.
      stopDown: () => true,
    });

    this.map = new Map({
      target,
      layers: [this.graticule, this.featureLayer, this.cellLayer, this.gridLayer, this.cellGridLayer, this.terrainCellGridLayer, this.terrainOutlineLayer, this.regionSmoothLayer, this.terrainSmoothLayer],
      view: new View({
        projection: "EPSG:4326",
        center: [0, 0],
        zoom: 1,
        minZoom: -1,
        maxZoom: 8,
        extent: [...this.worldExtent],
        showFullExtent: true,
        enableRotation: false,
      }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false, mouseWheelZoom: false }).extend([
        // Settle each wheel gesture on one relative zoom level instead of
        // stopping between the renderer's 1–8 levels.
        new MouseWheelZoom({ constrainResolution: true }),
        this.middleDragPan,
      ]),
    });
    this.map.addInteraction(this.selection);
    this.map.addInteraction(this.modify);
    this.map.addInteraction(this.translate);
    // Added last so reverse interaction dispatch lets lasso consume modified
    // pointer sequences before Select/Modify/Translate see the same gesture.
    this.map.addInteraction(this.lasso);
    this.target.addEventListener("keydown", this.handleKeyDown);
    this.target.addEventListener("keyup", this.handleKeyUp);
    this.target.addEventListener("contextmenu", this.handleContextMenu);
    this.target.addEventListener("pointerleave", this.handlePointerLeave);
    this.target.ownerDocument.defaultView?.addEventListener("pointerup", this.handleExternalPointerUp);
    this.target.ownerDocument.defaultView?.addEventListener("blur", this.handlePointerCancel);
    this.map.on(["pointermove"], this.handlePointerMove);
    this.map.getViewport().addEventListener("pointercancel", this.handlePointerCancel);
    this.map.getViewport().addEventListener("lostpointercapture", this.handlePointerCancel);
    this.selection.on("select", this.handleSelection);
    this.modify.on("modifyend", this.handleModify);
    this.translate.on("translateend", this.handleModify);
    this.rebaseZoom();
  }

  getZoom(): number {
    const internalZoom = this.map.getView().getZoom();
    return Math.min(8, Math.max(1, (internalZoom ?? this.baseZoom + 1) - this.baseZoom));
  }

  setZoom(zoom: number): void {
    const relativeZoom = Math.min(8, Math.max(1, zoom));
    this.map.getView().setZoom(this.baseZoom + relativeZoom);
  }

  resetView(): void {
    const view = this.map.getView();
    view.setCenter([0, 0]);
    this.setZoom(1);
  }

  setFeatures(features: RealmFeature[]): void {
    const selectedIds = this.selectedFeatureIds();
    const desiredIds = new Set(features.map((feature) => feature.id));
    for (const rendered of this.featureSource.getFeatures()) {
      const id = rendered.getId();
      if (typeof id !== "string" || !desiredIds.has(id)) this.featureSource.removeFeature(rendered);
    }
    const additions: Feature[] = [];
    for (const snapshot of features) {
      const snapshotKey = JSON.stringify([snapshot.featureType, snapshot.name, snapshot.geometry, snapshot.properties ?? {}]);
      const found = this.featureSource.getFeatureById(snapshot.id);
      const rendered = Array.isArray(found) ? found[0] : found;
      if (rendered) {
        if (rendered.get("snapshotKey") === snapshotKey) continue;
        rendered.setGeometry(guardedGeometryFromGeoJson(snapshot.geometry));
        rendered.set("featureType", snapshot.featureType, true);
        rendered.set("name", snapshot.name, true);
        rendered.set("properties", snapshot.properties ?? {}, true);
        rendered.set("snapshotKey", snapshotKey, true);
        rendered.changed();
        continue;
      }
      const created = new Feature({ geometry: guardedGeometryFromGeoJson(snapshot.geometry), featureType: snapshot.featureType, name: snapshot.name, properties: snapshot.properties ?? {}, snapshotKey });
      created.setId(snapshot.id);
      additions.push(created);
    }
    if (additions.length > 0) this.featureSource.addFeatures(additions);
    this.setSelectedFeatures(selectedIds);
  }

  setTheme(themeId: MapThemeId): void {
    this.activeThemeId = themeId;
    this.target.style.background = mapTheme(themeId, this.themeOverrides).canvas;
    this.target.dataset.mapTheme = themeId;
    this.featureLayer.changed();
    this.cellLayer.changed();
    this.terrainOutlineLayer.changed();
    this.terrainSmoothLayer.changed();
  }

  setThemeOverrides(overrides: ThemeOverrides): void {
    this.themeOverrides = validateThemeOverrides(overrides);
    this.target.style.background = mapTheme(this.activeThemeId, this.themeOverrides).canvas;
    this.featureLayer.changed();
    this.cellLayer.changed();
    this.terrainOutlineLayer.changed();
    this.terrainSmoothLayer.changed();
    // GridOptions.color is an independent explicit setting and is intentionally
    // not replaced by a theme override.
    this.graticule.changed();
    this.gridLayer.changed();
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.graticule.setVisible(visible && this.gridOptions.kind === "graticule");
    this.gridLayer.setVisible(visible && this.gridOptions.kind !== "graticule");
  }

  setGridOptions(options: GridOptions): void {
    if (options.kind !== "graticule" && options.kind !== "square" && options.kind !== "hex") throw new Error("Grid kind must be graticule, square, or hex.");
    if (!/^#[\da-f]{6}$/i.test(options.color)) throw new Error("Grid color must be a #RRGGBB value.");
    if (!Number.isFinite(options.width) || options.width < 0.25 || options.width > 4) throw new Error("Grid width must be between 0.25 and 4.");
    if (!Number.isFinite(options.spacingDegrees) || options.spacingDegrees < 2 || options.spacingDegrees > 45) throw new Error("Grid spacing must be between 2 and 45 degrees.");
    this.gridOptions = { ...options };
    this.gridStroke.setColor(options.color);
    this.gridStroke.setWidth(options.width);
    this.gridSource.clear();
    if (options.kind === "square") this.gridSource.addFeatures(boundedSquareGrid(options.spacingDegrees));
    if (options.kind === "hex") this.gridSource.addFeatures(boundedHexGrid(options.spacingDegrees));
    this.gridLayer.changed();
    if (options.kind === "graticule") {
      const previous = this.graticule;
      this.graticule = createGraticule(options);
      this.map.removeLayer(previous);
      this.map.getLayers().insertAt(0, this.graticule);
      previous.dispose();
    }
    this.setGridVisible(this.gridVisible);
  }

  setCellGridVisible(visible: boolean): void {
    this.cellGridLayer.setVisible(visible);
    this.terrainCellGridLayer.setVisible(visible);
  }

  setCellGridOptions(options: CellGridOptions): void {
    if (!/^#[\da-f]{6}$/i.test(options.color)) throw new Error("Cell grid color must be a #RRGGBB value.");
    if (!Number.isFinite(options.width) || options.width < 0.25 || options.width > 4) throw new Error("Cell grid width must be between 0.25 and 4.");
    this.cellGridStroke.setColor(colorWithOpacity(options.color, OUTSIDE_GRID_OPACITY));
    this.cellGridStroke.setWidth(options.width);
    this.terrainCellGridStroke.setColor(colorWithOpacity(options.color, INSIDE_GRID_OPACITY));
    this.terrainCellGridStroke.setWidth(options.width);
    this.cellGridLayer.changed();
    this.terrainCellGridLayer.changed();
  }

  setAssets(assetUrls: Readonly<Record<string, string>>): void {
    this.assetUrls = { ...assetUrls };
    this.featureLayer.changed();
  }

  setLayerVisibility(featureType: RealmFeature["featureType"], visible: boolean): void {
    if (visible) this.hiddenFeatureTypes.delete(featureType);
    else this.hiddenFeatureTypes.add(featureType);
    this.setSelectedFeatures(this.selectedFeatureIds());
    this.featureLayer.changed();
  }

  setDrawingOptions(options: DrawingOptions): void {
    if (options.gesture !== "freehand" && options.gesture !== "vertices") {
      throw new DrawingGeometryError("drawing_gesture");
    }
    if (!Number.isInteger(options.smoothingPasses) || options.smoothingPasses < 0 || options.smoothingPasses > MAX_SMOOTHING_PASSES) {
      throw new DrawingGeometryError("drawing_smoothing");
    }
    if (options.snapAngleDegrees !== null && (!Number.isFinite(options.snapAngleDegrees) || options.snapAngleDegrees <= 0 || options.snapAngleDegrees > 360)) {
      throw new DrawingGeometryError("drawing_angle");
    }
    this.drawingGesture = options.gesture;
    this.drawingSmoothingPasses = options.smoothingPasses;
    this.drawingSnapAngleDegrees = options.snapAngleDegrees;
    if (this.draw) this.draw.setFreehand(this.drawTypeUsesFreehand(this.activeMode));
  }

  private drawTypeUsesFreehand(mode: RealmMapMode): boolean {
    return mode !== "pan" && mode !== "cell-select" && mode !== "cell-region" && mode !== "cell-erase" && mode !== "erase"
      && drawTypeForMode(mode) !== "Point" && this.drawingGesture === "freehand";
  }

  setMode(mode: RealmMapMode): void {
    this.temporaryPan = false;
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    if (this.paint) {
      this.map.removeInteraction(this.paint);
      this.paint.dispose();
      this.paint = null;
      this.paintLastPoint = null;
      this.paintStrokeSelection.clear();
      this.paintSelectionBeforeStroke = [];
    }
    if (this.eraser) {
      this.map.removeInteraction(this.eraser);
      this.eraser.dispose();
      this.eraser = null;
    }
    if (this.grab) {
      this.map.removeInteraction(this.grab.interaction);
      this.grab.dispose();
      this.grab = null;
    }
    this.lassoPoints = [];
    const isCellMode = mode === "cell-select" || mode === "cell-erase";
    const wasCellMode = this.activeMode === "cell-select" || this.activeMode === "cell-erase";
    if ((!isCellMode || mode !== this.activeMode) && wasCellMode) this.setSelectedCells([]);
    this.setHoveredCells([]);
    this.activeMode = mode;
    this.modify.setActive(mode === "pan");
    this.translate.setActive(mode === "pan");
    this.selection.setActive(mode === "pan");
    this.lasso.setActive(mode === "pan");
    this.cellLayer.setVisible(true);
    this.setNavigationActive(mode === "pan");
    this.refreshHoveredCells();
    if (mode === "erase") {
      this.setSelected(null);
      this.eraser = new PointerInteraction({
        handleDownEvent: (event) => {
          const id = this.map.forEachFeatureAtPixel(event.pixel, (feature) => this.selectableFeature(feature as Feature) ? feature.getId() : undefined, {
            layerFilter: (layer) => layer === this.featureLayer,
            hitTolerance: 8,
          });
          if (typeof id === "string") this.emitErase([id]);
          return false;
        },
      });
      this.map.addInteraction(this.eraser);
      return;
    }
    if (isCellMode) {
      this.setSelected(null);
      this.paint = new CancelablePointerInteraction({
        handleDownEvent: (event) => {
          const pointer = event.originalEvent as PointerEvent;
          if (!pointer.isPrimary || pointer.button !== 0) return false;
          const point = event.coordinate as [number, number];
          if (!this.positionWithinWorld(point)) return false;
          this.paintSelectionBeforeStroke = [...this.selectedCellIds];
          this.paintLastPoint = point;
          this.paintStrokeSelection = new Set(gridCellIdsWithinPaintPosition(this.paintLastPoint, this.paintRadiusForEvent(event.originalEvent)));
          this.setSelectedCells([...this.paintStrokeSelection]);
          return true;
        },
        handleDragEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.positionWithinWorld(nextPoint)) return;
          if (!this.paintLastPoint) this.paintLastPoint = nextPoint;
          for (const id of gridCellIdsWithinPaintPosition(nextPoint, this.paintRadiusForEvent(event.originalEvent))) this.paintStrokeSelection.add(id);
          this.paintLastPoint = nextPoint;
          this.setSelectedCells([...this.paintStrokeSelection]);
        },
        handleUpEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.positionWithinWorld(nextPoint)) {
            this.finishPaintStroke();
            return false;
          }
          if (!this.paintLastPoint) this.paintLastPoint = nextPoint;
          for (const id of gridCellIdsWithinPaintPath([this.paintLastPoint, nextPoint], this.paintRadiusForEvent(event.originalEvent))) this.paintStrokeSelection.add(id);
          this.finishPaintStroke();
          return false;
        },
      });
      this.map.addInteraction(this.paint);
      return;
    }
    if (mode === "pan") return;
    if (mode === "cell-region") {
      this.draw = this.cellRegion.createDraw(
        (cellIds) => { for (const listener of this.cellSelectListeners) listener(cellIds); },
        (code) => { for (const listener of this.errorListeners) listener(code); },
      );
      this.map.addInteraction(this.draw);
      return;
    }
    if (mode === "grab") {
      this.setSelected(null);
      this.grab = new RegionGrabController({
        cellAt: (position) => this.cellAtCoordinate(position), attributes: () => this.cellAttributesById,
        getFeature: (id) => this.getCellFeature(id), ensureFeatures: (ids) => this.ensureCells(ids), removeUnused: (id) => this.removeUnusedCell(id),
        changed: () => this.cellLayer.changed(), setRegionSmoothVisible: (visible) => this.regionSmoothLayer.setVisible(visible),
        emit: (input) => { for (const listener of this.regionMoveListeners) listener(input); },
      });
      this.map.addInteraction(this.grab.interaction);
      return;
    }
    const drawType = drawTypeForMode(mode);
    const drawingFeatureType = mode === "polygon-hole" ? "terrain" : mode === "label-path" ? "boundary" : mode;
    this.draw = new Draw({ type: drawType, style: this.featureStyle(new Feature({ featureType: drawingFeatureType, name: "", properties: {} })) });
    // Lines and areas follow the pointer continuously from press to release.
    // Point features remain a single click because they have no path to trace.
    this.draw.setFreehand(this.drawTypeUsesFreehand(mode));
    this.draw.on("drawend", (event) => {
      const geometry = event.feature.getGeometry();
      if (!geometry) return;
      let encoded: GeoJsonGeometry;
      try {
        const raw = guardedGeometryToGeoJson(geometry);
        const refined = refineDrawnGeometry(
          drawingFeatureType,
          raw,
          this.map.getView().getResolution() ?? 1,
          this.drawingSmoothingPasses === undefined ? undefined : { smoothingPasses: this.drawingSmoothingPasses },
        );
        const shaped = this.modifierStraighten ? straightenLine(refined) : refined;
        const snapAngle = this.drawingSnapAngleDegrees ?? this.modifierSnapAngleDegrees;
        encoded = snapAngle === null ? shaped : snapFinalGeometry(shaped, snapAngle);
      } catch (cause) {
        const code = mapErrorCode(cause);
        for (const listener of this.errorListeners) listener(code);
        return;
      }
      for (const listener of this.drawListeners) listener(encoded);
    });
    this.map.addInteraction(this.draw);
  }

  private nudgeSelectedFeatures(offset: Position): boolean {
    const changes: FeatureGeometryChange[] = [];
    for (const feature of this.selection.getFeatures().getArray()) {
      const id = feature.getId();
      const geometry = feature.getGeometry();
      if (typeof id !== "string" || !geometry || !this.selectableFeature(feature)) continue;
      try {
        const nextGeometry = nudgeGeometry(guardedGeometryToGeoJson(geometry), offset);
        assertGeometryWithinWorld(nextGeometry);
        changes.push({ id, geometry: nextGeometry });
      } catch {
        for (const listener of this.errorListeners) listener("feature_outside_world");
        return false;
      }
    }
    if (changes.length === 0) return false;
    for (const change of changes) {
      const feature = this.featureSource.getFeatureById(change.id);
      if (!(feature instanceof Feature)) continue;
      try { feature.setGeometry(guardedGeometryFromGeoJson(change.geometry)); } catch { return false; }
    }
    for (const change of changes) for (const listener of this.modifyListeners) listener(change.id, change.geometry);
    for (const listener of this.modifyFeaturesListeners) listener(changes);
    return true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.modifierSnapAngleDegrees = event.altKey && event.shiftKey ? 45 : null;
    this.modifierStraighten = event.altKey && !event.shiftKey;
    if ((event.metaKey || event.ctrlKey) && event.key === "0") {
      this.resetView();
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "1") {
      this.setZoom(1);
      event.preventDefault();
      return;
    }
    if (event.code === "Space" && this.activeMode !== "pan" && !this.temporaryPan) {
      this.cancelPaintStroke();
      this.temporaryPan = true;
      this.draw?.setActive(false);
      this.paint?.setActive(false);
      this.grab?.interaction.setActive(false);
      this.setNavigationActive(true);
      event.preventDefault();
      return;
    }
    if (this.activeMode === "pan" && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && this.selectedFeatureIds().length > 0) {
      for (const listener of this.layerShiftListeners) listener(event.key === "ArrowUp" ? 1 : -1);
      event.preventDefault();
      return;
    }
    if (this.activeMode === "pan" && !event.shiftKey && !event.metaKey && !event.ctrlKey
      && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")
      && this.selectedFeatureIds().length > 0) {
      const distance = event.altKey ? 0.05 : 0.25;
      const offset: Position = event.key === "ArrowLeft" ? [-distance, 0]
        : event.key === "ArrowRight" ? [distance, 0]
          : event.key === "ArrowUp" ? [0, distance] : [0, -distance];
      this.nudgeSelectedFeatures(offset);
      event.preventDefault();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.activeMode === "pan") {
      this.emitErase(this.selectedFeatureIds());
      event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    if (this.draw) {
      this.draw.abortDrawing();
      event.preventDefault();
      return;
    }
    if (this.activeMode === "grab") {
      this.grab?.cancel();
      event.preventDefault();
      return;
    }
    if (this.activeMode === "pan") {
      this.lassoPoints = [];
      this.lassoAdditive = false;
      this.setSelectedFeatures([]);
      this.emitSelection();
      event.preventDefault();
      return;
    }
    if (this.activeMode !== "cell-select" && this.activeMode !== "cell-erase") return;
    this.cancelPaintStroke(false);
    this.setSelectedCells([]);
    for (const listener of this.cellSelectListeners) listener([]);
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!(event.altKey && event.shiftKey)) this.modifierSnapAngleDegrees = null;
    if (!event.altKey) this.modifierStraighten = false;
    if (event.code !== "Space" || !this.temporaryPan) return;
    this.temporaryPan = false;
    this.setNavigationActive(false);
    this.draw?.setActive(true);
    this.paint?.setActive(true);
    this.grab?.interaction.setActive(true);
    this.refreshHoveredCells();
    event.preventDefault();
  };

  private readonly handlePointerCancel = (): void => {
    if (this.draw) this.draw.abortDrawing();
    this.lassoPoints = [];
    this.lassoAdditive = false;
    this.cancelPaintStroke();
    this.grab?.cancel();
  };

  private readonly handleExternalPointerUp = (event: PointerEvent): void => {
    const ownerWindow = this.target.ownerDocument.defaultView;
    if (ownerWindow && event.target instanceof ownerWindow.Node && this.target.contains(event.target)) return;
    // Pointer capture can be lost when a stroke crosses the canvas edge. Commit
    // the cells already visited instead of restoring the pre-stroke selection;
    // pointercancel/blur remain the explicit cancellation paths.
    if (this.paintLastPoint !== null) {
      this.finishPaintStroke();
      return;
    }
    this.handlePointerCancel();
  };

  private finishPaintStroke(): void {
    if (this.paintLastPoint === null) return;
    const selected = [...this.paintStrokeSelection];
    this.paint?.cancelSequence();
    this.paintLastPoint = null;
    this.paintStrokeSelection.clear();
    this.paintSelectionBeforeStroke = [];
    // Clear the in-stroke fill before publishing the completed outline. Reset
    // the gesture state first so a re-entrant React update cannot restore it.
    this.setSelectedCells([]);
    for (const listener of this.cellSelectListeners) listener([...selected]);
    this.refreshHoveredCells();
  }
  private cancelPaintStroke(restoreSelection = true): void {
    const hadStroke = this.paintLastPoint !== null;
    this.paint?.cancelSequence();
    this.paintLastPoint = null;
    this.paintStrokeSelection.clear();
    if (hadStroke && restoreSelection) this.setSelectedCells(this.paintSelectionBeforeStroke);
    this.paintSelectionBeforeStroke = [];
  }

  private readonly handlePointerMove = (event: Event | BaseEvent): void => {
    if (!("coordinate" in event) || !Array.isArray(event.coordinate)) {
      this.lastPointerCoordinate = null;
      this.pointerInside = false;
      this.setHoveredCells([]);
      return;
    }
    const [longitude, latitude] = event.coordinate;
    if (longitude === undefined || latitude === undefined || !this.positionWithinWorld([longitude, latitude])) {
      this.lastPointerCoordinate = null;
      this.pointerInside = false;
      this.setHoveredCells([]);
      return;
    }
    this.lastPointerCoordinate = [longitude, latitude];
    this.pointerInside = true;
    if ((this.activeMode !== "cell-select" && this.activeMode !== "cell-erase") || this.temporaryPan || this.paintLastPoint) {
      this.setHoveredCells([]);
      return;
    }
    this.refreshHoveredCells();
  };

  private readonly handlePointerLeave = (): void => {
    // Keep an active paint stroke alive while the pointer crosses the canvas
    // boundary. The external pointerup handler commits the visited cells.
    this.lastPointerCoordinate = null;
    this.pointerInside = false;
    this.setHoveredCells([]);
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    const hadGesture = Boolean(this.draw) || this.lassoPoints.length > 0;
    if (this.draw) {
      const vertexDrawing = this.drawingGesture === "vertices"
        && this.activeMode !== "pan" && this.activeMode !== "cell-select" && this.activeMode !== "cell-region" && this.activeMode !== "cell-erase" && this.activeMode !== "erase"
        && drawTypeForMode(this.activeMode) !== "Point";
      if (vertexDrawing) this.draw.finishDrawing();
      else this.draw.abortDrawing();
    }
    if (this.lassoPoints.length > 0) {
      this.lassoPoints = [];
      this.lassoAdditive = false;
    }
    if (hadGesture) event.preventDefault();
  };

  private setNavigationActive(active: boolean): void {
    for (const interaction of this.map.getInteractions().getArray()) {
      if ((interaction instanceof DragPan && interaction !== this.middleDragPan) || interaction instanceof KeyboardPan) interaction.setActive(active);
    }
  }

  private paintRadiusForMode(): number {
    return this.activeMode === "cell-erase" ? this.cellEraseRadius : this.cellPaintRadius;
  }

  private positionWithinWorld(position: readonly [number, number]): boolean {
    return Number.isFinite(position[0]) && Number.isFinite(position[1])
      && position[0] >= this.worldExtent[0] && position[0] <= this.worldExtent[2]
      && position[1] >= this.worldExtent[1] && position[1] <= this.worldExtent[3];
  }

  private paintRadiusForEvent(originalEvent: Event): number {
    const radius = this.paintRadiusForMode();
    if (typeof PointerEvent !== "undefined" && originalEvent instanceof PointerEvent && originalEvent.pointerType === "pen" && originalEvent.pressure > 0) {
      return radius * (0.45 + originalEvent.pressure * 0.9);
    }
    return radius;
  }

  setCellPaintRadius(radiusCells: number): void {
    if (!Number.isFinite(radiusCells)) return;
    this.cellPaintRadius = Math.max(0, Math.min(32, radiusCells));
    this.refreshHoveredCells();
  }

  setCellEraseRadius(radiusCells: number): void {
    if (!Number.isFinite(radiusCells)) return;
    this.cellEraseRadius = Math.max(0, Math.min(32, radiusCells));
    this.refreshHoveredCells();
  }

  setCellRegionColor(color: string): void { this.cellRegion.setColor(color, this.activeMode === "cell-region" ? this.draw : null); }
  private cellAtCoordinate(position: Position): string | null { return gridCellIdsWithinPaintPosition(position, 0)[0] ?? null; }
  private setHoveredCells(cellIds: readonly string[]): void {
    const next = new Set(this.validCellIds(cellIds));
    const previous = this.hoveredCellIds;
    const erasing = this.activeMode === "cell-erase";
    this.hoveredCellIds = next;
    for (const id of previous) {
      if (!next.has(id)) {
        const feature = this.getCellFeature(id);
        feature?.set("preview", false, true);
        feature?.set("erasePreview", false, true);
        this.removeUnusedCell(id);
      }
    }
    this.ensureCells(next);
    for (const id of next) {
      const feature = this.getCellFeature(id);
      feature?.set("preview", !erasing, true);
      feature?.set("erasePreview", erasing, true);
    }
    this.cellLayer.changed();
  }

  private refreshHoveredCells(): void {
    if (!this.pointerInside || !this.lastPointerCoordinate
      || (this.activeMode !== "cell-select" && this.activeMode !== "cell-erase")
      || this.temporaryPan || this.paintLastPoint) {
      this.setHoveredCells([]);
      return;
    }
    this.setHoveredCells(gridCellIdsWithinPaintPosition(this.lastPointerCoordinate, this.paintRadiusForMode()));
  }

  private ensureCells(cellIds: Iterable<string>): void {
    const features: Feature[] = [];
    for (const id of cellIds) {
      if (this.cellFeatures.has(id) || !parseCellId(id)) continue;
      const [row, column] = parseCellId(id)!;
      const ring = gridCellPolygon(row, column);
      if (!ring) continue;
      const feature = new Feature({ geometry: new Polygon([ring]), selected: false, attributes: this.cellAttributesById.get(id) ?? [] });
      feature.setId(id);
      this.cellFeatures.set(id, feature);
      features.push(feature);
    }
    if (features.length > 0) this.cellSource.addFeatures(features);
  }

  private getCellFeature(id: string): Feature | undefined {
    return this.cellFeatures.get(id);
  }

  private removeUnusedCell(id: string): void {
    if (this.selectedCellIds.has(id) || this.hoveredCellIds.has(id) || this.cellAttributesById.has(id)) return;
    const feature = this.cellFeatures.get(id);
    if (!feature) return;
    this.cellSource.removeFeature(feature);
    this.cellFeatures.delete(id);
  }

  private syncSelectedCellFlags(): void {
    const erasing = this.activeMode === "cell-erase";
    for (const [id, feature] of [...this.cellFeatures]) {
      const selected = this.selectedCellIds.has(id);
      feature.set("selected", selected && !erasing, true);
      feature.set("erasePreview", selected && erasing, true); feature.set("paintPreview", selected && !erasing, true);
      if (!selected) this.removeUnusedCell(id);
    }
  }

  private validCellIds(cellIds: readonly string[]): string[] {
    return cellIds.filter((id) => parseCellId(id) !== null);
  }

  setSelected(featureId: string | null): void {
    this.setSelectedFeatures(featureId ? [featureId] : []);
  }

  setSelectedFeatures(featureIds: readonly string[]): void {
    const requested = [...new Set(featureIds)];
    const next = requested
      .map((id) => this.featureSource.getFeatureById(id))
      .filter((feature): feature is Feature => feature instanceof Feature && this.selectableFeature(feature));
    const current = this.selection.getFeatures().getArray();
    if (current.length === next.length && current.every((feature, index) => feature === next[index])) return;
    this.selection.getFeatures().clear();
    this.selection.getFeatures().extend(next);
  }

  setSelectedCells(cellIds: readonly string[]): void {
    const validIds = this.validCellIds(cellIds);
    this.ensureCells(validIds);
    const next = new Set(validIds);
    this.selectedCellIds = next;
    this.syncSelectedCellFlags();
    this.cellLayer.changed();
  }

  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void {
    const previous = this.cellAttributesById;
    const byCell = new globalThis.Map<string, CellAttributeSnapshot[]>();
    for (const attribute of attributes) {
      if (parseCellId(attribute.cellId) === null) continue;
      const current = byCell.get(attribute.cellId) ?? [];
      current.push(attribute);
      byCell.set(attribute.cellId, current);
    }
    const terrainCellIds = [...byCell.entries()]
      .filter(([, values]) => values.some(({ attribute }) => attribute === "terrain"))
      .map(([id]) => id);
    const terrainSet = new Set(terrainCellIds);
    const renderedByCell = new globalThis.Map<string, CellAttributeSnapshot[]>();
    for (const [id, values] of byCell) renderedByCell.set(id, terrainSet.has(id) ? values : values.filter(({ attribute }) => attribute !== "region"));
    this.ensureCells(byCell.keys());
    const changedIds = new Set([...this.cellAttributesById.keys(), ...byCell.keys()]);
    for (const id of changedIds) {
      const next = renderedByCell.get(id) ?? [];
      const feature = this.getCellFeature(id);
      if (feature) feature.set("attributes", next, true);
    }
    this.cellAttributesById = byCell;
    for (const id of changedIds) this.removeUnusedCell(id);
    // Attribute reads can arrive after a completed gesture. Normalize the
    // renderer flags at this boundary so stale selection state cannot turn a
    // persisted terrain update back into a filled cell.
    this.syncSelectedCellFlags();
    const grid = splitTerrainGridSegments(this.fixedCellGridLines, terrainCellIds);
    this.cellGridSource.clear();
    if (grid.outside.length > 0) this.cellGridSource.addFeature(new Feature({ geometry: new MultiLineString(grid.outside) }));
    this.terrainCellGridSource.clear();
    if (grid.inside.length > 0) this.terrainCellGridSource.addFeature(new Feature({ geometry: new MultiLineString(grid.inside) }));
    this.terrainOutlineAnimator.update(new Set(terrainCellIds));
    this.terrainSmoothSource.clear();
    const terrainRings = smoothCellBoundaryRings(terrainCellIds);
    if (terrainRings.length > 0) this.terrainSmoothSource.addFeature(new Feature({ geometry: new MultiLineString(terrainRings) }));
    this.regionSmoothSource.clear();
    const regionIdsByColor = new globalThis.Map<string, string[]>();
    for (const [id, values] of byCell) {
      const region = values.find(({ attribute }) => attribute === "region"); if (!region) continue;
      // Active regions are clipped to the terrain mask at the renderer
      // boundary as well. This prevents a stale/legacy region cell from
      // reappearing outside terrain while the persisted state is refreshed.
      if (!terrainSet.has(id)) continue;
      const color = /^#[\da-f]{6}$/i.test(region.value) ? region.value.toUpperCase() : mapTheme(this.activeThemeId, this.themeOverrides).region;
      const ids = regionIdsByColor.get(color) ?? []; ids.push(id); regionIdsByColor.set(color, ids);
    }
    for (const [color, ids] of regionIdsByColor) for (const component of connectedCellComponents(ids)) {
      // Smoothing a concave boundary can round a corner into the cell just
      // outside terrain. Keep components touching that mask boundary exact;
      // interior components retain the softer presentation curve.
      const touchesTerrainBoundary = component.some((id) => adjacentCellIds(id).length < 6 || adjacentCellIds(id).some((next) => !terrainSet.has(next)));
      const polygons = touchesTerrainBoundary ? exactCellBoundaryPolygons(component) : smoothCellBoundaryPolygons(component);
      for (const polygon of polygons) this.regionSmoothSource.addFeature(new Feature({ geometry: new Polygon(polygon), regionColor: color }));
    }
    this.cellRegion.animateChanges(previous, renderedByCell, (id) => this.getCellFeature(id));
    this.cellLayer.changed();
  }

  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void {
    this.drawListeners.add(listener);
    return () => this.drawListeners.delete(listener);
  }
  onSelectFeatures(listener: (featureIds: readonly string[]) => void): () => void {
    this.selectFeaturesListeners.add(listener);
    return () => this.selectFeaturesListeners.delete(listener);
  }
  onSelect(listener: (featureId: string | null) => void): () => void {
    this.selectListeners.add(listener);
    return () => this.selectListeners.delete(listener);
  }
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void {
    this.cellSelectListeners.add(listener);
    return () => this.cellSelectListeners.delete(listener);
  }
  onRegionMove(listener: (input: MoveRegionCellsInput) => void): () => void {
    this.regionMoveListeners.add(listener);
    return () => this.regionMoveListeners.delete(listener);
  }
  onModifyFeatures(listener: (changes: readonly FeatureGeometryChange[]) => void): () => void {
    this.modifyFeaturesListeners.add(listener);
    return () => this.modifyFeaturesListeners.delete(listener);
  }
  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void {
    this.modifyListeners.add(listener);
    return () => this.modifyListeners.delete(listener);
  }
  onEraseFeatures(listener: (featureIds: readonly string[]) => void): () => void {
    this.eraseFeaturesListeners.add(listener);
    return () => this.eraseFeaturesListeners.delete(listener);
  }
  onErase(listener: (featureId: string) => void): () => void {
    this.eraseListeners.add(listener);
    return () => this.eraseListeners.delete(listener);
  }
  onLayerShift(listener: (direction: -1 | 1) => void): () => void {
    this.layerShiftListeners.add(listener);
    return () => this.layerShiftListeners.delete(listener);
  }
  onError(listener: (code: MapErrorCode) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  onZoomChange(listener: (zoom: number) => void): () => void {
    const view = this.map.getView();
    let lastEmittedZoom = this.getZoom();
    const emitZoomChange = (): void => {
      const zoom = this.getZoom();
      if (Math.abs(zoom - lastEmittedZoom) <= 0.01) return;
      lastEmittedZoom = zoom;
      listener(zoom);
    };
    const onResolutionChange = () => {
      // Do not feed animation frames back through React while an interaction
      // is moving the view. The final moveend notification publishes the
      // settled relative zoom instead.
      if (!view.getAnimating()) emitZoomChange();
    };
    const onMoveEnd = () => emitZoomChange();
    view.on("change:resolution", onResolutionChange);
    this.map.on("moveend", onMoveEnd);
    return () => {
      view.un("change:resolution", onResolutionChange);
      this.map.un("moveend", onMoveEnd);
    };
  }
  updateSize(): void {
    this.map.updateSize();
    this.rebaseZoom();
  }
  async exportRaster(mimeType: "image/png" | "image/jpeg", requestedScale = 1, extent: "viewport" | "world" = "viewport", size?: ExportCanvasSize): Promise<MapRaster> {
    const [sourceWidth = 0, sourceHeight = 0] = this.map.getSize() ?? [];
    const scale = Math.max(1, Math.min(4, Math.round(requestedScale)));
    const baseWidth = size?.width ?? sourceWidth;
    const baseHeight = size?.height ?? sourceHeight;
    const quality = size?.quality ?? 0.92;
    if (!Number.isInteger(baseWidth) || !Number.isInteger(baseHeight) || baseWidth < 1 || baseHeight < 1) throw new Error("書き出しキャンバスの寸法が不正です。");
    if (!Number.isFinite(quality) || quality < 0.5 || quality > 1) throw new Error("書き出し品質は50〜100%で指定してください。");
    if (size && (baseWidth < 512 || baseWidth > 8192 || baseHeight < 512 || baseHeight > 8192)) throw new Error("書き出しキャンバスは512〜8192pxで指定してください。");
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    if (width <= 0 || height <= 0) throw new Error("地図のサイズを取得できません。");
    if (width > 16_384 || height > 16_384 || width * height > 67_108_864) throw new Error("書き出し解像度が大きすぎます。");
    const view = this.map.getView();
    const originalCenter = view.getCenter()?.slice() as [number, number] | undefined;
    const originalResolution = view.getResolution();
    const selectedFeatureIds = this.selectedFeatureIds();
    this.setSelectedFeatures([]);
    try {
      this.map.setSize([width, height]);
      if (extent === "world") view.fit([...this.worldExtent], { size: [width, height], padding: [24 * scale, 24 * scale, 24 * scale, 24 * scale] });
      else {
        if (originalResolution !== undefined) view.setResolution(originalResolution / scale);
        if (originalCenter) view.setCenter(originalCenter);
      }
      this.map.renderSync();
      const output = document.createElement("canvas");
      output.width = width;
      output.height = height;
      const context = output.getContext("2d");
      if (!context) throw new Error("地図画像を作成できません。");
      if (mimeType !== "image/png" || size?.transparent !== true) {
        context.fillStyle = mapTheme(this.activeThemeId, this.themeOverrides).canvas;
        context.fillRect(0, 0, width, height);
      }
      for (const canvas of this.target.querySelectorAll<HTMLCanvasElement>("canvas")) {
        if (canvas.width > 0 && canvas.height > 0) context.drawImage(canvas, 0, 0, width, height);
      }
      if (mimeType !== "image/png" || size?.transparent !== true) paintMapTexture(context, width, height, this.activeThemeId);
      const blob = await new Promise<Blob>((resolve, reject) => {
        output.toBlob((value) => value ? resolve(value) : reject(new Error("地図画像を作成できません。")), mimeType, quality);
      });
      return { bytes: [...new Uint8Array(await blob.arrayBuffer())], width, height };
    } finally {
      this.map.setSize([sourceWidth, sourceHeight]);
      if (originalResolution !== undefined) view.setResolution(originalResolution);
      if (originalCenter) view.setCenter(originalCenter);
      this.setSelectedFeatures(selectedFeatureIds);
      this.map.renderSync();
    }
  }

  private rebaseZoom(): void {
    const view = this.map.getView();
    const size = this.map.getSize();
    const [width = 0, height = 0] = size ?? [];
    if (width <= 0 || height <= 0) return;

    const currentRelativeZoom = this.getZoom();
    const availableSize = availableViewportSize(width, height);
    const fitResolution = resolutionForFittingExtent(this.worldExtent, availableSize);
    if (!Number.isFinite(fitResolution)) return;
    const fitZoom = view.getZoomForResolution(fitResolution);
    if (fitZoom === undefined) return;

    // UI scale 1 fits the complete editing grid in both dimensions. The
    // bounded world is never zoomed out further, so a narrow or wide viewport
    // may leave letterbox space on its secondary axis but cannot reveal extra
    // empty world beyond the fixed extent.
    this.baseZoom = fitZoom - 1;
    view.setMinZoom(this.baseZoom + 1);
    view.setMaxZoom(this.baseZoom + 8);
    view.setZoom(this.baseZoom + currentRelativeZoom);
  }

  getMap(): Map {
    return this.map;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cellRegion.dispose();
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    if (this.paint) {
      this.map.removeInteraction(this.paint);
      this.paint.dispose();
      this.paint = null;
    }
    if (this.eraser) {
      this.map.removeInteraction(this.eraser);
      this.eraser.dispose();
      this.eraser = null;
    }
    if (this.grab) {
      this.map.removeInteraction(this.grab.interaction);
      this.grab.dispose();
      this.grab = null;
    }
    this.map.removeInteraction(this.lasso);
    this.lasso.dispose();
    this.lassoPoints = [];
    this.selection.un("select", this.handleSelection);
    this.modify.un("modifyend", this.handleModify);
    this.translate.un("translateend", this.handleModify);
    this.drawListeners.clear();
    this.selectFeaturesListeners.clear();
    this.selectListeners.clear();
    this.cellSelectListeners.clear();
    this.regionMoveListeners.clear();
    this.modifyFeaturesListeners.clear();
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.target.removeEventListener("keyup", this.handleKeyUp);
    this.target.removeEventListener("contextmenu", this.handleContextMenu);
    this.target.removeEventListener("pointerleave", this.handlePointerLeave);
    this.target.ownerDocument.defaultView?.removeEventListener("pointerup", this.handleExternalPointerUp);
    this.target.ownerDocument.defaultView?.removeEventListener("blur", this.handlePointerCancel);
    this.map.un(["pointermove"], this.handlePointerMove);
    this.map.getViewport().removeEventListener("pointercancel", this.handlePointerCancel);
    this.map.getViewport().removeEventListener("lostpointercapture", this.handlePointerCancel);
    this.modifyListeners.clear();
    this.eraseFeaturesListeners.clear();
    this.eraseListeners.clear();
    this.layerShiftListeners.clear();
    this.errorListeners.clear();
    this.selection.getFeatures().clear();
    this.terrainOutlineAnimator.dispose();
    this.featureSource.clear();
    this.cellSource.clear();
    this.terrainOutlineSource.clear();
    this.map.removeLayer(this.terrainOutlineLayer);
    this.terrainSmoothSource.clear();
    this.map.removeLayer(this.terrainSmoothLayer);
    this.regionSmoothSource.clear();
    this.map.removeLayer(this.regionSmoothLayer);
    this.gridSource.clear();
    this.map.removeLayer(this.gridLayer);
    this.cellGridSource.clear();
    this.map.removeLayer(this.cellGridLayer);
    this.terrainCellGridSource.clear();
    this.map.removeLayer(this.terrainCellGridLayer);
    this.cellFeatures.clear();
    this.cellAttributesById.clear();
    this.selectedCellIds.clear();
    this.hoveredCellIds.clear();
    this.lastPointerCoordinate = null;
    this.pointerInside = false;
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
