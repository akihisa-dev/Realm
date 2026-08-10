import Feature from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Draw from "ol/interaction/Draw";
import PointerInteraction from "ol/interaction/Pointer";
import Modify from "ol/interaction/Modify";
import * as SelectModule from "ol/interaction/Select";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import type { CellAttributeSnapshot, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import { CELL_BRUSH_RADII, CELL_GRID_CELL_COUNT, CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellCenter as gridCellCenter, cellId as gridCellId, cellIdsWithinBrushPath as gridCellIdsWithinBrushPath, parseCellId } from "./gridGeometry";
import { drawTypeForMode, geometryFromGeoJson as guardedGeometryFromGeoJson, geometryToGeoJson as guardedGeometryToGeoJson } from "./geoJsonGeometry";
import { createCellStyle, createFeatureStyle, MAP_LABEL_FONT } from "./styles";
import type { MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";

export type { MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";
export type { CellBrushSize } from "./gridGeometry";
export { CELL_BRUSH_RADII, CELL_GRID_CELL_COUNT, CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellCenter, cellId, cellIdsWithinBrushPath, parseCellId } from "./gridGeometry";
export { assertGeometryWithinWorld, isGeometryWithinWorld, isPositionWithinWorld } from "./geometryGuard";

/** Owns OpenLayers objects and leaves project state in React/Rust. */
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;
  private readonly worldExtent = [-180, -90, 180, 90] as const;
  private readonly fitPadding = 24;
  private readonly featureSource = new VectorSource();
  private readonly featureLayer: VectorLayer;
  private readonly featureStyle = createFeatureStyle();
  private readonly cellSource = new VectorSource();
  private readonly cellLayer: VectorLayer;
  private readonly cellStyle = createCellStyle();
  private readonly selection: SelectModule.default;
  private readonly modify: Modify;
  private readonly target: HTMLElement;
  private draw: Draw | null = null;
  private activeMode: RealmMapMode = "pan";
  private cellBrushRadius: number = CELL_BRUSH_RADII.medium;
  private brush: PointerInteraction | null = null;
  private brushLastPoint: [number, number] | null = null;
  private brushStrokeSelection = new Set<string>();
  private brushSelectionBeforeStroke: string[] = [];
  private allCellsReady = false;
  private readonly cellFeatures = new globalThis.Map<string, Feature>();
  private cellAttributesById = new globalThis.Map<string, CellAttributeSnapshot[]>();
  private selectedCellIds = new Set<string>();
  private readonly drawListeners = new Set<(geometry: GeoJsonGeometry) => void>();
  private readonly selectListeners = new Set<(featureId: string | null) => void>();
  private readonly cellSelectListeners = new Set<(cellIds: readonly string[]) => void>();
  private readonly modifyListeners = new Set<(featureId: string, geometry: GeoJsonGeometry) => void>();
  private baseZoom = 0;
  private disposed = false;

  private readonly handleSelection = (): void => {
    const selected = this.selection.getFeatures().item(0);
    const id = selected?.getId();
    const featureId = typeof id === "string" ? id : null;
    for (const listener of this.selectListeners) listener(featureId);
  };

  private readonly handleModify = (event: { features: { getArray(): Feature[] } }): void => {
    for (const feature of event.features.getArray()) {
      const id = feature.getId();
      const geometry = feature.getGeometry();
      if (typeof id !== "string" || !geometry) continue;
      let encoded: GeoJsonGeometry;
      try { encoded = guardedGeometryToGeoJson(geometry); } catch { continue; }
      for (const listener of this.modifyListeners) listener(id, encoded);
    }
  };

  constructor({ target }: MapAdapterOptions) {
    this.target = target;
    const graticule = new Graticule({
      // Keep the world reference visible without competing with map features.
      strokeStyle: new Stroke({
        color: "rgba(104, 119, 132, 0.19)",
        lineDash: [4, 4],
        width: 1,
      }),
      showLabels: true,
      targetSize: 170,
      // Labels sit just inside the viewport edge (top and left respectively).
      lonLabelPosition: 0.96,
      latLabelPosition: 0.035,
      lonLabelStyle: new Text({
        font: MAP_LABEL_FONT,
        textBaseline: "bottom",
        fill: new Fill({ color: "rgba(68, 80, 91, 0.88)" }),
        stroke: new Stroke({ color: "rgba(255, 255, 255, 0.96)", width: 3 }),
      }),
      // OpenLayers' default `end` alignment points labels out of the viewport
      // when positioned on the left edge; start alignment keeps them unclipped.
      latLabelStyle: new Text({
        font: MAP_LABEL_FONT,
        textAlign: "start",
        textBaseline: "middle",
        fill: new Fill({ color: "rgba(68, 80, 91, 0.88)" }),
        stroke: new Stroke({ color: "rgba(255, 255, 255, 0.96)", width: 3 }),
      }),
      wrapX: false,
    });

    const referenceAxes = new VectorLayer({
      source: new VectorSource({
        features: [
          new Feature({ geometry: new LineString([[-180, 0], [180, 0]]) }),
          new Feature({ geometry: new LineString([[0, -90], [0, 90]]) }),
        ],
      }),
      style: new Style({
        stroke: new Stroke({ color: "rgba(74, 87, 98, 0.34)", width: 1 }),
      }),
    });

    this.featureLayer = new VectorLayer({ source: this.featureSource, style: this.featureStyle });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: this.cellStyle, visible: true });
    this.selection = new SelectModule.default({ layers: [this.featureLayer] });
    this.modify = new Modify({ features: this.selection.getFeatures() });

    this.map = new Map({
      target,
      layers: [graticule, referenceAxes, this.featureLayer, this.cellLayer],
      view: new View({
        projection: "EPSG:4326",
        center: [0, 0],
        zoom: 1,
        minZoom: -1,
        maxZoom: 8,
        // Scale 0 shows one additional step around the fitted world without
        // letting the viewport escape the bounded editing plane.
        extent: [-400, -220, 400, 220],
        showFullExtent: true,
        enableRotation: false,
      }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
    });
    this.map.addInteraction(this.selection);
    this.map.addInteraction(this.modify);
    this.target.addEventListener("keydown", this.handleKeyDown);
    this.map.getViewport().addEventListener("pointercancel", this.handlePointerCancel);
    this.map.getViewport().addEventListener("lostpointercapture", this.handlePointerCancel);
    this.selection.on("select", this.handleSelection);
    this.modify.on("modifyend", this.handleModify);
    this.rebaseZoom();
  }

  getZoom(): number {
    const internalZoom = this.map.getView().getZoom();
    return Math.min(8, Math.max(0, (internalZoom ?? this.baseZoom + 1) - this.baseZoom));
  }

  setZoom(zoom: number): void {
    const relativeZoom = Math.min(8, Math.max(0, zoom));
    this.map.getView().setZoom(this.baseZoom + relativeZoom);
  }

  resetView(): void {
    const view = this.map.getView();
    view.setCenter([0, 0]);
    this.setZoom(1);
  }

  setFeatures(features: RealmFeature[]): void {
    const selectedId = this.selection.getFeatures().item(0)?.getId();
    const rendered = features.map((snapshot) => {
      const feature = new Feature({
        geometry: guardedGeometryFromGeoJson(snapshot.geometry),
        featureType: snapshot.featureType,
        name: snapshot.name,
      });
      feature.setId(snapshot.id);
      return feature;
    });
    this.featureSource.clear();
    this.featureSource.addFeatures(rendered);
    this.setSelected(typeof selectedId === "string" ? selectedId : null);
  }

  setMode(mode: RealmMapMode): void {
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    if (this.brush) {
      this.map.removeInteraction(this.brush);
      this.brush.dispose();
      this.brush = null;
      this.brushLastPoint = null;
      this.brushStrokeSelection.clear();
      this.brushSelectionBeforeStroke = [];
    }
    if (mode !== "cell-select" && this.activeMode === "cell-select") this.setSelectedCells([]);
    this.activeMode = mode;
    this.modify.setActive(mode === "pan");
    this.selection.setActive(mode === "pan");
    if (mode === "cell-select") this.ensureCells();
    this.cellLayer.setVisible(true);
    for (const feature of this.cellSource.getFeatures()) feature.set("showGrid", mode === "cell-select", true);
    this.cellLayer.changed();
    this.setNavigationActive(mode === "pan");
    if (mode === "cell-select") {
      this.setSelected(null);
      this.brush = new PointerInteraction({
        handleDownEvent: (event) => {
          const pointer = event.originalEvent as PointerEvent;
          if (!pointer.isPrimary || pointer.button !== 0) return false;
          this.brushSelectionBeforeStroke = [...this.selectedCellIds];
          this.brushLastPoint = event.coordinate as [number, number];
          this.brushStrokeSelection = new Set(gridCellIdsWithinBrushPath([this.brushLastPoint], this.cellBrushRadius));
          this.setSelectedCells([...this.brushStrokeSelection]);
          return true;
        },
        handleDragEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.brushLastPoint) this.brushLastPoint = nextPoint;
          for (const id of gridCellIdsWithinBrushPath([this.brushLastPoint, nextPoint], this.cellBrushRadius)) this.brushStrokeSelection.add(id);
          this.brushLastPoint = nextPoint;
          this.setSelectedCells([...this.brushStrokeSelection]);
        },
        handleUpEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.brushLastPoint) this.brushLastPoint = nextPoint;
          for (const id of gridCellIdsWithinBrushPath([this.brushLastPoint, nextPoint], this.cellBrushRadius)) this.brushStrokeSelection.add(id);
          const selected = [...this.brushStrokeSelection];
          this.setSelectedCells(selected);
          for (const listener of this.cellSelectListeners) listener([...selected]);
          this.brushLastPoint = null;
          this.brushStrokeSelection.clear();
          this.brushSelectionBeforeStroke = [];
          return false;
        },
      });
      this.map.addInteraction(this.brush);
      return;
    }
    if (mode === "pan") return;
    const drawType = drawTypeForMode(mode);
    this.draw = new Draw({ type: drawType });
    // Lines and areas follow the pointer continuously from press to release.
    // Point features remain a single click because they have no path to trace.
    this.draw.setFreehand(drawType !== "Point");
    this.draw.on("drawend", (event) => {
      const geometry = event.feature.getGeometry();
      if (!geometry) return;
      let encoded: GeoJsonGeometry;
      try { encoded = guardedGeometryToGeoJson(geometry); } catch { return; }
      for (const listener of this.drawListeners) listener(encoded);
    });
    this.map.addInteraction(this.draw);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.activeMode !== "cell-select") return;
    this.brushLastPoint = null;
    this.brushStrokeSelection.clear();
    this.brushSelectionBeforeStroke = [];
    this.setSelectedCells([]);
    for (const listener of this.cellSelectListeners) listener([]);
    event.preventDefault();
  };

  private readonly handlePointerCancel = (): void => {
    if (this.activeMode !== "cell-select" || !this.brushLastPoint) return;
    this.brushLastPoint = null;
    this.brushStrokeSelection.clear();
    this.setSelectedCells(this.brushSelectionBeforeStroke);
    this.brushSelectionBeforeStroke = [];
  };

  private setNavigationActive(active: boolean): void {
    for (const interaction of this.map.getInteractions().getArray()) {
      if (interaction instanceof DragPan || interaction instanceof KeyboardPan) interaction.setActive(active);
    }
  }

  setCellBrushRadius(radiusCells: number): void {
    if (!Number.isFinite(radiusCells)) return;
    this.cellBrushRadius = Math.max(0.25, Math.min(32, radiusCells));
  }

  private ensureCells(cellIds?: Iterable<string>): void {
    if (!cellIds && this.allCellsReady) return;
    const features: Feature[] = [];
    const ids = cellIds ?? (function* allCellIds() {
      for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
        for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) yield gridCellId(row, column);
      }
    }());
    for (const id of ids) {
      if (this.cellFeatures.has(id) || !parseCellId(id)) continue;
      const [row, column] = parseCellId(id)!;
      const feature = new Feature({ geometry: new Point(gridCellCenter(row, column)), selected: false, showGrid: false, attributes: this.cellAttributesById.get(id) ?? [] });
      feature.setId(id);
      this.cellFeatures.set(id, feature);
      features.push(feature);
    }
    if (features.length > 0) this.cellSource.addFeatures(features);
    if (!cellIds) {
      this.allCellsReady = true;
      if (this.cellFeatures.size !== CELL_GRID_CELL_COUNT) throw new Error("Cell grid initialization failed.");
    }
  }

  private getCellFeature(id: string): Feature | undefined {
    return this.cellFeatures.get(id);
  }

  private validCellIds(cellIds: readonly string[]): string[] {
    return cellIds.filter((id) => parseCellId(id) !== null);
  }

  setSelected(featureId: string | null): void {
    this.selection.getFeatures().clear();
    if (!featureId) return;
    const feature = this.featureSource.getFeatureById(featureId);
    if (feature) this.selection.getFeatures().push(feature);
  }

  setSelectedCells(cellIds: readonly string[]): void {
    const validIds = this.validCellIds(cellIds);
    if (validIds.length === 0 && this.cellFeatures.size === 0) {
      this.selectedCellIds.clear();
      return;
    }
    this.ensureCells(validIds);
    const next = new Set(validIds);
    for (const id of this.selectedCellIds) {
      if (!next.has(id)) this.getCellFeature(id)?.set("selected", false, true);
    }
    for (const id of next) {
      if (!this.selectedCellIds.has(id)) this.getCellFeature(id)?.set("selected", true, true);
    }
    this.selectedCellIds = next;
    this.cellLayer.changed();
  }

  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void {
    const byCell = new globalThis.Map<string, CellAttributeSnapshot[]>();
    for (const attribute of attributes) {
      if (parseCellId(attribute.cellId) === null) continue;
      const current = byCell.get(attribute.cellId) ?? [];
      current.push(attribute);
      byCell.set(attribute.cellId, current);
    }
    this.ensureCells(byCell.keys());
    const changedIds = new Set([...this.cellAttributesById.keys(), ...byCell.keys()]);
    for (const id of changedIds) {
      const next = byCell.get(id) ?? [];
      const feature = this.getCellFeature(id);
      if (feature) feature.set("attributes", next, true);
    }
    this.cellAttributesById = byCell;
    this.cellLayer.changed();
  }

  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void {
    this.drawListeners.add(listener);
    return () => this.drawListeners.delete(listener);
  }

  onSelect(listener: (featureId: string | null) => void): () => void {
    this.selectListeners.add(listener);
    return () => this.selectListeners.delete(listener);
  }

  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void {
    this.cellSelectListeners.add(listener);
    return () => this.cellSelectListeners.delete(listener);
  }

  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void {
    this.modifyListeners.add(listener);
    return () => this.modifyListeners.delete(listener);
  }

  onZoomChange(listener: (zoom: number) => void): () => void {
    const view = this.map.getView();
    const onResolutionChange = () => listener(this.getZoom());
    view.on("change:resolution", onResolutionChange);
    return () => view.un("change:resolution", onResolutionChange);
  }

  updateSize(): void {
    this.map.updateSize();
    this.rebaseZoom();
  }

  async exportRaster(mimeType: "image/png" | "image/jpeg"): Promise<MapRaster> {
    this.map.renderSync();
    const [width = 0, height = 0] = this.map.getSize() ?? [];
    if (width <= 0 || height <= 0) throw new Error("地図のサイズを取得できません。");
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("地図画像を作成できません。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    for (const canvas of this.target.querySelectorAll<HTMLCanvasElement>("canvas")) {
      if (canvas.width > 0 && canvas.height > 0) context.drawImage(canvas, 0, 0, width, height);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob((value) => value ? resolve(value) : reject(new Error("地図画像を作成できません。")), mimeType, 0.92);
    });
    return { bytes: [...new Uint8Array(await blob.arrayBuffer())], width, height };
  }

  private rebaseZoom(): void {
    const view = this.map.getView();
    const size = this.map.getSize();
    const [width = 0, height = 0] = size ?? [];
    if (width <= 0 || height <= 0) return;

    const currentRelativeZoom = this.getZoom();
    const availableSize: [number, number] = [
      Math.max(1, width - this.fitPadding * 2),
      Math.max(1, height - this.fitPadding * 2),
    ];
    const fitResolution = view.getResolutionForExtent([...this.worldExtent], availableSize);
    const fitZoom = view.getZoomForResolution(fitResolution);
    if (fitZoom === undefined) return;

    // UI scale 1 is the fitted whole-world view; scale 0 is one step wider.
    this.baseZoom = fitZoom - 1;
    view.setMinZoom(this.baseZoom);
    view.setMaxZoom(this.baseZoom + 8);
    view.setZoom(this.baseZoom + currentRelativeZoom);
  }

  getMap(): Map {
    return this.map;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    if (this.brush) {
      this.map.removeInteraction(this.brush);
      this.brush.dispose();
      this.brush = null;
    }
    this.selection.un("select", this.handleSelection);
    this.modify.un("modifyend", this.handleModify);
    this.drawListeners.clear();
    this.selectListeners.clear();
    this.cellSelectListeners.clear();
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.map.getViewport().removeEventListener("pointercancel", this.handlePointerCancel);
    this.map.getViewport().removeEventListener("lostpointercapture", this.handlePointerCancel);
    this.modifyListeners.clear();
    this.selection.getFeatures().clear();
    this.featureSource.clear();
    this.cellSource.clear();
    this.cellFeatures.clear();
    this.cellAttributesById.clear();
    this.selectedCellIds.clear();
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
