import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type CSSProperties, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { createPortal } from "react-dom";
import { CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import { positionPaletteFlyout, type PaletteRect } from "../paletteFlyout";
import { DEFAULT_ERASE_TARGET, ERASE_TARGETS, type EraseTarget } from "./eraseTargets";

type RadialPalettePosition = { x: number; y: number };
type RadialPaletteState = RadialPalettePosition & { phase: "opening" | "open" | "closing" };
type FlyoutPosition = { left: number; top: number; side: "left" | "right" | "top" | "bottom" };
type FlyoutKind = "paint" | "region" | "erase";

const PAINT_RANGE_FLYOUT_SIZE = { width: 176, height: 58 };
const REGION_FLYOUT_SIZE = { width: 220, height: 112 };
const ERASE_FLYOUT_SIZE = { width: 220, height: 136 };
const PALETTE_FLYOUT_GAP = 12;
const FLYOUT_FALLBACK_POSITION: FlyoutPosition = { left: 12, top: 12, side: "right" };
const PAINT_RANGE_FLYOUT_ID = "map-paint-range-flyout";
const REGION_FLYOUT_ID = "map-region-flyout";
const RADIAL_PALETTE_ANIMATION_MS = 360;

export const REGION_COLORS = [
  "#E45756",
  "#F28E2B",
  "#F2CF5B",
  "#59A14F",
  "#2A9D8F",
  "#2468AC",
  "#6C5BCE",
  "#7A6FA8",
  "#C06C84",
  "#8C6E4A",
] as const;

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

export type PaletteFlyoutOptions = {
  shellRef: RefObject<HTMLDivElement | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  mode: "pan" | "cell-select" | "cell-region" | "grab" | "cell-erase" | "region";
  onToolChange: ((tool: "terrain" | "region" | "erase" | "grab") => void) | undefined;
  onEraseTargetChange: ((target: EraseTarget) => void) | undefined;
  onRegionColorChange: ((color: string) => void) | undefined;
};

export type PaletteFlyoutState = {
  paintRange: number;
  eraseRadius: number;
  regionColor: string;
  radialPalette: ReactNode;
  paintRangeFlyout: ReactNode;
  eraseFlyout: ReactNode;
  regionFlyout: ReactNode;
  handleContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleShellPointerDown: () => void;
};

/** Owns map tool palette state, placement, portal rendering, and focus-safe dismissal. */
export function usePaletteFlyouts({ shellRef, hostRef, mode, onToolChange, onEraseTargetChange, onRegionColorChange }: PaletteFlyoutOptions): PaletteFlyoutState {
  const radialPaletteRef = useRef<HTMLDivElement>(null);
  const paintRangeButtonRef = useRef<HTMLButtonElement>(null);
  const eraseButtonRef = useRef<HTMLButtonElement>(null);
  const regionButtonRef = useRef<HTMLButtonElement>(null);
  const paintRangeFlyoutRef = useRef<HTMLDivElement>(null);
  const eraseFlyoutRef = useRef<HTMLDivElement>(null);
  const eraserTargetButtonsRef = useRef<HTMLDivElement>(null);
  const eraserTargetPillRef = useRef<HTMLSpanElement>(null);
  const regionFlyoutRef = useRef<HTMLDivElement>(null);
  const [radialPaletteState, setRadialPaletteState] = useState<RadialPaletteState | null>(null);
  const [paintRange, setPaintRange] = useState(CELL_PAINT_RANGE_MIN);
  const [paintRangeFlyoutOpen, setPaintRangeFlyoutOpen] = useState(false);
  const [paintRangeFlyoutPosition, setPaintRangeFlyoutPosition] = useState<FlyoutPosition | null>(null);
  const [eraseRange, setEraseRange] = useState(CELL_PAINT_RANGE_MIN);
  const [eraseTarget, setEraseTarget] = useState<EraseTarget>(DEFAULT_ERASE_TARGET);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [eraseFlyoutPosition, setEraseFlyoutPosition] = useState<FlyoutPosition | null>(null);
  const [regionFlyoutOpen, setRegionFlyoutOpen] = useState(false);
  const [regionFlyoutPosition, setRegionFlyoutPosition] = useState<FlyoutPosition | null>(null);
  const [regionColor, setRegionColor] = useState("#7A6FA8");

  const getFallbackRects = (): { palette: PaletteRect; paintAnchor: PaletteRect; eraseAnchor: PaletteRect } => {
    const shellRect = readElementRect(shellRef.current);
    const shellLeft = shellRect?.left ?? 0;
    const shellTop = shellRect?.top ?? 0;
    const paletteX = radialPaletteState && Number.isFinite(radialPaletteState.x) ? radialPaletteState.x : 12;
    const paletteY = radialPaletteState && Number.isFinite(radialPaletteState.y) ? radialPaletteState.y : 12;
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
    const anchorElement = kind === "paint" ? paintRangeButtonRef.current : kind === "region" ? regionButtonRef.current : eraseButtonRef.current;
    const anchorRect = readElementRect(anchorElement);
    const anchor = anchorRect && hasRectArea(anchorRect)
      ? anchorRect
      : kind === "paint" ? fallback.paintAnchor : fallback.eraseAnchor;
    const flyoutElement = kind === "paint" ? paintRangeFlyoutRef.current : kind === "region" ? regionFlyoutRef.current : eraseFlyoutRef.current;
    const fallbackSize = kind === "paint" ? PAINT_RANGE_FLYOUT_SIZE : kind === "region" ? REGION_FLYOUT_SIZE : ERASE_FLYOUT_SIZE;
    const size = readElementSize(flyoutElement) ?? fallbackSize;
    return positionPaletteFlyout(palette, anchor, { width: window.innerWidth, height: window.innerHeight }, size, PALETTE_FLYOUT_GAP);
  };
  const openRegionFlyout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextOpen = !regionFlyoutOpen;
    if (nextOpen) setRegionFlyoutPosition(getFlyoutPosition("region"));
    onToolChange?.("region");
    setRegionFlyoutOpen(nextOpen);
    setEraseFlyoutOpen(false);
    setPaintRangeFlyoutOpen(false);
    event.stopPropagation();
  };

  const openPaintRangeFlyout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextOpen = !paintRangeFlyoutOpen;
    if (nextOpen) setPaintRangeFlyoutPosition(getFlyoutPosition("paint"));
    onToolChange?.("terrain");
    setPaintRangeFlyoutOpen(nextOpen);
    setEraseFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
  };
  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextOpen = !eraseFlyoutOpen;
    if (nextOpen) setEraseFlyoutPosition(getFlyoutPosition("erase"));
    onToolChange?.("erase");
    setEraseFlyoutOpen(nextOpen);
    setPaintRangeFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
  };

  const selectEraseTarget = (target: EraseTarget) => {
    onToolChange?.("erase");
    setEraseTarget(target);
    onEraseTargetChange?.(target);
  };

  const syncEraseTargetPill = () => {
    const buttons = eraserTargetButtonsRef.current;
    const pill = eraserTargetPillRef.current;
    const activeButton = buttons?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!pill || !activeButton) return;
    pill.style.left = `${activeButton.offsetLeft}px`;
    pill.style.width = `${activeButton.offsetWidth}px`;
  };

  useLayoutEffect(() => {
    if (!paintRangeFlyoutOpen && !eraseFlyoutOpen && !regionFlyoutOpen) return undefined;
    const updatePositions = () => {
      syncEraseTargetPill();
      if (paintRangeFlyoutOpen) {
        const nextPosition = getFlyoutPosition("paint");
        setPaintRangeFlyoutPosition((current) => current && equalFlyoutPosition(current, nextPosition) ? current : nextPosition);
      }
      if (eraseFlyoutOpen) {
        const nextPosition = getFlyoutPosition("erase");
        setEraseFlyoutPosition((current) => current && equalFlyoutPosition(current, nextPosition) ? current : nextPosition);
      }
      if (regionFlyoutOpen) {
        const nextPosition = getFlyoutPosition("region");
        setRegionFlyoutPosition((current) => current && equalFlyoutPosition(current, nextPosition) ? current : nextPosition);
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
    resizeObserver?.observe(regionButtonRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(paintRangeFlyoutRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(eraseFlyoutRef.current ?? shellRef.current ?? document.body);
    resizeObserver?.observe(regionFlyoutRef.current ?? shellRef.current ?? document.body);
    window.addEventListener("resize", updatePositions);
    return () => {
      cancelFrame?.();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePositions);
    };
  }, [eraseFlyoutOpen, eraseRange, eraseTarget, paintRange, paintRangeFlyoutOpen, radialPaletteState, regionFlyoutOpen]);

  useEffect(() => {
    if (!radialPaletteState) return undefined;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animationTimer = window.setTimeout(() => {
      setRadialPaletteState((current) => {
        if (!current) return null;
        if (reducedMotion || current.phase === "closing") return current.phase === "closing" ? null : { ...current, phase: "open" };
        return current.phase === "opening" ? { ...current, phase: "open" } : current;
      });
    }, reducedMotion ? 0 : RADIAL_PALETTE_ANIMATION_MS);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaintRangeFlyoutOpen(false);
        setEraseFlyoutOpen(false);
        setRegionFlyoutOpen(false);
        setRadialPaletteState((current) => current ? { ...current, phase: "closing" } : null);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof window.Node && (
        radialPaletteRef.current?.contains(event.target)
        || paintRangeFlyoutRef.current?.contains(event.target)
        || eraseFlyoutRef.current?.contains(event.target)
        || regionFlyoutRef.current?.contains(event.target)
      )) return;
      setPaintRangeFlyoutOpen(false);
      setEraseFlyoutOpen(false);
      setRegionFlyoutOpen(false);
      setRadialPaletteState((current) => current ? { ...current, phase: "closing" } : null);
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
  }, [radialPaletteState]);

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setPaintRangeFlyoutOpen(false);
    setEraseFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    setRadialPaletteState({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, phase: "opening" });
  };

  const handleShellPointerDown = () => {
    setPaintRangeFlyoutOpen(false);
    setEraseFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    setRadialPaletteState((current) => current ? { ...current, phase: "closing" } : null);
  };

  const portalRoot = typeof document === "undefined" ? null : document.body;
  const paintPosition = paintRangeFlyoutPosition ?? FLYOUT_FALLBACK_POSITION;
  const erasePosition = eraseFlyoutPosition ?? FLYOUT_FALLBACK_POSITION;
  const regionPosition = regionFlyoutPosition ?? FLYOUT_FALLBACK_POSITION;
  const radialPalette: ReactNode = radialPaletteState ? (
    <div
      ref={radialPaletteRef}
      className={`radial-palette radial-palette-${radialPaletteState.phase}`}
      role="toolbar"
      aria-label="地図ツールパレット"
      style={{ left: radialPaletteState.x, top: radialPaletteState.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="radial-palette-core" />
      <div className="radial-palette-slot radial-palette-eraser-tool" style={{ "--slot": 0 } as CSSProperties}>
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
          <Eraser aria-hidden="true" size={16} weight="bold" />
        </button>
      </div>
      <div className="radial-palette-slot radial-palette-range-tool" style={{ "--slot": 1 } as CSSProperties}>
        <button
          ref={paintRangeButtonRef}
          className="radial-palette-range-button"
          type="button"
          aria-label="地形を描く（太さ調整）"
          aria-pressed={mode === "cell-select"}
          aria-haspopup="true"
          aria-expanded={paintRangeFlyoutOpen}
          aria-controls={PAINT_RANGE_FLYOUT_ID}
          onClick={openPaintRangeFlyout}
        >
          <SlidersHorizontal aria-hidden="true" size={16} weight="bold" />
        </button>
      </div>
      <div className="radial-palette-slot radial-palette-region-tool" style={{ "--slot": 2 } as CSSProperties}>
        <button ref={regionButtonRef} className="radial-palette-range-button" type="button" aria-label="領域" aria-pressed={mode === "cell-region" || mode === "region"} aria-haspopup="true" aria-expanded={regionFlyoutOpen} aria-controls={REGION_FLYOUT_ID} onClick={openRegionFlyout}>
          <span aria-hidden="true" style={{ display: "block", width: 14, height: 14, borderRadius: "50%", background: regionColor }} />
        </button>
      </div>
      <div className="radial-palette-slot radial-palette-grab-tool" style={{ "--slot": 3 } as CSSProperties}>
        <button className="radial-palette-range-button" type="button" aria-label="グラブ" aria-pressed={mode === "grab"} onClick={(event) => { onToolChange?.("grab"); setRegionFlyoutOpen(false); setPaintRangeFlyoutOpen(false); setEraseFlyoutOpen(false); event.stopPropagation(); }}>
          <HandGrabbing aria-hidden="true" size={16} weight="bold" />
        </button>
      </div>
    </div>
  ) : null;
  const regionFlyout = regionFlyoutOpen && portalRoot ? createPortal(
    <div ref={regionFlyoutRef} id={REGION_FLYOUT_ID} className={`palette-flyout palette-flyout-region radial-palette-flyout-${regionPosition.side}`} data-side={regionPosition.side} style={{ position: "fixed", zIndex: 10, display: "grid", visibility: "visible", opacity: 1, pointerEvents: "auto", left: regionPosition.left, top: regionPosition.top }} role="group" aria-label="領域の色" onPointerDown={(event) => event.stopPropagation()}>
      <span className="region-color-label">領域の色</span>
      <div className="region-color-options" role="radiogroup" aria-label="領域色の候補">
        {REGION_COLORS.map((color, index) => (
          <label className="region-color-option" key={color} title={`領域色 ${index + 1} ${color}`}>
            <input
              type="radio"
              name="map-region-color"
              value={color}
              checked={regionColor === color}
              aria-label={`領域色 ${index + 1} ${color}`}
              onChange={() => { setRegionColor(color); onRegionColorChange?.(color); }}
            />
            <span className="region-color-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
          </label>
        ))}
      </div>
    </div>, portalRoot,
  ) : null;
  const paintRangeFlyout = paintRangeFlyoutOpen && portalRoot ? createPortal(
    <div
      ref={paintRangeFlyoutRef}
      id={PAINT_RANGE_FLYOUT_ID}
      className={`palette-flyout radial-palette-flyout-${paintPosition.side}`}
      data-side={paintPosition.side}
      style={{ position: "fixed", zIndex: 10, display: "grid", visibility: "visible", opacity: 1, pointerEvents: "auto", left: paintPosition.left, top: paintPosition.top }}
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
        onChange={(event) => setPaintRange(Math.max(CELL_PAINT_RANGE_MIN, Math.min(CELL_PAINT_RANGE_MAX, Math.round(Number(event.currentTarget.value)) || CELL_PAINT_RANGE_MIN)))}
      />
    </div>,
    portalRoot,
  ) : null;
  const eraseFlyout = eraseFlyoutOpen && portalRoot ? createPortal(
    <div
      ref={eraseFlyoutRef}
      id="map-eraser-flyout"
      className={`palette-flyout palette-flyout-erase radial-palette-flyout-${erasePosition.side}`}
      data-side={erasePosition.side}
      style={{ position: "fixed", zIndex: 10, display: "grid", visibility: "visible", opacity: 1, pointerEvents: "auto", left: erasePosition.left, top: erasePosition.top }}
      role="group"
      aria-label="消しゴムの調整"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="eraser-targets" role="group" aria-label="削除対象">
        <span className="eraser-targets-label">削除対象</span>
        <div ref={eraserTargetButtonsRef} className="eraser-target-buttons">
          <span ref={eraserTargetPillRef} className="eraser-target-pill" aria-hidden="true" />
          {ERASE_TARGETS.map((target) => (
            <button
              key={target.id}
              className="eraser-target-button"
              type="button"
              aria-pressed={eraseTarget === target.id}
              onClick={() => selectEraseTarget(target.id)}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>
      <div className="eraser-range-label">
        <label htmlFor="map-eraser-range">太さ</label>
        <output htmlFor="map-eraser-range">{eraseRange}セル</output>
      </div>
      <input id="map-eraser-range" type="range" min={CELL_PAINT_RANGE_MIN} max={CELL_PAINT_RANGE_MAX} step={1} value={eraseRange} aria-label="消しゴムの太さ" aria-valuetext={`消しゴムの太さ${eraseRange}セル`} onChange={(event) => setEraseRange(Math.max(CELL_PAINT_RANGE_MIN, Math.min(CELL_PAINT_RANGE_MAX, Math.round(Number(event.currentTarget.value)) || CELL_PAINT_RANGE_MIN)))} />
    </div>,
    portalRoot,
  ) : null;

  return {
    paintRange,
    eraseRadius: cellPaintRadiusForRange(eraseRange),
    regionColor,
    radialPalette,
    paintRangeFlyout,
    eraseFlyout,
    regionFlyout,
    handleContextMenu,
    handleShellPointerDown,
  };
}
