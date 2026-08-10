import type { CellAttributeSnapshot, FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export type RealmMapMode = "pan" | "cell-select" | FeatureType;

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  resetView(): void;
  setFeatures(features: RealmFeature[]): void;
  setMode(mode: RealmMapMode): void;
  setCellBrushRadius(radiusCells: number): void;
  setSelected(featureId: string | null): void;
  setSelectedCells(cellIds: readonly string[]): void;
  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  onSelect(listener: (featureId: string | null) => void): () => void;
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void;
  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  exportRaster(mimeType: "image/png" | "image/jpeg"): Promise<MapRaster>;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;
