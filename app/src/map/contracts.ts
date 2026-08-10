import type { CellAttributeSnapshot, FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { MapThemeId, ThemeOverrides } from "./themes";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export type RealmMapMode = "pan" | "cell-select" | "erase" | "polygon-hole" | FeatureType;
export type FeatureGeometryChange = { id: string; geometry: GeoJsonGeometry };
export type ExportCanvasSize = {
  width: number;
  height: number;
  transparent?: boolean;
  quality?: number;
};
export type DrawingOptions = {
  gesture: "freehand" | "vertices";
  smoothingPasses: number;
  snapAngleDegrees: number | null;
};
export type GridOptions = {
  kind: "graticule" | "square" | "hex";
  color: string;
  width: number;
  spacingDegrees: number;
};

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  resetView(): void;
  setFeatures(features: RealmFeature[]): void;
  setTheme(themeId: MapThemeId): void;
  setThemeOverrides(overrides: ThemeOverrides): void;
  setGridVisible(visible: boolean): void;
  setGridOptions(options: GridOptions): void;
  setAssets(assetUrls: Readonly<Record<string, string>>): void;
  setLayerVisibility(featureType: FeatureType, visible: boolean): void;
  setMode(mode: RealmMapMode): void;
  setDrawingOptions(options: DrawingOptions): void;
  setCellBrushRadius(radiusCells: number): void;
  setSelected(featureId: string | null): void;
  /** Replace the controlled selectable feature set; this sync does not emit. */
  setSelectedFeatures(featureIds: readonly string[]): void;
  setSelectedCells(cellIds: readonly string[]): void;
  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  /** Emits the complete ordered set after click, shift-click, lasso, or Escape. */
  onSelectFeatures(listener: (featureIds: readonly string[]) => void): () => void;
  /** @deprecated Use onSelectFeatures for multi-selection-aware consumers. */
  onSelect(listener: (featureId: string | null) => void): () => void;
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void;
  onModifyFeatures(listener: (changes: readonly FeatureGeometryChange[]) => void): () => void;
  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void;
  onEraseFeatures(listener: (featureIds: readonly string[]) => void): () => void;
  onErase(listener: (featureId: string) => void): () => void;
  onError(listener: (message: string) => void): () => void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  exportRaster(mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize): Promise<MapRaster>;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;
