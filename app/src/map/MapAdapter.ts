import Map from "ol/Map";
import View from "ol/View";
import Graticule from "ol/layer/Graticule";
import Stroke from "ol/style/Stroke";
import { defaults as defaultControls } from "ol/control";
import { defaults as defaultInteractions } from "ol/interaction";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;

/** Owns OpenLayers objects and leaves project state in React/Rust. */
export class RealmMapAdapter implements RealmMapRenderer {
  private readonly map: Map;

  constructor({ target }: MapAdapterOptions) {
    const graticule = new Graticule({
      strokeStyle: new Stroke({ color: "rgba(77, 91, 103, 0.23)", width: 1 }),
      showLabels: true,
      targetSize: 170,
      lonLabelPosition: 0.86,
      latLabelPosition: 0.97,
      wrapX: false,
    });

    this.map = new Map({
      target,
      layers: [graticule],
      view: new View({
        projection: "EPSG:4326",
        center: [0, 0],
        zoom: 1,
        minZoom: 0,
        maxZoom: 8,
        extent: [-180, -90, 180, 90],
        enableRotation: false,
      }),
      controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
    });
  }

  getZoom(): number {
    return this.map.getView().getZoom() ?? 1;
  }

  setZoom(zoom: number): void {
    this.map.getView().setZoom(Math.min(8, Math.max(0, zoom)));
  }

  onZoomChange(listener: (zoom: number) => void): () => void {
    const view = this.map.getView();
    const onResolutionChange = () => listener(this.getZoom());
    view.on("change:resolution", onResolutionChange);
    return () => view.un("change:resolution", onResolutionChange);
  }

  updateSize(): void {
    this.map.updateSize();
  }

  getMap(): Map {
    return this.map;
  }

  dispose(): void {
    this.map.setTarget(undefined);
    this.map.dispose();
  }
}

export const createRealmMapRenderer: RealmMapRendererFactory = (options) => new RealmMapAdapter(options);
