import { useEffect, useRef, useState } from "react";
import {
  createRealmMapRenderer,
  type DrawingOptions,
  type GridOptions,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
  type RealmMapMode,
} from "../map/MapAdapter";
import { Crosshair } from "@phosphor-icons/react/dist/csr/Crosshair";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import type { CellAttributeSnapshot, FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { ExportCanvasSize } from "../map/contracts";
import { DEFAULT_MAP_THEME_ID, type MapThemeId, type ThemeOverrides } from "../map/themes";

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  features?: RealmFeature[];
  mode?: RealmMapMode;
  selectedFeatureId?: string | null;
  selectedFeatureIds?: readonly string[];
  selectedCellIds?: readonly string[];
  cellAttributes?: readonly CellAttributeSnapshot[];
  cellBrushRadius?: number;
  drawingOptions?: DrawingOptions;
  gridOptions?: GridOptions;
  themeOverrides?: ThemeOverrides;
  themeId?: MapThemeId;
  showGrid?: boolean;
  assetUrls?: Readonly<Record<string, string>>;
  layerVisibility?: Partial<Record<FeatureType, boolean>>;
  onDraw?: (geometry: GeoJsonGeometry) => void;
  onSelect?: (featureId: string | null) => void;
  onSelectFeatures?: (featureIds: readonly string[]) => void;
  onCellSelect?: (cellIds: readonly string[]) => void;
  onModify?: (featureId: string, geometry: GeoJsonGeometry) => void;
  onModifyFeatures?: (changes: readonly { id: string; geometry: GeoJsonGeometry }[]) => void;
  onErase?: (featureId: string) => void;
  onEraseFeatures?: (featureIds: readonly string[]) => void;
  onLayerShift?: (direction: -1 | 1) => void;
  onToolWheel?: (direction: -1 | 1, cycleVariant: boolean) => void;
  onError?: (message: string) => void;
  createRenderer?: RealmMapRendererFactory;
  onExporterReady?: (exporter: ((mimeType: "image/png" | "image/jpeg", scale?: number, extent?: "viewport" | "world", size?: ExportCanvasSize) => Promise<MapRaster>) | null) => void;
};

export function MapCanvas({
  onZoomChange,
  zoom,
  features = [],
  mode = "pan",
  selectedFeatureId = null,
  selectedFeatureIds,
  selectedCellIds = [],
  cellAttributes = [],
  cellBrushRadius = 2,
  drawingOptions = { gesture: "freehand", smoothingPasses: 1, snapAngleDegrees: null },
  gridOptions = { kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 },
  themeOverrides = {},
  themeId = DEFAULT_MAP_THEME_ID,
  showGrid = true,
  assetUrls = {},
  layerVisibility = {},
  onDraw,
  onSelect,
  onSelectFeatures,
  onCellSelect,
  onModify,
  onModifyFeatures,
  onErase,
  onEraseFeatures,
  onLayerShift,
  onToolWheel,
  onError,
  createRenderer = createRealmMapRenderer,
  onExporterReady,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [brushPreview, setBrushPreview] = useState<{ x: number; y: number; diameter: number; opacity: number } | null>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const onZoomChangeRef = useRef(onZoomChange);
  const onDrawRef = useRef(onDraw);
  const onSelectRef = useRef(onSelect);
  const onSelectFeaturesRef = useRef(onSelectFeatures);
  const onCellSelectRef = useRef(onCellSelect);
  const onModifyRef = useRef(onModify);
  const onModifyFeaturesRef = useRef(onModifyFeatures);
  const onEraseRef = useRef(onErase);
  const onEraseFeaturesRef = useRef(onEraseFeatures);
  const onLayerShiftRef = useRef(onLayerShift);
  const onErrorRef = useRef(onError);
  const onExporterReadyRef = useRef(onExporterReady);
  const mapHelp = mode === "pan"
    ? "クリックで選択、Shiftクリックで追加・解除、修飾キーを押しながら囲むと複数選択します。矢印で地物を微移動、Shift+上下で描画順、Command+C/X/Vでコピー・切り取り・貼り付けできます。Command+ホイールで拡大縮小します。"
    : mode === "erase"
      ? "消したい地物をクリックします。削除した地物は元に戻す操作で復元できます。"
    : mode === "cell-select"
      ? "地図上で押したまま筆のように塗り、通過したセルへ属性を付けます。クリックでも円形に塗れます。Escapeで選択を解除できます。"
      : mode === "polygon-hole"
        ? "選択した領域の内側を描いて穴を追加します。右クリックまたはダブルクリックで確定し、Escapeで取り消せます。"
      : mode === "label-path"
        ? "選択したラベルを沿わせる曲線を描きます。右クリックまたはダブルクリックで確定し、Escapeで取り消せます。"
      : mode === "city" || mode === "town" || mode === "mountain" || mode === "tree" || mode === "symbol" || mode === "label" || mode === "scale"
      ? "地図上をクリックして点を配置します。角括弧またはホイールで大きさ、カンマ・ピリオドで回転、Fで左右反転します。"
      : drawingOptions.gesture === "vertices"
        ? "地図上を順にクリックして線または領域を描きます。Altで直線化、Alt+Shiftで45°に揃え、右クリックまたはダブルクリックで確定、Escapeで取り消せます。"
        : "地図上で押したまま線または領域を描きます。続けて複数の地物を描けます。Escapeで描画中の線を取り消せます。";

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => { onDrawRef.current = onDraw; }, [onDraw]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onSelectFeaturesRef.current = onSelectFeatures; }, [onSelectFeatures]);
  useEffect(() => { onCellSelectRef.current = onCellSelect; }, [onCellSelect]);
  useEffect(() => { onModifyRef.current = onModify; }, [onModify]);
  useEffect(() => { onModifyFeaturesRef.current = onModifyFeatures; }, [onModifyFeatures]);
  useEffect(() => { onEraseRef.current = onErase; }, [onErase]);
  useEffect(() => { onEraseFeaturesRef.current = onEraseFeatures; }, [onEraseFeatures]);
  useEffect(() => { onLayerShiftRef.current = onLayerShift; }, [onLayerShift]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onExporterReadyRef.current = onExporterReady; }, [onExporterReady]);

  useEffect(() => {
    if (zoom === undefined || !adapterRef.current) return;
    if (Math.abs(adapterRef.current.getZoom() - zoom) > 0.01) adapterRef.current.setZoom(zoom);
  }, [zoom]);

  useEffect(() => { adapterRef.current?.setFeatures(features); }, [features]);
  useEffect(() => { adapterRef.current?.setTheme(themeId); }, [themeId]);
  useEffect(() => { adapterRef.current?.setThemeOverrides(themeOverrides); }, [themeOverrides]);
  useEffect(() => { adapterRef.current?.setGridVisible(showGrid); }, [showGrid]);
  useEffect(() => { adapterRef.current?.setGridOptions(gridOptions); }, [gridOptions]);
  useEffect(() => { adapterRef.current?.setAssets(assetUrls); }, [assetUrls]);
  useEffect(() => {
    for (const [featureType, visible] of Object.entries(layerVisibility)) {
      adapterRef.current?.setLayerVisibility(featureType as FeatureType, visible !== false);
    }
  }, [layerVisibility]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { adapterRef.current?.setDrawingOptions(drawingOptions); }, [drawingOptions]);
  useEffect(() => {
    adapterRef.current?.setSelectedFeatures(selectedFeatureIds ?? (selectedFeatureId ? [selectedFeatureId] : []));
  }, [selectedFeatureId, selectedFeatureIds]);
  useEffect(() => { adapterRef.current?.setSelectedCells(selectedCellIds); }, [selectedCellIds]);
  useEffect(() => { adapterRef.current?.setCellAttributes(cellAttributes); }, [cellAttributes]);
  useEffect(() => { adapterRef.current?.setCellBrushRadius(cellBrushRadius); }, [cellBrushRadius]);
  useEffect(() => { if (mode !== "cell-select") setBrushPreview(null); }, [mode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const adapter = createRenderer({ target: host });
    adapterRef.current = adapter;
    onExporterReadyRef.current?.((mimeType, scale, extent, size) => adapter.exportRaster(mimeType, scale, extent, size));
    if (zoom !== undefined && Math.abs(adapter.getZoom() - zoom) > 0.01) adapter.setZoom(zoom);
    const stopZoomListener = adapter.onZoomChange((nextZoom) => onZoomChangeRef.current(nextZoom));
    const stopDrawListener = adapter.onDraw((geometry) => onDrawRef.current?.(geometry));
    const stopSelectListener = adapter.onSelectFeatures((featureIds) => {
      onSelectFeaturesRef.current?.(featureIds);
      onSelectRef.current?.(featureIds[0] ?? null);
    });
    const stopCellSelectListener = adapter.onCellSelect((cellIds) => onCellSelectRef.current?.(cellIds));
    const stopModifyListener = adapter.onModifyFeatures((changes) => {
      onModifyFeaturesRef.current?.(changes);
      if (!onModifyFeaturesRef.current) for (const { id, geometry } of changes) onModifyRef.current?.(id, geometry);
    });
    const stopEraseListener = adapter.onEraseFeatures((featureIds) => {
      onEraseFeaturesRef.current?.(featureIds);
      if (!onEraseFeaturesRef.current) for (const id of featureIds) onEraseRef.current?.(id);
    });
    const stopLayerShiftListener = adapter.onLayerShift((direction) => onLayerShiftRef.current?.(direction));
    const stopErrorListener = adapter.onError((message) => onErrorRef.current?.(message));
    adapter.setFeatures(features);
    adapter.setTheme(themeId);
    adapter.setThemeOverrides(themeOverrides);
    adapter.setGridVisible(showGrid);
    adapter.setGridOptions(gridOptions);
    adapter.setAssets(assetUrls);
    for (const [featureType, visible] of Object.entries(layerVisibility)) adapter.setLayerVisibility(featureType as FeatureType, visible !== false);
    adapter.setMode(mode);
    adapter.setDrawingOptions(drawingOptions);
    adapter.setSelectedFeatures(selectedFeatureIds ?? (selectedFeatureId ? [selectedFeatureId] : []));
    adapter.setSelectedCells(selectedCellIds);
    adapter.setCellAttributes(cellAttributes);
    adapter.setCellBrushRadius(cellBrushRadius);
    onZoomChangeRef.current(adapter.getZoom());

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => adapter.updateSize());
    resizeObserver?.observe(host);

    return () => {
      resizeObserver?.disconnect();
      stopZoomListener();
      stopDrawListener();
      stopSelectListener();
      stopCellSelectListener();
      stopModifyListener();
      stopEraseListener();
      stopLayerShiftListener();
      stopErrorListener();
      adapter.dispose();
      adapterRef.current = null;
      onExporterReadyRef.current?.(null);
    };
  }, [createRenderer]);

  return (
    <>
      <p id="map-help" className="sr-only">{mapHelp}</p>
      <div ref={hostRef} className={mode === "pan" ? "map-canvas" : "map-canvas map-canvas-draw"} role="region" tabIndex={0} aria-label="世界地図" aria-describedby="map-help" onWheel={(event) => {
        if (event.metaKey || event.ctrlKey || mode === "pan" || mode === "erase" || mode === "polygon-hole" || mode === "label-path") return;
        event.preventDefault();
        onToolWheel?.(event.deltaY > 0 ? -1 : 1, event.shiftKey);
      }} onPointerMove={(event) => {
        if (mode !== "cell-select") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 1;
        const worldScale = Math.pow(2, (zoom ?? 1) - 1);
        const diameter = Math.max(10, cellBrushRadius * 2 * Math.max(1, bounds.width) / 512 * worldScale * pressure);
        setBrushPreview({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, diameter, opacity: 0.35 + pressure * 0.35 });
      }} onPointerLeave={() => setBrushPreview(null)} />
      <span className={`map-texture map-texture-${themeId}`} aria-hidden="true" />
      {brushPreview ? <span className="brush-preview" aria-hidden="true" style={{ left: brushPreview.x, top: brushPreview.y, width: brushPreview.diameter, height: brushPreview.diameter, opacity: brushPreview.opacity }} /> : null}
      <div className="map-tools" role="group" aria-label="現在の地図操作">
        <button
          className={mode === "pan" ? "map-tool map-tool-active" : "map-tool"}
          type="button"
          aria-label="地図を移動"
          aria-pressed={mode === "pan"}
          onClick={() => hostRef.current?.focus()}
        >
          <Hand aria-hidden="true" size={22} weight="regular" />
        </button>
        <button className="map-tool" type="button" aria-label="表示を中央に戻す" onClick={() => {
          adapterRef.current?.resetView();
        }}>
          <Crosshair aria-hidden="true" size={21} weight="regular" />
        </button>
      </div>
    </>
  );
}

export function MapZoomControls({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  const percentage = `${Math.round(Math.pow(2, zoom - 1) * 100)}%`;
  return (
    <div className="zoom-controls" role="group" aria-label="地図のズーム">
      <button type="button" aria-label="縮小" onClick={() => onChange(Math.max(0, zoom - 1))} disabled={zoom <= 0}>
        <Minus aria-hidden="true" size={16} weight="regular" />
      </button>
      <span aria-live="polite">{percentage}</span>
      <button type="button" aria-label="拡大" onClick={() => onChange(Math.min(8, zoom + 1))} disabled={zoom >= 8}>
        <Plus aria-hidden="true" size={16} weight="regular" />
      </button>
    </div>
  );
}
