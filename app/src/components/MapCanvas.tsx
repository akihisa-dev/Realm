import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  createRealmMapRenderer,
  type CellGridOptions,
  type DrawingOptions,
  type GridOptions,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
} from "../map/MapAdapter";
import type { CellAttributeSnapshot, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { ExportCanvasSize } from "../map/contracts";
import type { MapErrorCode } from "../map/errors";
import { DEFAULT_MAP_THEME_ID, type MapThemeId, type ThemeOverrides } from "../map/themes";

export type TerrainMapMode = "pan" | "cell-select";

type RadialPalettePosition = {
  x: number;
  y: number;
};

const RADIAL_PALETTE_SLOTS = 8;

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  features?: RealmFeature[];
  mode?: TerrainMapMode;
  selectedFeatureId?: string | null;
  selectedFeatureIds?: readonly string[];
  cellAttributes?: readonly CellAttributeSnapshot[];
  selectedCellIds?: readonly string[];
  cellBrushRadius?: number;
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
  selectedFeatureId = null,
  selectedFeatureIds,
  cellAttributes = [],
  selectedCellIds = [],
  cellBrushRadius = 1,
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
  onModify,
  onModifyFeatures,
  onErase,
  onEraseFeatures,
  onLayerShift,
  onError,
  createRenderer = createRealmMapRenderer,
  onExporterReady,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const radialPaletteRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const [radialPalettePosition, setRadialPalettePosition] = useState<RadialPalettePosition | null>(null);
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
    ? "ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。"
    : "六角セルを押したままなぞって選択します。ホイールを押したままドラッグすると地図を移動できます。選択したセルへ地形属性を適用します。Escapeで選択を取り消せます。";

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
  useEffect(() => { adapterRef.current?.setCellGridVisible(showCellGrid); }, [showCellGrid]);
  useEffect(() => { adapterRef.current?.setCellGridOptions(cellGridOptions); }, [cellGridOptions]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { adapterRef.current?.setDrawingOptions(drawingOptions); }, [drawingOptions]);
  useEffect(() => { adapterRef.current?.setCellAttributes(cellAttributes); }, [cellAttributes]);
  useEffect(() => { adapterRef.current?.setSelectedCells(selectedCellIds); }, [selectedCellIds]);
  useEffect(() => { adapterRef.current?.setCellBrushRadius(cellBrushRadius); }, [cellBrushRadius]);
  useEffect(() => {
    adapterRef.current?.setSelectedFeatures(selectedFeatureIds ?? (selectedFeatureId ? [selectedFeatureId] : []));
  }, [selectedFeatureId, selectedFeatureIds]);

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
    const stopErrorListener = adapter.onError((code) => onErrorRef.current?.(code));
    adapter.setFeatures(features);
    adapter.setTheme(themeId);
    adapter.setThemeOverrides(themeOverrides);
    adapter.setGridVisible(showGrid);
    adapter.setGridOptions(gridOptions);
    adapter.setCellGridVisible(showCellGrid);
    adapter.setCellGridOptions(cellGridOptions);
    adapter.setMode(mode);
    adapter.setDrawingOptions(drawingOptions);
    adapter.setCellAttributes(cellAttributes);
    adapter.setSelectedCells(selectedCellIds);
    adapter.setCellBrushRadius(cellBrushRadius);
    adapter.setSelectedFeatures(selectedFeatureIds ?? (selectedFeatureId ? [selectedFeatureId] : []));
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

  useEffect(() => {
    if (!radialPalettePosition) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRadialPalettePosition(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof window.Node && radialPaletteRef.current?.contains(event.target)) return;
      setRadialPalettePosition(null);
    };
    const handleBlur = () => setRadialPalettePosition(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [radialPalettePosition]);

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setRadialPalettePosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  return (
    <div className="map-canvas-shell" onPointerDown={() => setRadialPalettePosition(null)}>
      <p id="map-help" className="sr-only">{mapHelp}</p>
      <div
        ref={hostRef}
        className={mode === "pan" ? "map-canvas" : "map-canvas map-canvas-draw"}
        role="region"
        tabIndex={0}
        aria-label="世界地図"
        aria-describedby="map-help"
        onContextMenu={handleContextMenu}
      />
      <span className={`map-texture map-texture-${themeId}`} aria-hidden="true" />
      {radialPalettePosition ? (
        <div
          ref={radialPaletteRef}
          className="radial-palette"
          aria-hidden="true"
          style={{ left: radialPalettePosition.x, top: radialPalettePosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="radial-palette-core" />
          {Array.from({ length: RADIAL_PALETTE_SLOTS }, (_, index) => (
            <span className="radial-palette-slot" style={{ "--slot": index } as React.CSSProperties} key={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
