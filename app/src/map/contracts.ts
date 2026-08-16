import type { CellAttributeSnapshot, GeoJsonGeometry, LayerId, MapObject, MapShape, MapShapeEdit, ObjectKind } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { MapThemeId, ThemeOverrides } from "./themes";
import type { MapErrorCode } from "./errors";

export type MapAdapterOptions = {
  target: HTMLElement;
};

export type RealmMapMode = "pan" | "cell-select" | "cell-region" | "grab" | "shape" | "cell-erase" | "erase" | ObjectKind;
export type ObjectGeometryChange = { id: string; geometry: MapObject["geometry"] };
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
  setObjects(objects: MapObject[]): void;
  /** The only layer allowed to receive primary-pointer edits and selection. */
  setActiveLayer(layer: LayerId): void;
  setTheme(themeId: MapThemeId): void;
  setThemeOverrides(overrides: ThemeOverrides): void;
  setGridVisible(visible: boolean): void;
  setGridOptions(options: GridOptions): void;
  setCellGridVisible(visible: boolean): void;
  setCellGridOptions(options: CellGridOptions): void;
  /** Switches between exact editing geometry and renderer-only preview geometry. */
  setPresentationMode?(preview: boolean): void;
  setAssets(assetUrls: Readonly<Record<string, string>>): void;
  setObjectKindVisibility(kind: ObjectKind, visible: boolean): void;
  setMode(mode: RealmMapMode): void;
  setDrawingOptions(options: DrawingOptions): void;
  setCellPaintRadius(radiusCells: number): void;
  setCellEraseRadius(radiusCells: number): void;
  /** Color used by the transient cell-region enclosure preview. */
  setCellRegionColor?(color: string): void;
  setSelected(objectId: string | null): void;
  /** Replace the controlled selectable object set; this sync does not emit. */
  setSelectedObjects(objectIds: readonly string[]): void;
  setSelectedCells(cellIds: readonly string[]): void;
  setMapShapes?(shapes: readonly MapShape[]): void;
  setCellAttributes(attributes: readonly CellAttributeSnapshot[]): void;
  onDraw(listener: (geometry: GeoJsonGeometry) => void): () => void;
  /** Emits the complete ordered set after click, shift-click, lasso, or Escape. */
  onSelectObjects(listener: (objectIds: readonly string[]) => void): () => void;
  onSelect(listener: (objectId: string | null) => void): () => void;
  onCellSelect(listener: (cellIds: readonly string[]) => void): () => void;
  onMapShapeEdit?(listener: (edit: MapShapeEdit) => void): () => void;
  onModifyObjects(listener: (changes: readonly ObjectGeometryChange[]) => void): () => void;
  onModify(listener: (objectId: string, geometry: MapObject["geometry"]) => void): () => void;
  onEraseObjects(listener: (objectIds: readonly string[]) => void): () => void;
  onErase(listener: (objectId: string) => void): () => void;
  onLayerShift(listener: (direction: -1 | 1) => void): () => void;
  onError(listener: (code: MapErrorCode) => void): () => void;
  onZoomChange(listener: (zoom: number) => void): () => void;
  updateSize(): void;
  exportRaster(mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize): Promise<MapRaster>;
  dispose(): void;
}

export type RealmMapRendererFactory = (options: MapAdapterOptions) => RealmMapRenderer;
