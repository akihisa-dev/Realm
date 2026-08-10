import Feature, { type FeatureLike } from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import type Geometry from "ol/geom/Geometry";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import * as SelectModule from "ol/interaction/Select";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import type { CellAttributeSnapshot, FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export type RealmMapMode = "pan" | "cell-select" | FeatureType;

export const CELL_GRID_COLUMNS = 512;
export const CELL_GRID_ROWS = 256;
export const CELL_GRID_CELL_COUNT = CELL_GRID_COLUMNS * CELL_GRID_ROWS;

/** Stable persisted identity: x (column) first, then y (row). */
export const cellId = (row: number, column: number): string => `${column}:${row}`;

export const cellCenter = (row: number, column: number): [number, number] => [
  -180 + ((column + 0.5) * 360) / CELL_GRID_COLUMNS,
  -90 + ((row + 0.5) * 180) / CELL_GRID_ROWS,
];

export const cellIdsWithinPolygon = (polygon: Polygon): string[] => {
  const selected: string[] = [];
  for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
    for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) {
      if (polygon.intersectsCoordinate(cellCenter(row, column))) selected.push(cellId(row, column));
    }
  }
  return selected;
};

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  resetView(): void;
  setFeatures(features: RealmFeature[]): void;
  setMode(mode: RealmMapMode): void;
  setSelected(featureId: string | null): void;
  setSelectedCells(cellIds: readonly string[]): void;
  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  onSelect(listener: (featureId: string | null) => void): () => void;
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void;
  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;

const MAP_LABEL_FONT = '12px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const geometryFromGeoJson = (geometry: GeoJsonGeometry): Geometry => {
  if (geometry.type === "Point") return new Point(geometry.coordinates);
  if (geometry.type === "LineString") return new LineString(geometry.coordinates);
  return new Polygon(geometry.coordinates);
};

const geometryToGeoJson = (geometry: Geometry): GeoJsonGeometry => {
  if (geometry instanceof Point) return { type: "Point", coordinates: geometry.getCoordinates() as [number, number] };
  if (geometry instanceof LineString) return { type: "LineString", coordinates: geometry.getCoordinates() as [number, number][] };
  if (geometry instanceof Polygon) return { type: "Polygon", coordinates: geometry.getCoordinates() as [number, number][][] };
  throw new Error("Unsupported Realm geometry.");
};

const featureStyle = (feature: FeatureLike): Style => {
  const type = feature.get("featureType") as FeatureType | undefined;
  const presentation = type === "terrain" ? { color: "#8b7754", fillAlpha: "28", zIndex: 10 }
    : type === "forest" ? { color: "#3f7c55", fillAlpha: "28", zIndex: 20 }
      : type === "country" ? { color: "#315f7d", fillAlpha: "24", zIndex: 30 }
        : type === "region" ? { color: "#76568c", fillAlpha: "1c", zIndex: 40 }
          : type === "river" || type === "coastline" ? { color: "#2e78a6", fillAlpha: "28", zIndex: 50 }
            : type === "boundary" ? { color: "#915f3d", fillAlpha: "28", zIndex: 60 }
              : { color: "#8a3f58", fillAlpha: "28", zIndex: 70 };
  const areaName = type === "country" || type === "region" ? feature.get("name") : null;
  return new Style({
    fill: new Fill({ color: `${presentation.color}${presentation.fillAlpha}` }),
    stroke: new Stroke({
      color: presentation.color,
      width: type === "region" ? 1.75 : type === "boundary" ? 2 : 2.5,
      lineDash: type === "region" ? [5, 4] : undefined,
    }),
    image: new CircleStyle({ radius: type === "city" ? 6 : 4.5, fill: new Fill({ color: presentation.color }), stroke: new Stroke({ color: "#fff", width: 1.5 }) }),
    text: typeof areaName === "string" ? new Text({
      text: areaName,
      font: type === "country" ? `600 ${MAP_LABEL_FONT}` : MAP_LABEL_FONT,
      overflow: true,
      fill: new Fill({ color: "#26323b" }),
      stroke: new Stroke({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
    }) : undefined,
    zIndex: presentation.zIndex,
  });
};

const cellStyle = (feature: FeatureLike): Style | Style[] | undefined => {
  const attributes = feature.get("attributes") as CellAttributeSnapshot[] | undefined;
  const has = (attribute: CellAttributeSnapshot["attribute"]): boolean => attributes?.some((item) => item.attribute === attribute) ?? false;
  const selected = feature.get("selected") === true;
  const showGrid = feature.get("showGrid") === true;
  const hasPhysical = has("forest") || has("terrain_kind");
  if (!showGrid && !hasPhysical && !has("country") && !has("region") && !selected) return undefined;
  const styles: Style[] = [new Style({
    image: new CircleStyle({
      radius: hasPhysical ? 2 : 1.25,
      fill: new Fill({ color: has("forest") ? "#3f7c55" : has("terrain_kind") ? "#8b7754" : "rgba(74, 87, 98, 0.24)" }),
    }),
    zIndex: 5,
  })];
  if (has("country")) styles.push(new Style({
    image: new CircleStyle({ radius: 3.4, fill: new Fill({ color: "rgba(49, 95, 125, 0.08)" }), stroke: new Stroke({ color: "#315f7d", width: 1.1 }) }),
    zIndex: 6,
  }));
  if (has("region")) styles.push(new Style({
    image: new CircleStyle({ radius: 4.4, fill: new Fill({ color: "rgba(118, 86, 140, 0.05)" }), stroke: new Stroke({ color: "#76568c", width: 1.1, lineDash: [3, 2] }) }),
    zIndex: 7,
  }));
  if (selected) styles.push(new Style({
    image: new CircleStyle({ radius: 5.3, fill: new Fill({ color: "rgba(7, 140, 152, 0.08)" }), stroke: new Stroke({ color: "#078c98", width: 1.2 }) }),
    zIndex: 85,
  }));
  return styles;
};

/** Owns OpenLayers objects and leaves project state in React/Rust. */
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;
  private readonly worldExtent = [-180, -90, 180, 90] as const;
  private readonly fitPadding = 24;
  private readonly featureSource = new VectorSource();
  private readonly featureLayer: VectorLayer;
  private readonly cellSource = new VectorSource();
  private readonly cellLayer: VectorLayer;
  private readonly selection: SelectModule.default;
  private readonly modify: Modify;
  private readonly target: HTMLElement;
  private draw: Draw | null = null;
  private activeMode: RealmMapMode = "pan";
  private cellsReady = false;
  private selectedCellIds = new Set<string>();
  private readonly drawListeners = new Set<(geometry: GeoJsonGeometry) => void>();
  private readonly selectListeners = new Set<(featureId: string | null) => void>();
  private readonly cellSelectListeners = new Set<(cellIds: readonly string[]) => void>();
  private readonly modifyListeners = new Set<(featureId: string, geometry: GeoJsonGeometry) => void>();
  private baseZoom = 0;

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

    this.featureLayer = new VectorLayer({ source: this.featureSource, style: featureStyle });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: cellStyle, visible: true });
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
    this.selection.on("select", () => {
      const selected = this.selection.getFeatures().item(0);
      const id = selected?.getId();
      const featureId = typeof id === "string" ? id : null;
      for (const listener of this.selectListeners) listener(featureId);
    });
    this.modify.on("modifyend", (event) => {
      for (const feature of event.features.getArray()) {
        const id = feature.getId();
        const geometry = feature.getGeometry();
        if (typeof id !== "string" || !geometry) continue;
        const encoded = geometryToGeoJson(geometry);
        for (const listener of this.modifyListeners) listener(id, encoded);
      }
    });
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
        geometry: geometryFromGeoJson(snapshot.geometry),
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
      this.draw = new Draw({ type: "Polygon", freehand: true, stopClick: true });
      // OpenLayers keeps the active freehand flag separate from its condition.
      this.draw.setFreehand(true);
      this.draw.on("drawend", (event) => {
        const geometry = event.feature.getGeometry();
        if (!(geometry instanceof Polygon)) return;
        this.setSelectedCells(cellIdsWithinPolygon(geometry));
        for (const listener of this.cellSelectListeners) listener([...this.selectedCellIds]);
      });
      this.map.addInteraction(this.draw);
      return;
    }
    if (mode === "pan") return;
    const drawType = mode === "city" || mode === "town" ? "Point"
      : mode === "river" || mode === "coastline" || mode === "boundary" ? "LineString"
        : "Polygon";
    this.draw = new Draw({ type: drawType });
    // Lines and areas follow the pointer continuously from press to release.
    // Point features remain a single click because they have no path to trace.
    this.draw.setFreehand(drawType !== "Point");
    this.draw.on("drawend", (event) => {
      const geometry = event.feature.getGeometry();
      if (!geometry) return;
      const encoded = geometryToGeoJson(geometry);
      for (const listener of this.drawListeners) listener(encoded);
    });
    this.map.addInteraction(this.draw);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.activeMode !== "cell-select") return;
    this.draw?.abortDrawing();
    this.setSelectedCells([]);
    for (const listener of this.cellSelectListeners) listener([]);
    event.preventDefault();
  };

  private readonly handlePointerCancel = (): void => {
    if (this.activeMode === "cell-select") this.draw?.abortDrawing();
  };

  private setNavigationActive(active: boolean): void {
    for (const interaction of this.map.getInteractions().getArray()) {
      if (interaction instanceof DragPan || interaction instanceof KeyboardPan) interaction.setActive(active);
    }
  }

  private ensureCells(): void {
    if (this.cellsReady) return;
    const features: Feature[] = [];
    for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
      for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) {
        const feature = new Feature({ geometry: new Point(cellCenter(row, column)), selected: false, showGrid: false, attributes: [] });
        feature.setId(cellId(row, column));
        features.push(feature);
      }
    }
    this.cellSource.addFeatures(features);
    this.cellsReady = true;
  }

  setSelected(featureId: string | null): void {
    this.selection.getFeatures().clear();
    if (!featureId) return;
    const feature = this.featureSource.getFeatureById(featureId);
    if (feature) this.selection.getFeatures().push(feature);
  }

  setSelectedCells(cellIds: readonly string[]): void {
    if (cellIds.length === 0 && !this.cellsReady) {
      this.selectedCellIds.clear();
      return;
    }
    this.ensureCells();
    this.selectedCellIds = new Set(cellIds);
    for (const feature of this.cellSource.getFeatures()) {
      feature.set("selected", typeof feature.getId() === "string" && this.selectedCellIds.has(feature.getId() as string), true);
    }
    this.cellLayer.changed();
  }

  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void {
    if (attributes.length === 0 && !this.cellsReady) return;
    this.ensureCells();
    const byCell = new globalThis.Map<string, CellAttributeSnapshot[]>();
    for (const attribute of attributes) {
      const current = byCell.get(attribute.cellId) ?? [];
      current.push(attribute);
      byCell.set(attribute.cellId, current);
    }
    for (const feature of this.cellSource.getFeatures()) {
      const id = feature.getId();
      feature.set("attributes", typeof id === "string" ? (byCell.get(id) ?? []) : [], true);
    }
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
    this.drawListeners.clear();
    this.selectListeners.clear();
    this.cellSelectListeners.clear();
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.map.getViewport().removeEventListener("pointercancel", this.handlePointerCancel);
    this.modifyListeners.clear();
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
