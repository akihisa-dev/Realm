import type { CellAttributeSnapshot, FeatureType, GeoJsonGeometry, MapShape, MapShapeEdit, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { MapThemeId, ThemeOverrides } from "./themes";
import type { MapErrorCode } from "./errors";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export type RealmMapMode = "pan" | "cell-select" | "cell-region" | "grab" | "shape" | "cell-erase" | "erase" | "polygon-hole" | "label-path" | FeatureType;
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
export type CellGridOptions = Pick<GridOptions, "color" | "width">;

export interface RealmMapRenderer {
  getZoom(): number;
  setZoom(zoom: number): void;
  resetView(): void;
  setFeatures(features: RealmFeature[]): void;
  setTheme(themeId: MapThemeId): void;
  setThemeOverrides(overrides: ThemeOverrides): void;
  setGridVisible(visible: boolean): void;
  setGridOptions(options: GridOptions): void;
  setCellGridVisible(visible: boolean): void;
  setCellGridOptions(options: CellGridOptions): void;
  /** Switches between exact editing geometry and renderer-only preview geometry. */
  setPresentationMode?(preview: boolean): void;
  setAssets(assetUrls: Readonly<Record<string, string>>): void;
  setLayerVisibility(featureType: FeatureType, visible: boolean): void;
  setMode(mode: RealmMapMode): void;
  setDrawingOptions(options: DrawingOptions): void;
  setCellPaintRadius(radiusCells: number): void;
  setCellEraseRadius(radiusCells: number): void;
  /** Color used by the transient cell-region enclosure preview. */
  setCellRegionColor?(color: string): void;
  setSelected(featureId: string | null): void;
  /** Replace the controlled selectable feature set; this sync does not emit. */
  setSelectedFeatures(featureIds: readonly string[]): void;
  setSelectedCells(cellIds: readonly string[]): void;
  setMapShapes?(shapes: readonly MapShape[]): void;
  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  /** Emits the complete ordered set after click, shift-click, lasso, or Escape. */
  onSelectFeatures(listener: (featureIds: readonly string[]) => void): () => void;
  /** @deprecated Use onSelectFeatures for multi-selection-aware consumers. */
  onSelect(listener: (featureId: string | null) => void): () => void;
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void;
  onMapShapeEdit?(listener: (edit: MapShapeEdit) => void): () => void;
  onModifyFeatures(listener: (changes: readonly FeatureGeometryChange[]) => void): () => void;
  onModify(listener: (featureId: string, geometry: GeoJsonGeometry) => void): () => void;
  onEraseFeatures(listener: (featureIds: readonly string[]) => void): () => void;
  onErase(listener: (featureId: string) => void): () => void;
  onLayerShift(listener: (direction: -1 | 1) => void): () => void;
  onError(listener: (code: MapErrorCode) => void): () => void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  exportRaster(mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize): Promise<MapRaster>;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;
