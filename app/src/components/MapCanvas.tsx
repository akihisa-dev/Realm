import { useRef } from "react";
import {
  createRealmMapRenderer,
  type CellGridOptions,
  type DrawingOptions,
  type GridOptions,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
} from "../map/MapAdapter";
import type { CellAttributeSnapshot, GeoJsonGeometry, LayerId, MapObject, MapShape, MapShapeEdit } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { ExportCanvasSize } from "../map/contracts";
import type { MapErrorCode } from "../map/errors";
import { DEFAULT_MAP_THEME_ID, type MapThemeId, type ThemeOverrides } from "../map/themes";
import { useMapAdapterLifecycle } from "./editor/useMapAdapterLifecycle";
import { usePaletteFlyouts } from "./editor/usePaletteFlyouts";
import { useRendererSync } from "./editor/useRendererSync";

export type TerrainMapMode = "pan" | "cell-select" | "cell-region" | "grab" | "shape" | "cell-erase" | "erase" | "city" | "text" | "mountain" | "forest";

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  objects?: MapObject[];
  activeLayer?: LayerId;
  mode?: TerrainMapMode;
  strokeRange?: number;
  /** Prevents the mode cursor from suggesting an available editing action. */
  disabled?: boolean;
  selectedObjectId?: string | null;
  selectedObjectIds?: readonly string[];
  mapShapes?: readonly MapShape[];
  cellAttributes?: readonly CellAttributeSnapshot[];
  selectedCellIds?: readonly string[];
  drawingOptions?: DrawingOptions;
  gridOptions?: GridOptions;
  cellGridOptions?: CellGridOptions;
  themeOverrides?: ThemeOverrides;
  themeId?: MapThemeId;
  showGrid?: boolean;
  showCellGrid?: boolean;
  preview?: boolean;
  onDraw?: (geometry: GeoJsonGeometry) => void;
  onSelect?: (objectId: string | null) => void;
  onSelectObjects?: (objectIds: readonly string[]) => void;
  onCellSelect?: (cellIds: readonly string[]) => void;
  onMapShapeEdit?: (edit: MapShapeEdit) => void;
  onToolChange?: (tool: "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape") => void;
  onObjectKindChange?: (kind: "city" | "text" | "mountain" | "forest") => void;
  onRegionColorChange?: (color: string) => void;
  onCreateProject?: () => void;
  createProjectDisabled?: boolean;
  regionColor?: string;
  onModify?: (objectId: string, geometry: GeoJsonGeometry) => void;
  onModifyObjects?: (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void;
  onErase?: (objectId: string) => void;
  onEraseObjects?: (objectIds: readonly string[]) => void;
  onLayerShift?: (direction: -1 | 1) => void;
  onError?: (code: MapErrorCode) => void;
  createRenderer?: RealmMapRendererFactory;
  onExporterReady?: (exporter: ((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize) => Promise<MapRaster>) | null) => void;
};

export function MapCanvas({
  onZoomChange,
  zoom,
  objects = [],
  activeLayer = "terrain",
  mode = "pan",
  strokeRange,
  disabled = false,
  selectedObjectId = null,
  selectedObjectIds,
  mapShapes = [],
  cellAttributes = [],
  selectedCellIds = [],
  drawingOptions = { gesture: "freehand", smoothingPasses: 1, snapAngleDegrees: null },
  gridOptions = { kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 },
  cellGridOptions = { color: "#d1d7dc", width: 0.65 },
  themeOverrides = {},
  themeId = DEFAULT_MAP_THEME_ID,
  showGrid = true,
  showCellGrid = false,
  preview,
  onDraw,
  onSelect,
  onSelectObjects,
  onCellSelect,
  onMapShapeEdit,
  onToolChange,
  onRegionColorChange,
  onCreateProject,
  createProjectDisabled = false,
  regionColor,
  onModify,
  onModifyObjects,
  onErase,
  onEraseObjects,
  onLayerShift,
  onError,
  createRenderer = createRealmMapRenderer,
  onExporterReady,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const isPreview = preview ?? false;
  const rendererMode = isPreview ? "pan" : mode;

  const {
    strokeRadius,
    eraseRadius,
    toolPalette,
    regionColor: paletteRegionColor,
  } = usePaletteFlyouts({ hostRef, mode, activeLayer, strokeRange, regionColor, onToolChange, onRegionColorChange, onCreateProject, createProjectDisabled });
  const effectivePaintRadius = mode === "cell-select" ? strokeRadius : 0;
  const effectiveRegionColor = regionColor ?? paletteRegionColor;
  const mapHelp = isPreview
    ? "レンダリングプレビューを表示しています。編集はできません。ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。"
    : mode === "pan"
    ? "ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。"
      : mode === "cell-erase"
      ? `${activeLayer === "terrain" ? "地形" : "領域"}だけを六角セル単位で消去します。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。`
      : mode === "cell-region"
        ? "自由線で囲んだ内側の六角セルを領域として塗ります。色を選んで描き、Escapeで取り消せます。端の大きさを変えるときは掴むに切り替えます。"
      : mode === "shape"
        ? "領域をクリックすると、地形の外にはみ出した部分だけを削り、地形の形に合わせます。ホイールを押したままドラッグすると地図を移動できます。"
      : mode === "grab"
        ? "地形または領域の正確なPolygonの辺・頂点をつまみ、連続的に広げたり狭めたりできます。図形の内側をつまむと領域全体を移動します。グリッドへの吸着は離したときに行い、pointermove中は保存しません。pointercancel、Escape、フォーカス喪失で取り消せます。"
      : mode === "erase"
        ? "選択中のオブジェクトだけをクリックして削除します。Escapeで削除を取り消せます。"
      : mode === "city" || mode === "text" || mode === "mountain" || mode === "forest"
        ? "地形や領域の上へオブジェクトを配置します。クリックで置き、Spaceまたは中ボタン・右ボタンで地図を移動できます。"
      : "六角グリッドを一時的な選択範囲として押したままなぞります。選択結果はPolygonへ変換して1回で保存します。ホイールを押したままドラッグすると地図を移動できます。Escapeで選択を取り消せます。";
  const controlledObjectIds = selectedObjectIds ?? (selectedObjectId ? [selectedObjectId] : []);

  useRendererSync({
    adapterRef,
    objects,
    activeLayer,
    themeId,
    themeOverrides,
    showGrid,
    gridOptions,
    showCellGrid,
    cellGridOptions,
    preview: isPreview,
    drawingOptions,
    mapShapes,
    cellAttributes,
    mode: rendererMode,
    selectedCellIds,
    effectivePaintRadius,
    eraseRadius,
    selectedObjectIds: controlledObjectIds,
    regionColor: effectiveRegionColor,
  });

  useMapAdapterLifecycle({
    hostRef,
    adapterRef,
    createRenderer,
    zoom,
    objects,
    activeLayer,
    themeId,
    themeOverrides,
    showGrid,
    gridOptions,
    showCellGrid,
    cellGridOptions,
    preview: isPreview,
    drawingOptions,
    mapShapes,
    cellAttributes,
    mode: rendererMode,
    selectedCellIds,
    effectivePaintRadius,
    eraseRadius,
    selectedObjectIds: controlledObjectIds,
    regionColor: effectiveRegionColor,
    onZoomChange,
    onDraw,
    onSelect,
    onSelectObjects,
    onCellSelect,
    onMapShapeEdit,
    onModify,
    onModifyObjects,
    onErase,
    onEraseObjects,
    onLayerShift,
    onError,
    onExporterReady,
  });

  const modeClass = rendererMode === "pan"
    ? "map-canvas-mode-pan"
    : mode === "cell-erase"
      ? "map-canvas-mode-cell-erase"
      : mode === "cell-region" ? "map-canvas-mode-cell-region" : mode === "grab" ? "map-canvas-mode-grab" : mode === "shape" ? "map-canvas-mode-shape" : mode === "erase" ? "map-canvas-mode-erase" : mode === "city" || mode === "text" || mode === "mountain" || mode === "forest" ? `map-canvas-mode-object-${mode}` : "map-canvas-mode-cell-select";
  return (
    <div className={`map-canvas-shell${isPreview ? " map-canvas-preview" : ""}`}>
      <p id="map-help" className="sr-only">{mapHelp}</p>
      {isPreview ? null : toolPalette}
      <div className="map-canvas-frame">
        <div
          ref={hostRef}
          className={`map-canvas ${modeClass}${rendererMode === "pan" ? "" : " map-canvas-draw"}${disabled ? " map-canvas-disabled" : ""}`}
          role="region"
          tabIndex={0}
          aria-label="世界地図"
          aria-describedby="map-help"
        />
        <span className={`map-texture map-texture-${themeId}`} aria-hidden="true" />
      </div>
    </div>
  );
}
