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
import type { FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  resetView(): void;
  setFeatures(features: RealmFeature[]): void;
  setMode(mode: "pan" | FeatureType): void;
  setSelected(featureId: string | null): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  onSelect(listener: (featureId: string | null) => void): () => void;
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
  const color = type === "river" || type === "coastline" ? "#2e78a6"
    : type === "boundary" ? "#915f3d"
      : type === "forest" ? "#3f7c55"
        : type === "terrain" ? "#8b7754"
          : type === "country" || type === "region" ? "#446f7c"
            : "#8a3f58";
  return new Style({
    fill: new Fill({ color: `${color}28` }),
    stroke: new Stroke({ color, width: type === "boundary" ? 2 : 2.5 }),
    image: new CircleStyle({ radius: type === "city" ? 6 : 4.5, fill: new Fill({ color }), stroke: new Stroke({ color: "#fff", width: 1.5 }) }),
  });
};

/** Owns OpenLayers objects and leaves project state in React/Rust. */
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;
  private readonly worldExtent = [-180, -90, 180, 90] as const;
  private readonly fitPadding = 24;
  private readonly featureSource = new VectorSource();
  private readonly featureLayer: VectorLayer;
  private readonly selection: SelectModule.default;
  private readonly modify: Modify;
  private draw: Draw | null = null;
  private readonly drawListeners = new Set<(geometry: GeoJsonGeometry) => void>();
  private readonly selectListeners = new Set<(featureId: string | null) => void>();
  private readonly modifyListeners = new Set<(featureId: string, geometry: GeoJsonGeometry) => void>();
  private baseZoom = 0;

  constructor({ target }: MapAdapterOptions) {
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
    this.selection = new SelectModule.default({ layers: [this.featureLayer] });
    this.modify = new Modify({ features: this.selection.getFeatures() });

    this.map = new Map({
      target,
      layers: [graticule, referenceAxes, this.featureLayer],
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

  setMode(mode: "pan" | FeatureType): void {
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    this.modify.setActive(mode === "pan");
    this.selection.setActive(mode === "pan");
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

  setSelected(featureId: string | null): void {
    this.selection.getFeatures().clear();
    if (!featureId) return;
    const feature = this.featureSource.getFeatureById(featureId);
    if (feature) this.selection.getFeatures().push(feature);
  }

  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void {
    this.drawListeners.add(listener);
    return () => this.drawListeners.delete(listener);
  }

  onSelect(listener: (featureId: string | null) => void): () => void {
    this.selectListeners.add(listener);
    return () => this.selectListeners.delete(listener);
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
    this.modifyListeners.clear();
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
