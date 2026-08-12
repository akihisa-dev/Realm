import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  CELL_PAINT_RANGE_MAX,
  CELL_PAINT_RANGE_MIN,
  cellPaintRadiusForRange,
  createRealmMapRenderer,
  type CellGridOptions,
  type DrawingOptions,
  type GridOptions,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
  type CellEraseMode,
} from "../map/MapAdapter";
import type { CellAttributeSnapshot, GeoJsonGeometry, RealmFeature } from "../backend";
import type { MapRaster } from "../exportArtifacts";
import type { ExportCanvasSize } from "../map/contracts";
import type { MapErrorCode } from "../map/errors";
import { DEFAULT_MAP_THEME_ID, type MapThemeId, type ThemeOverrides } from "../map/themes";
import { positionPaletteFlyout, type PaletteRect } from "./paletteFlyout";

export type TerrainMapMode = "pan" | "cell-select" | "cell-erase";

type RadialPalettePosition = {
  x: number;
  y: number;
};

type RadialPaletteState = RadialPalettePosition & {
  phase: "opening" | "open" | "closing";
};
type FlyoutPosition = { left: number; top: number; side: "left" | "right" | "top" | "bottom" };
type FlyoutKind = "paint" | "erase";

const PAINT_RANGE_FLYOUT_SIZE = { width: 176, height: 58 };
const ERASE_FLYOUT_SIZE = { width: 220, height: 100 };
const PALETTE_FLYOUT_GAP = 12;
const FLYOUT_FALLBACK_POSITION: FlyoutPosition = { left: 12, top: 12, side: "right" };

const RADIAL_PALETTE_SLOTS = 8;
const PAINT_RANGE_FLYOUT_ID = "map-paint-range-flyout";
// The slots have a short staggered animation. Keep the mounted element around
// for the same total duration while it winds back to the center on dismissal.
const RADIAL_PALETTE_ANIMATION_MS = 360;

const isFiniteRect = (rect: PaletteRect | null): rect is PaletteRect => rect !== null
  && Number.isFinite(rect.left)
  && Number.isFinite(rect.top)
  && Number.isFinite(rect.right)
  && Number.isFinite(rect.bottom);

const hasRectArea = (rect: PaletteRect): boolean => rect.right > rect.left && rect.bottom > rect.top;

const readElementRect = (element: Element | null): PaletteRect | null => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return isFiniteRect(rect) ? {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  } : null;
};

const readElementSize = (element: Element | null): { width: number; height: number } | null => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const width = Number.isFinite(rect.width) ? rect.width : rect.right - rect.left;
  const height = Number.isFinite(rect.height) ? rect.height : rect.bottom - rect.top;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
};

const equalFlyoutPosition = (left: FlyoutPosition, right: FlyoutPosition): boolean =>
  left.left === right.left && left.top === right.top && left.side === right.side;

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  features?: RealmFeature[];
  mode?: TerrainMapMode;
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
  onToolChange?: (tool: "pan" | "terrain" | "erase") => void;
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
  onToolChange,
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
  const radialPaletteRef = useRef<HTMLDivElement>(null);
  const paintRangeButtonRef = useRef<HTMLButtonElement>(null);
  const eraseButtonRef = useRef<HTMLButtonElement>(null);
  const paintRangeFlyoutRef = useRef<HTMLDivElement>(null);
  const eraseFlyoutRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const [radialPalette, setRadialPalette] = useState<RadialPaletteState | null>(null);
  const [paintRange, setPaintRange] = useState(CELL_PAINT_RANGE_MIN);
  const [paintRangeFlyoutOpen, setPaintRangeFlyoutOpen] = useState(false);
  const [paintRangeFlyoutPosition, setPaintRangeFlyoutPosition] = useState<FlyoutPosition | null>(null);
  const [eraseMode, setEraseMode] = useState<CellEraseMode>("grid");
  const [eraseRange, setEraseRange] = useState(CELL_PAINT_RANGE_MIN);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [eraseFlyoutPosition, setEraseFlyoutPosition] = useState<FlyoutPosition | null>(null);
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
  const paintRadius = cellPaintRadiusForRange(paintRange);
  const effectivePaintRadius = mode === "cell-select" ? paintRadius : 0;
  const eraseRadius = cellPaintRadiusForRange(eraseRange);
  const mapHelp = mode === "pan"
    ? "ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。"
    : mode === "cell-erase"
      ? "六角セルを押したままなぞって地形を消去します。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。"
      : "六角セルを押したままなぞって選択します。ホイールを押したままドラッグすると地図を移動できます。選択したセルへ地形属性を適用します。Escapeで選択を取り消せます。";

  const getFallbackRects = (): { palette: PaletteRect; paintAnchor: PaletteRect; eraseAnchor: PaletteRect } => {
    const shellRect = readElementRect(shellRef.current);
    const shellLeft = shellRect?.left ?? 0;
    const shellTop = shellRect?.top ?? 0;
    const paletteX = radialPalette && Number.isFinite(radialPalette.x) ? radialPalette.x : 12;
    const paletteY = radialPalette && Number.isFinite(radialPalette.y) ? radialPalette.y : 12;
    const centerX = shellLeft + paletteX;
    const centerY = shellTop + paletteY;
    return {
      palette: { left: centerX - 30, top: centerY - 30, right: centerX + 30, bottom: centerY + 30 },
      paintAnchor: { left: centerX + 20, top: centerY - 50, right: centerX + 48, bottom: centerY - 22 },
      eraseAnchor: { left: centerX - 14, top: centerY - 62, right: centerX + 14, bottom: centerY - 34 },
    };
  };

  const getFlyoutPosition = (kind: FlyoutKind): FlyoutPosition => {
    const fallback = getFallbackRects();
    const paletteRect = readElementRect(radialPaletteRef.current);
    const palette = paletteRect && (hasRectArea(paletteRect) || paletteRect.left !== 0 || paletteRect.top !== 0)
      ? paletteRect
      : fallback.palette;
    const anchorElement = kind === "paint" ? paintRangeButtonRef.current : eraseButtonRef.current;
    const anchorRect = readElementRect(anchorElement);
    const anchor = anchorRect && hasRectArea(anchorRect)
      ? anchorRect
      : kind === "paint" ? fallback.paintAnchor : fallback.eraseAnchor;
    const flyoutElement = kind === "paint" ? paintRangeFlyoutRef.current : eraseFlyoutRef.current;
    const fallbackSize = kind === "paint" ? PAINT_RANGE_FLYOUT_SIZE : ERASE_FLYOUT_SIZE;
    const size = readElementSize(flyoutElement) ?? fallbackSize;
    return positionPaletteFlyout(
      palette,
      anchor,
      { width: window.innerWidth, height: window.innerHeight },
      size,
      PALETTE_FLYOUT_GAP,
    );
  };

  const openPaintRangeFlyout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextOpen = !paintRangeFlyoutOpen;
    if (nextOpen) setPaintRangeFlyoutPosition(getFlyoutPosition("paint"));
    setPaintRangeFlyoutOpen(nextOpen);
    setEraseFlyoutOpen(false);
    event.stopPropagation();
  };
  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextOpen = !eraseFlyoutOpen;
    if (nextOpen) setEraseFlyoutPosition(getFlyoutPosition("erase"));
    onToolChange?.("erase");
    setEraseFlyoutOpen(nextOpen);
    setPaintRangeFlyoutOpen(false);
    event.stopPropagation();
  };

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
  useEffect(() => { adapterRef.current?.setDrawingOptions(drawingOptions); }, [drawingOptions]);
  // Erase saves lock the map as `pan` in the same render that removes the
  // attributes. Apply the semantic state first so setMode cannot expose the
  // old painted cell while it clears the transient erase preview.
  useEffect(() => { adapterRef.current?.setCellAttributes(cellAttributes); }, [cellAttributes]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { adapterRef.current?.setSelectedCells(selectedCellIds); }, [selectedCellIds]);
  useEffect(() => { adapterRef.current?.setCellPaintRadius(effectivePaintRadius); }, [effectivePaintRadius]);
  useEffect(() => { adapterRef.current?.setCellEraseOptions?.({ mode: eraseMode, radiusCells: eraseRadius }); }, [eraseMode, eraseRadius]);
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
    adapter.setCellPaintRadius(effectivePaintRadius);
    adapter.setCellEraseOptions?.({ mode: eraseMode, radiusCells: eraseRadius });
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

  useLayoutEffect(() => {
    if (!paintRangeFlyoutOpen && !eraseFlyoutOpen) return undefined;

    const updatePositions = () => {
      if (paintRangeFlyoutOpen) {
        const nextPosition = getFlyoutPosition("paint");
        setPaintRangeFlyoutPosition((current) => current && equalFlyoutPosition(current, nextPosition) ? current : nextPosition);
      }
      if (eraseFlyoutOpen) {
        const nextPosition = getFlyoutPosition("erase");
        setEraseFlyoutPosition((current) => current && equalFlyoutPosition(current, nextPosition) ? current : nextPosition);
      }
    };

    updatePositions();
    let cancelFrame: (() => void) | null = null;
    const scheduleFrame = () => {
      if (cancelFrame) return;
      if (typeof window.requestAnimationFrame === "function") {
        const frameId = window.requestAnimationFrame(() => {
          cancelFrame = null;
          updatePositions();
        });
        cancelFrame = () => window.cancelAnimationFrame(frameId);
      } else {
        const timerId = window.setTimeout(() => {
          cancelFrame = null;
          updatePositions();
        }, 0);
        cancelFrame = () => window.clearTimeout(timerId);
      }
    };
    scheduleFrame();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePositions);
    resizeObserver?.observe(radialPaletteRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(paintRangeButtonRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(eraseButtonRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(paintRangeFlyoutRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(eraseFlyoutRef.current ?? shellRef.current ?? document.body);
    window.addEventListener("resize", updatePositions);

    return () => {
      cancelFrame?.();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePositions);
    };
  }, [eraseFlyoutOpen, eraseMode, eraseRange, paintRange, paintRangeFlyoutOpen, radialPalette]);

  useEffect(() => {
    if (!radialPalette) return undefined;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animationTimer = window.setTimeout(() => {
      setRadialPalette((current) => {
        if (!current) return null;
        if (reducedMotion || current.phase === "closing") return current.phase === "closing" ? null : { ...current, phase: "open" };
        return current.phase === "opening" ? { ...current, phase: "open" } : current;
      });
    }, reducedMotion ? 0 : RADIAL_PALETTE_ANIMATION_MS);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaintRangeFlyoutOpen(false);
        setEraseFlyoutOpen(false);
        setRadialPalette((current) => current ? { ...current, phase: "closing" } : null);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof window.Node && (
        radialPaletteRef.current?.contains(event.target)
        || paintRangeFlyoutRef.current?.contains(event.target)
        || eraseFlyoutRef.current?.contains(event.target)
      )) return;
      setPaintRangeFlyoutOpen(false);
      setEraseFlyoutOpen(false);
      setRadialPalette((current) => current ? { ...current, phase: "closing" } : null);
      if (event.target instanceof window.Node && hostRef.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.clearTimeout(animationTimer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [radialPalette]);

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setPaintRangeFlyoutOpen(false);
    setEraseFlyoutOpen(false);
    setRadialPalette({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, phase: "opening" });
  };

  const portalRoot = typeof document === "undefined" ? null : document.body;
  const paintPosition = paintRangeFlyoutPosition ?? FLYOUT_FALLBACK_POSITION;
  const erasePosition = eraseFlyoutPosition ?? FLYOUT_FALLBACK_POSITION;
  const paintRangeFlyout = paintRangeFlyoutOpen && portalRoot ? createPortal(
    <div
      ref={paintRangeFlyoutRef}
      id={PAINT_RANGE_FLYOUT_ID}
      className={`palette-flyout radial-palette-flyout-${paintPosition.side}`}
      data-side={paintPosition.side}
      style={{
        position: "fixed",
        zIndex: 10,
        display: "grid",
        visibility: "visible",
        opacity: 1,
        pointerEvents: "auto",
        left: paintPosition.left,
        top: paintPosition.top,
      }}
      role="group"
      aria-label="描画範囲の調整"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label htmlFor="map-paint-range">描画範囲</label>
      <output htmlFor="map-paint-range">{paintRange}セル</output>
      <input
        id="map-paint-range"
        type="range"
        min={CELL_PAINT_RANGE_MIN}
        max={CELL_PAINT_RANGE_MAX}
        step={1}
        value={paintRange}
        aria-label="描画範囲"
        aria-valuetext={`描画範囲${paintRange}セル`}
        onChange={(event) => setPaintRange(Math.max(
          CELL_PAINT_RANGE_MIN,
          Math.min(CELL_PAINT_RANGE_MAX, Math.round(Number(event.currentTarget.value)) || CELL_PAINT_RANGE_MIN),
        ))}
      />
    </div>,
    portalRoot,
  ) : null;
  const eraseFlyout = eraseFlyoutOpen && portalRoot ? createPortal(
    <div
      ref={eraseFlyoutRef}
      id="map-eraser-flyout"
      className={`palette-flyout radial-palette-flyout-${erasePosition.side}`}
      data-side={erasePosition.side}
      style={{
        position: "fixed",
        zIndex: 10,
        display: "grid",
        visibility: "visible",
        opacity: 1,
        pointerEvents: "auto",
        left: erasePosition.left,
        top: erasePosition.top,
      }}
      role="group"
      aria-label="消しゴムの調整"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span>性質</span>
      <span className="eraser-mode-options">
        <label><input type="radio" name="map-eraser-mode" value="grid" checked={eraseMode === "grid"} onChange={() => setEraseMode("grid")} />グリッドごと</label>
        <label><input type="radio" name="map-eraser-mode" value="cluster" checked={eraseMode === "cluster"} onChange={() => setEraseMode("cluster")} />塊ごと</label>
      </span>
      <label htmlFor="map-eraser-range">太さ</label>
      <output htmlFor="map-eraser-range">{eraseRange}セル</output>
      <input id="map-eraser-range" type="range" min={CELL_PAINT_RANGE_MIN} max={CELL_PAINT_RANGE_MAX} step={1} value={eraseRange} aria-label="消しゴムの太さ" aria-valuetext={`消しゴムの太さ${eraseRange}セル`} onChange={(event) => setEraseRange(Math.max(CELL_PAINT_RANGE_MIN, Math.min(CELL_PAINT_RANGE_MAX, Math.round(Number(event.currentTarget.value)) || CELL_PAINT_RANGE_MIN)))} />
    </div>,
    portalRoot,
  ) : null;

  return (
    <div
      ref={shellRef}
      className="map-canvas-shell"
      onPointerDown={() => {
        setPaintRangeFlyoutOpen(false);
        setEraseFlyoutOpen(false);
        setRadialPalette((current) => current ? { ...current, phase: "closing" } : null);
      }}
    >
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
      {radialPalette ? (
        <div
          ref={radialPaletteRef}
          className={`radial-palette radial-palette-${radialPalette.phase}`}
          role="toolbar"
          aria-label="地図ツールパレット"
          style={{ left: radialPalette.x, top: radialPalette.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="radial-palette-core" />
          <div className="radial-palette-slot radial-palette-eraser-tool" style={{ "--slot": 0 } as React.CSSProperties}>
            <button
              ref={eraseButtonRef}
              className="radial-palette-range-button"
              type="button"
              aria-label="消しゴム"
              aria-pressed={mode === "cell-erase"}
              aria-haspopup="true"
              aria-expanded={eraseFlyoutOpen}
              aria-controls="map-eraser-flyout"
              onClick={openEraseFlyout}
            >
              消しゴム
            </button>
          </div>
          <div
            className="radial-palette-slot radial-palette-range-tool"
            style={{ "--slot": 1 } as React.CSSProperties}
          >
            <button
              ref={paintRangeButtonRef}
              className="radial-palette-range-button"
              type="button"
              aria-label="描画範囲"
              aria-haspopup="true"
              aria-expanded={paintRangeFlyoutOpen}
              aria-controls={PAINT_RANGE_FLYOUT_ID}
              onClick={openPaintRangeFlyout}
            >
              <span className="radial-palette-range-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 12h16M7 8v8M17 8v8" /></svg></span>
            </button>
          </div>
          {Array.from({ length: RADIAL_PALETTE_SLOTS - 1 }, (_, index) => (
            <span className="radial-palette-slot" aria-hidden="true" style={{ "--slot": index + 2 } as React.CSSProperties} key={index + 2} />
          ))}
        </div>
      ) : null}
      {paintRangeFlyout}
      {eraseFlyout}
    </div>
  );
}
