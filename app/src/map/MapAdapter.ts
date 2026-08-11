import Feature from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import LineString from "ol/geom/LineString";
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
import Graticule from "ol/layer/Graticule";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import Text from "ol/style/Text";
import { singleClick } from "ol/events/condition";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";
import type { CellAttributeSnapshot, GeoJsonGeometry, Position, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import { CELL_BRUSH_RADII, CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellIdsWithinBrushPath as gridCellIdsWithinBrushPath, cellPolygon as gridCellPolygon, parseCellId } from "./gridGeometry";
import { drawTypeForMode, geometryFromGeoJson as guardedGeometryFromGeoJson, geometryToGeoJson as guardedGeometryToGeoJson } from "./geoJsonGeometry";
import { MAX_SMOOTHING_PASSES, refineDrawnGeometry, snapPositionToAngle } from "./drawingGeometry";
import { DrawingGeometryError, mapErrorCode, type MapErrorCode } from "./errors";
import { createCellStyle, createFeatureStyle, MAP_LABEL_FONT } from "./styles";
import { DEFAULT_MAP_THEME_ID, mapTheme, validateThemeOverrides, type MapThemeId, type ThemeOverrides } from "./themes";
import { paintMapTexture } from "./mapTexture";
import { assertGeometryWithinWorld } from "./geometryGuard";
import type { CellGridOptions, DrawingOptions, ExportCanvasSize, FeatureGeometryChange, GridOptions, MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";

export type { CellGridOptions, DrawingOptions, ExportCanvasSize, FeatureGeometryChange, GridOptions, MapAdapterOptions, RealmMapMode, RealmMapRenderer, RealmMapRendererFactory } from "./contracts";
export type { CellBrushSize } from "./gridGeometry";
export { CELL_BRUSH_RADII, CELL_GRID_CELL_COUNT, CELL_GRID_COLUMNS, CELL_GRID_ROWS, cellCenter, cellId, cellIdsWithinBrushPath, cellPolygon, parseCellId } from "./gridGeometry";
export { assertGeometryWithinWorld, isGeometryWithinWorld, isPositionWithinWorld } from "./geometryGuard";

type Segment = readonly [Position, Position];
const MAX_LASSO_POINTS = 4096;
const MAX_GRID_EDGES = 20_000;
const DEFAULT_GRID_OPTIONS: GridOptions = { kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 };
const DEFAULT_CELL_GRID_OPTIONS: CellGridOptions = { color: "#d1d7dc", width: 0.65 };

const fixedCellGridLines = (): Position[][] => {
  const lines: Position[][] = [];
  const seen = new Set<string>();
  for (let row = 0; row < CELL_GRID_ROWS; row += 1) {
    for (let column = 0; column < CELL_GRID_COLUMNS; column += 1) {
      const ring = gridCellPolygon(row, column);
      if (!ring) continue;
      for (let index = 1; index < ring.length; index += 1) {
        const first = ring[index - 1]!;
        const second = ring[index]!;
        const firstKey = `${first[0].toFixed(9)},${first[1].toFixed(9)}`;
        const secondKey = `${second[0].toFixed(9)},${second[1].toFixed(9)}`;
        const key = firstKey < secondKey ? `${firstKey}:${secondKey}` : `${secondKey}:${firstKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push([first, second]);
      }
    }
  }
  return lines;
};

const createGraticule = (options: GridOptions): Graticule => new Graticule({
  strokeStyle: new Stroke({ color: options.color, lineDash: [4, 4], width: options.width }),
  intervals: [options.spacingDegrees],
  showLabels: true,
  targetSize: 170,
  lonLabelPosition: 0.96,
  latLabelPosition: 0.035,
  lonLabelStyle: new Text({
    font: MAP_LABEL_FONT,
    textBaseline: "bottom",
    fill: new Fill({ color: options.color }),
    stroke: new Stroke({ color: "#ffffff", width: 3 }),
  }),
  latLabelStyle: new Text({
    font: MAP_LABEL_FONT,
    textAlign: "start",
    textBaseline: "middle",
    fill: new Fill({ color: options.color }),
    stroke: new Stroke({ color: "#ffffff", width: 3 }),
  }),
  wrapX: false,
});

const boundedSquareGrid = (spacing: number): Feature[] => {
  const features: Feature[] = [];
  let index = 0;
  for (let longitude = -180; longitude <= 180 + 1e-9; longitude += spacing) {
    features.push(new Feature({ geometry: new LineString([[longitude, -90], [longitude, 90]]) }));
    features[index++]!.setId(`square-v-${index}`);
  }
  for (let latitude = -90; latitude <= 90 + 1e-9; latitude += spacing) {
    features.push(new Feature({ geometry: new LineString([[-180, latitude], [180, latitude]]) }));
    features[index++]!.setId(`square-h-${index}`);
  }
  return features;
};

const boundedHexGrid = (spacing: number): Feature[] => {
  const features: Feature[] = [];
  const seen = new Set<string>();
  const rowStep = spacing * 1.5;
  const columnStep = Math.sqrt(3) * spacing;
  let edgeIndex = 0;
  for (let row = 0, centerY = -90; centerY <= 90 + spacing && edgeIndex < MAX_GRID_EDGES; row += 1, centerY += rowStep) {
    const offset = row % 2 === 0 ? 0 : columnStep / 2;
    for (let centerX = -180 - columnStep; centerX <= 180 + columnStep && edgeIndex < MAX_GRID_EDGES; centerX += columnStep) {
      const cx = centerX + offset;
      const vertices: Position[] = [];
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const angle = (Math.PI / 180) * (30 + vertex * 60);
        vertices.push([cx + spacing * Math.cos(angle), centerY + spacing * Math.sin(angle)]);
      }
      if (vertices.some(([x, y]) => x < -180 || x > 180 || y < -90 || y > 90)) continue;
      for (let vertex = 0; vertex < 6 && edgeIndex < MAX_GRID_EDGES; vertex += 1) {
        const first = vertices[vertex]!;
        const second = vertices[(vertex + 1) % 6]!;
        const key = `${first[0].toFixed(6)},${first[1].toFixed(6)}:${second[0].toFixed(6)},${second[1].toFixed(6)}`;
        const reverse = `${second[0].toFixed(6)},${second[1].toFixed(6)}:${first[0].toFixed(6)},${first[1].toFixed(6)}`;
        if (seen.has(key) || seen.has(reverse)) continue;
        seen.add(key);
        const feature = new Feature({ geometry: new LineString([first, second]) });
        feature.setId(`hex-edge-${edgeIndex}`);
        features.push(feature);
        edgeIndex += 1;
      }
    }
  }
  return features;
};

const samePosition = (first: Position, second: Position): boolean => first[0] === second[0] && first[1] === second[1];

const orientation = (first: Position, second: Position, third: Position): number =>
  (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);

const onSegment = (first: Position, second: Position, point: Position): boolean =>
  point[0] >= Math.min(first[0], second[0]) && point[0] <= Math.max(first[0], second[0])
  && point[1] >= Math.min(first[1], second[1]) && point[1] <= Math.max(first[1], second[1]);

const segmentsIntersect = (first: Segment, second: Segment): boolean => {
  const epsilon = 1e-10;
  const [a, b] = first;
  const [c, d] = second;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  return (Math.abs(abC) <= epsilon && onSegment(a, b, c))
    || (Math.abs(abD) <= epsilon && onSegment(a, b, d))
    || (Math.abs(cdA) <= epsilon && onSegment(c, d, a))
    || (Math.abs(cdB) <= epsilon && onSegment(c, d, b));
};

const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  if (ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index]!;
    const prior = ring[previous]!;
    if (segmentsIntersect([prior, current], [point, point])) return true;
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1]);
    if (crosses && point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (point: Position, rings: readonly (readonly Position[])[]): boolean =>
  rings.length > 0 && pointInRing(point, rings[0]!) && rings.slice(1).every((hole) => !pointInRing(point, hole));

const ringSegments = (ring: readonly Position[]): Segment[] => {
  if (ring.length < 2) return [];
  const segments: Segment[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (!samePosition(ring[index]!, ring[next]!)) segments.push([ring[index]!, ring[next]!]);
  }
  return segments;
};

const geometryCoordinates = (geometry: GeoJsonGeometry): Position[][] => {
  if (geometry.type === "Point") return [[geometry.coordinates]];
  if (geometry.type === "LineString") return [geometry.coordinates];
  return geometry.coordinates;
};

const geometryIntersectsLasso = (geometry: GeoJsonGeometry, lassoRing: readonly Position[]): boolean => {
  const lassoSegments = ringSegments(lassoRing);
  const coordinates = geometryCoordinates(geometry);
  if (geometry.type === "Point") return pointInRing(geometry.coordinates, lassoRing);

  // A vertex in either polygon is enough for containment; segment checks cover
  // the case where two shapes cross without containing one another's vertices.
  if (coordinates.some((line) => line.some((point) => pointInRing(point, lassoRing)))) return true;
  if (geometry.type === "Polygon" && lassoRing.some((point) => pointInPolygon(point, geometry.coordinates))) return true;

  const geometrySegments = coordinates.flatMap((line) => {
    const segments: Segment[] = [];
    for (let index = 1; index < line.length; index += 1) segments.push([line[index - 1]!, line[index]!]);
    if (geometry.type === "Polygon" && line.length > 1 && !samePosition(line[0]!, line[line.length - 1]!)) segments.push([line[line.length - 1]!, line[0]!]);
    return segments;
  });
  return geometrySegments.some((segment) => lassoSegments.some((lassoSegment) => segmentsIntersect(segment, lassoSegment)));
};

/**
 * Returns feature ids whose geometry intersects or is contained by a lasso.
 * This pure helper keeps lasso semantics testable without requiring a browser
 * pointer sequence and intentionally treats polygon holes as non-selectable.
 */
export const selectFeatureIdsWithinLasso = (
  features: readonly Pick<RealmFeature, "id" | "geometry">[],
  lasso: readonly Position[],
): string[] => {
  const valid = lasso.length >= 3 && lasso.every((point) => point.length === 2 && point.every(Number.isFinite));
  if (!valid) return [];
  const ring = samePosition(lasso[0]!, lasso[lasso.length - 1]!) ? [...lasso] : [...lasso, lasso[0]!];
  return features.filter((feature) => geometryIntersectsLasso(feature.geometry, ring)).map((feature) => feature.id);
};

const snapFinalSegment = (geometry: GeoJsonGeometry, stepDegrees: number): GeoJsonGeometry => {
  if (geometry.type === "Point") return geometry;
  if (geometry.type === "LineString") {
    if (geometry.coordinates.length < 2) return geometry;
    const coordinates = geometry.coordinates.map(([x, y]) => [x, y] as Position);
    for (let index = 1; index < coordinates.length; index += 1) {
      coordinates[index] = snapPositionToAngle(coordinates[index - 1]!, coordinates[index]!, stepDegrees);
    }
    return { type: "LineString", coordinates };
  }
  if (geometry.type !== "Polygon") return geometry;
  const coordinates = geometry.coordinates.map((rawRing) => {
    const ring = rawRing.map(([x, y]) => [x, y] as Position);
    const closed = ring.length > 1 && samePosition(ring[0]!, ring[ring.length - 1]!);
    const endpointIndex = closed ? ring.length - 2 : ring.length - 1;
    if (endpointIndex < 1) return ring;
    for (let index = 1; index <= endpointIndex; index += 1) {
      ring[index] = snapPositionToAngle(ring[index - 1]!, ring[index]!, stepDegrees);
    }
    if (closed) ring[ring.length - 1] = [...ring[0]!] as Position;
    return ring;
  });
  return { type: "Polygon", coordinates };
};

const straightenLine = (geometry: GeoJsonGeometry): GeoJsonGeometry => geometry.type === "LineString" && geometry.coordinates.length > 2
  ? { type: "LineString", coordinates: [geometry.coordinates[0]!, geometry.coordinates.at(-1)!] }
  : geometry;

const nudgeGeometry = (geometry: GeoJsonGeometry, offset: Position): GeoJsonGeometry => {
  const move = ([longitude, latitude]: Position): Position => [longitude + offset[0], latitude + offset[1]];
  if (geometry.type === "Point") return { type: "Point", coordinates: move(geometry.coordinates) };
  if (geometry.type === "LineString") return { type: "LineString", coordinates: geometry.coordinates.map(move) };
  return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => ring.map(move)) };
};

/** Owns OpenLayers objects and leaves project state in React/Rust. */
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;
  private readonly worldExtent = [-180, -90, 180, 90] as const;
  private readonly fitPadding = 24;
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
  private readonly cellGridSource = new VectorSource({ wrapX: false });
  private readonly cellGridStroke = new Stroke({ color: DEFAULT_CELL_GRID_OPTIONS.color, width: DEFAULT_CELL_GRID_OPTIONS.width });
  private readonly cellGridLayer: VectorLayer;
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
  private cellBrushRadius: number = CELL_BRUSH_RADII.medium;
  private brush: PointerInteraction | null = null;
  private eraser: PointerInteraction | null = null;
  private brushLastPoint: [number, number] | null = null;
  private brushStrokeSelection = new Set<string>();
  private brushSelectionBeforeStroke: string[] = [];
  private readonly cellFeatures = new globalThis.Map<string, Feature>();
  private cellAttributesById = new globalThis.Map<string, CellAttributeSnapshot[]>();
  private selectedCellIds = new Set<string>();
  private readonly drawListeners = new Set<(geometry: GeoJsonGeometry) => void>();
  private readonly selectFeaturesListeners = new Set<(featureIds: readonly string[]) => void>();
  private readonly selectListeners = new Set<(featureId: string | null) => void>();
  private readonly cellSelectListeners = new Set<(cellIds: readonly string[]) => void>();
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

  private readonly handleSelection = (): void => {
    this.emitSelection();
  };

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
    this.target.style.background = mapTheme(this.activeThemeId).canvas;
    this.graticule = createGraticule(this.gridOptions);

    this.featureLayer = new VectorLayer({ source: this.featureSource, style: this.featureStyle });
    this.cellLayer = new VectorLayer({ source: this.cellSource, style: this.cellStyle, visible: true });
    this.cellGridSource.addFeature(new Feature({ geometry: new MultiLineString(fixedCellGridLines()) }));
    this.cellGridLayer = new VectorLayer({
      source: this.cellGridSource,
      style: new Style({ stroke: this.cellGridStroke }),
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
      layers: [this.graticule, this.featureLayer, this.cellLayer, this.gridLayer, this.cellGridLayer],
      view: new View({
        projection: "EPSG:4326",
        center: [0, 0],
        zoom: 1,
        minZoom: -1,
        maxZoom: 8,
        extent: [-400, -220, 400, 220],
        showFullExtent: true,
        enableRotation: false,
      }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false, mouseWheelZoom: false }).extend([
        new MouseWheelZoom(),
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
  }

  setThemeOverrides(overrides: ThemeOverrides): void {
    this.themeOverrides = validateThemeOverrides(overrides);
    this.target.style.background = mapTheme(this.activeThemeId, this.themeOverrides).canvas;
    this.featureLayer.changed();
    this.cellLayer.changed();
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
  }

  setCellGridOptions(options: CellGridOptions): void {
    if (!/^#[\da-f]{6}$/i.test(options.color)) throw new Error("Cell grid color must be a #RRGGBB value.");
    if (!Number.isFinite(options.width) || options.width < 0.25 || options.width > 4) throw new Error("Cell grid width must be between 0.25 and 4.");
    this.cellGridStroke.setColor(options.color);
    this.cellGridStroke.setWidth(options.width);
    this.cellGridLayer.changed();
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
    return mode !== "pan" && mode !== "cell-select" && mode !== "erase"
      && drawTypeForMode(mode) !== "Point" && this.drawingGesture === "freehand";
  }

  setMode(mode: RealmMapMode): void {
    this.temporaryPan = false;
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
    if (this.eraser) {
      this.map.removeInteraction(this.eraser);
      this.eraser.dispose();
      this.eraser = null;
    }
    this.lassoPoints = [];
    if (mode !== "cell-select" && this.activeMode === "cell-select") this.setSelectedCells([]);
    this.activeMode = mode;
    this.modify.setActive(mode === "pan");
    this.translate.setActive(mode === "pan");
    this.selection.setActive(mode === "pan");
    this.lasso.setActive(mode === "pan");
    this.cellLayer.setVisible(true);
    this.setNavigationActive(mode === "pan");
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
    if (mode === "cell-select") {
      this.setSelected(null);
      this.brush = new PointerInteraction({
        handleDownEvent: (event) => {
          const pointer = event.originalEvent as PointerEvent;
          if (!pointer.isPrimary || pointer.button !== 0) return false;
          this.brushSelectionBeforeStroke = [...this.selectedCellIds];
          this.brushLastPoint = event.coordinate as [number, number];
          this.brushStrokeSelection = new Set(gridCellIdsWithinBrushPath([this.brushLastPoint], this.brushRadiusForEvent(event.originalEvent)));
          this.setSelectedCells([...this.brushStrokeSelection]);
          return true;
        },
        handleDragEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.brushLastPoint) this.brushLastPoint = nextPoint;
          for (const id of gridCellIdsWithinBrushPath([this.brushLastPoint, nextPoint], this.brushRadiusForEvent(event.originalEvent))) this.brushStrokeSelection.add(id);
          this.brushLastPoint = nextPoint;
          this.setSelectedCells([...this.brushStrokeSelection]);
        },
        handleUpEvent: (event) => {
          const nextPoint = event.coordinate as [number, number];
          if (!this.brushLastPoint) this.brushLastPoint = nextPoint;
          for (const id of gridCellIdsWithinBrushPath([this.brushLastPoint, nextPoint], this.brushRadiusForEvent(event.originalEvent))) this.brushStrokeSelection.add(id);
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
        encoded = snapAngle === null ? shaped : snapFinalSegment(shaped, snapAngle);
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
      this.temporaryPan = true;
      this.draw?.setActive(false);
      this.brush?.setActive(false);
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
    if (this.activeMode === "pan") {
      this.lassoPoints = [];
      this.lassoAdditive = false;
      this.setSelectedFeatures([]);
      this.emitSelection();
      event.preventDefault();
      return;
    }
    if (this.activeMode !== "cell-select") return;
    this.brushLastPoint = null;
    this.brushStrokeSelection.clear();
    this.brushSelectionBeforeStroke = [];
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
    this.brush?.setActive(true);
    event.preventDefault();
  };

  private readonly handlePointerCancel = (): void => {
    if (this.draw) this.draw.abortDrawing();
    this.lassoPoints = [];
    this.lassoAdditive = false;
    if (this.activeMode !== "cell-select" || !this.brushLastPoint) return;
    this.brushLastPoint = null;
    this.brushStrokeSelection.clear();
    this.setSelectedCells(this.brushSelectionBeforeStroke);
    this.brushSelectionBeforeStroke = [];
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    const hadGesture = Boolean(this.draw) || this.lassoPoints.length > 0;
    if (this.draw) {
      const vertexDrawing = this.drawingGesture === "vertices"
        && this.activeMode !== "pan" && this.activeMode !== "cell-select" && this.activeMode !== "erase"
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

  private brushRadiusForEvent(originalEvent: Event): number {
    if (typeof PointerEvent !== "undefined" && originalEvent instanceof PointerEvent && originalEvent.pointerType === "pen" && originalEvent.pressure > 0) {
      return this.cellBrushRadius * (0.45 + originalEvent.pressure * 0.9);
    }
    return this.cellBrushRadius;
  }

  setCellBrushRadius(radiusCells: number): void {
    if (!Number.isFinite(radiusCells)) return;
    this.cellBrushRadius = Math.max(0.25, Math.min(32, radiusCells));
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
    if (this.selectedCellIds.has(id) || this.cellAttributesById.has(id)) return;
    const feature = this.cellFeatures.get(id);
    if (!feature) return;
    this.cellSource.removeFeature(feature);
    this.cellFeatures.delete(id);
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
    if (validIds.length === 0 && this.cellFeatures.size === 0) {
      this.selectedCellIds.clear();
      return;
    }
    this.ensureCells(validIds);
    const next = new Set(validIds);
    for (const id of this.selectedCellIds) {
      if (!next.has(id)) {
        this.getCellFeature(id)?.set("selected", false, true);
        this.selectedCellIds.delete(id);
        this.removeUnusedCell(id);
      }
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
    for (const id of changedIds) this.removeUnusedCell(id);
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
    const onResolutionChange = () => listener(this.getZoom());
    view.on("change:resolution", onResolutionChange);
    return () => view.un("change:resolution", onResolutionChange);
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
    const availableSize: [number, number] = [
      Math.max(1, width - this.fitPadding * 2),
      Math.max(1, height - this.fitPadding * 2),
    ];
    const fitResolution = view.getResolutionForExtent([...this.worldExtent], availableSize);
    const fitZoom = view.getZoomForResolution(fitResolution);
    if (fitZoom === undefined) return;

    // UI scale 1 is the widest view and fits the whole editing world.
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
    if (this.eraser) {
      this.map.removeInteraction(this.eraser);
      this.eraser.dispose();
      this.eraser = null;
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
    this.modifyFeaturesListeners.clear();
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.target.removeEventListener("keyup", this.handleKeyUp);
    this.target.removeEventListener("contextmenu", this.handleContextMenu);
    this.map.getViewport().removeEventListener("pointercancel", this.handlePointerCancel);
    this.map.getViewport().removeEventListener("lostpointercapture", this.handlePointerCancel);
    this.modifyListeners.clear();
    this.eraseFeaturesListeners.clear();
    this.eraseListeners.clear();
    this.layerShiftListeners.clear();
    this.errorListeners.clear();
    this.selection.getFeatures().clear();
    this.featureSource.clear();
    this.cellSource.clear();
    this.gridSource.clear();
    this.map.removeLayer(this.gridLayer);
    this.cellGridSource.clear();
    this.map.removeLayer(this.cellGridLayer);
    this.cellFeatures.clear();
    this.cellAttributesById.clear();
    this.selectedCellIds.clear();
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
