import { useRef } from "react";
import {
  cellPaintRadiusForRange,
  createRealmMapRenderer,
  type CellGridOptions,
  type DrawingOptions,
  type GridOptions,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
} from "../map/MapAdapter";
import type { CellAttributeSnapshot, GeoJsonGeometry, MoveRegionCellsInput, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { ExportCanvasSize } from "../map/contracts";
import type { MapErrorCode } from "../map/errors";
import { DEFAULT_MAP_THEME_ID, type MapThemeId, type ThemeOverrides } from "../map/themes";
import { useMapAdapterLifecycle } from "./editor/useMapAdapterLifecycle";
import { usePaletteFlyouts } from "./editor/usePaletteFlyouts";
import { useRendererSync } from "./editor/useRendererSync";
import type { EraseTarget } from "./editor/eraseTargets";

export type TerrainMapMode = "pan" | "cell-select" | "cell-region" | "grab" | "cell-erase" | "region";

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  features?: RealmFeature[];
  mode?: TerrainMapMode;
  /** Prevents the mode cursor from suggesting an available editing action. */
  disabled?: boolean;
  selectedFeatureId?: string | null;
  selectedFeatureIds?: readonly string[];
  cellAttributes?: readonly CellAttributeSnapshot[];
  selectedCellIds?: readonly string[];
  drawingOptions?: DrawingOptions;
  gridOptions?: GridOptions;
  cellGridOptions?: CellGridOptions;
  themeOverrides?: ThemeOverrides;
  themeId?: MapThemeId;
  showGrid?: boolean;
  showCellGrid?: boolean;
  onDraw?: (geometry: GeoJsonGeometry) => void;
  onSelect?: (featureId: string | null) => void;
  onSelectFeatures?: (featureIds: readonly string[]) => void;
  onCellSelect?: (cellIds: readonly string[]) => void;
  onRegionMove?: (input: MoveRegionCellsInput) => void;
  onToolChange?: (tool: "terrain" | "region" | "erase" | "grab") => void;
  onEraseTargetChange?: (target: EraseTarget) => void;
  onRegionColorChange?: (color: string) => void;
  regionColor?: string;
  onModify?: (featureId: string, geometry: GeoJsonGeometry) => void;
  onModifyFeatures?: (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void;
  onErase?: (featureId: string) => void;
  onEraseFeatures?: (featureIds: readonly string[]) => void;
  onLayerShift?: (direction: -1 | 1) => void;
  onError?: (code: MapErrorCode) => void;
  createRenderer?: RealmMapRendererFactory;
  onExporterReady?: (exporter: ((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize) => Promise<MapRaster>) | null) => void;
};

export function MapCanvas({
  onZoomChange,
  zoom,
  features = [],
  mode = "pan",
  disabled = false,
  selectedFeatureId = null,
  selectedFeatureIds,
  cellAttributes = [],
  selectedCellIds = [],
  drawingOptions = { gesture: "freehand", smoothingPasses: 1, snapAngleDegrees: null },
  gridOptions = { kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 },
  cellGridOptions = { color: "#d1d7dc", width: 0.65 },
  themeOverrides = {},
  themeId = DEFAULT_MAP_THEME_ID,
  showGrid = true,
  showCellGrid = false,
  onDraw,
  onSelect,
  onSelectFeatures,
  onCellSelect,
  onRegionMove,
  onToolChange,
  onEraseTargetChange,
  onRegionColorChange,
  regionColor,
  onModify,
  onModifyFeatures,
  onErase,
  onEraseFeatures,
  onLayerShift,
  onError,
  createRenderer = createRealmMapRenderer,
  onExporterReady,
}: MapCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);

  const {
    paintRange,
    eraseRadius,
    radialPalette,
    handleContextMenu,
    handleShellPointerDown,
    paintRangeFlyout,
    eraseFlyout,
    regionFlyout,
    regionColor: paletteRegionColor,
  } = usePaletteFlyouts({ shellRef, hostRef, mode, onToolChange, onEraseTargetChange, onRegionColorChange });
  const paintRadius = cellPaintRadiusForRange(paintRange);
  const effectivePaintRadius = mode === "cell-select" ? paintRadius : 0;
  const effectiveRegionColor = regionColor ?? paletteRegionColor;
  const mapHelp = mode === "pan"
    ? "ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。"
    : mode === "cell-erase"
      ? "六角セルを押したままなぞって地形または領域を消去します。消しゴムの調整で削除対象を切り替えられます。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。"
      : mode === "cell-region"
        ? "自由線で囲んだ内側の六角セルを領域として塗ります。色を選んで描き、Escapeで取り消せます。"
      : mode === "grab"
        ? "同じ色でつながった領域セルを掴んで、六角グリッドに沿って移動します。移動先が範囲外または別の領域と重なる場合は移動できません。Escapeで取り消せます。"
      : mode === "region"
        ? "領域の輪郭をドラッグして描きます。色を選んで保存できます。Escapeで取り消せます。"
      : "六角セルを押したままなぞって選択します。ホイールを押したままドラッグすると地図を移動できます。選択したセルへ地形属性を適用します。Escapeで選択を取り消せます。";
  const controlledFeatureIds = selectedFeatureIds ?? (selectedFeatureId ? [selectedFeatureId] : []);

  useRendererSync({
    adapterRef,
    features,
    themeId,
    themeOverrides,
    showGrid,
    gridOptions,
    showCellGrid,
    cellGridOptions,
    drawingOptions,
    cellAttributes,
    mode,
    selectedCellIds,
    effectivePaintRadius,
    eraseRadius,
    selectedFeatureIds: controlledFeatureIds,
    regionColor: effectiveRegionColor,
  });

  useMapAdapterLifecycle({
    hostRef,
    adapterRef,
    createRenderer,
    zoom,
    features,
    themeId,
    themeOverrides,
    showGrid,
    gridOptions,
    showCellGrid,
    cellGridOptions,
    drawingOptions,
    cellAttributes,
    mode,
    selectedCellIds,
    effectivePaintRadius,
    eraseRadius,
    selectedFeatureIds: controlledFeatureIds,
    regionColor: effectiveRegionColor,
    onZoomChange,
    onDraw,
    onSelect,
    onSelectFeatures,
    onCellSelect,
    onRegionMove,
    onModify,
    onModifyFeatures,
    onErase,
    onEraseFeatures,
    onLayerShift,
    onError,
    onExporterReady,
  });

  const modeClass = mode === "pan"
    ? "map-canvas-mode-pan"
    : mode === "cell-erase"
      ? "map-canvas-mode-cell-erase"
      : mode === "cell-region" ? "map-canvas-mode-cell-region" : mode === "grab" ? "map-canvas-mode-grab" : mode === "region" ? "map-canvas-mode-region" : "map-canvas-mode-cell-select";
  return (
    <div
      ref={shellRef}
      className="map-canvas-shell"
      onPointerDown={handleShellPointerDown}
    >
      <p id="map-help" className="sr-only">{mapHelp}</p>
      <div
        ref={hostRef}
        className={`map-canvas ${modeClass}${mode === "pan" ? "" : " map-canvas-draw"}${disabled ? " map-canvas-disabled" : ""}`}
        role="region"
        tabIndex={0}
        aria-label="世界地図"
        aria-describedby="map-help"
        onContextMenu={handleContextMenu}
      />
      <span className={`map-texture map-texture-${themeId}`} aria-hidden="true" />
      {radialPalette}
      {paintRangeFlyout}
      {eraseFlyout}
      {regionFlyout}
    </div>
  );
}
