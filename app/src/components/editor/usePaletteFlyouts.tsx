import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { Hexagon } from "@phosphor-icons/react/dist/csr/Hexagon";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { Magnet } from "@phosphor-icons/react/dist/csr/Magnet";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import packageJson from "../../../package.json";
import { CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import { DEFAULT_ERASE_TARGET, ERASE_TARGETS, type EraseTarget } from "./eraseTargets";

const PAINT_RANGE_FLYOUT_ID = "map-paint-range-flyout";
const REGION_FLYOUT_ID = "map-region-flyout";
const ERASE_FLYOUT_ID = "map-eraser-flyout";

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

export type PaletteFlyoutOptions = {
  hostRef: RefObject<HTMLDivElement | null>;
  mode: "pan" | "cell-select" | "cell-region" | "grab" | "shape" | "cell-erase" | "region";
  regionColor?: string | undefined;
  onToolChange: ((tool: "terrain" | "region" | "erase" | "grab" | "shape") => void) | undefined;
  onEraseTargetChange: ((target: EraseTarget) => void) | undefined;
  onRegionColorChange: ((color: string) => void) | undefined;
};

export type PaletteFlyoutState = {
  paintRange: number;
  eraseRadius: number;
  regionColor: string;
  sidebarOpen: boolean;
  toolPalette: ReactNode;
};

/** Owns the collapsible left tool sidebar, icon rail, and transient controls. */
export function usePaletteFlyouts({ hostRef, mode, regionColor, onToolChange, onEraseTargetChange, onRegionColorChange }: PaletteFlyoutOptions): PaletteFlyoutState {
  const paletteRef = useRef<HTMLElement>(null);
  const eraserTargetButtonsRef = useRef<HTMLDivElement>(null);
  const eraserTargetPillRef = useRef<HTMLSpanElement>(null);
  const [paintRange, setPaintRange] = useState(CELL_PAINT_RANGE_MIN);
  const [paintRangeFlyoutOpen, setPaintRangeFlyoutOpen] = useState(false);
  const [eraseRange, setEraseRange] = useState(CELL_PAINT_RANGE_MIN);
  const [eraseTarget, setEraseTarget] = useState<EraseTarget>(DEFAULT_ERASE_TARGET);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [regionFlyoutOpen, setRegionFlyoutOpen] = useState(false);
  const [localRegionColor, setLocalRegionColor] = useState("#7A6FA8");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const effectiveRegionColor = regionColor ?? localRegionColor;

  const closeFlyouts = (): void => {
    setPaintRangeFlyoutOpen(false);
    setEraseFlyoutOpen(false);
    setRegionFlyoutOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeFlyouts();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof window.Node)) return;
      if (paletteRef.current?.contains(event.target)) return;
      if (!paintRangeFlyoutOpen && !eraseFlyoutOpen && !regionFlyoutOpen) return;
      closeFlyouts();
      if (hostRef.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [eraseFlyoutOpen, hostRef, paintRangeFlyoutOpen, regionFlyoutOpen]);

  useLayoutEffect(() => {
    const buttons = eraserTargetButtonsRef.current;
    const pill = eraserTargetPillRef.current;
    const activeButton = buttons?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!pill || !activeButton) return;
    pill.style.left = `${activeButton.offsetLeft}px`;
    pill.style.width = `${activeButton.offsetWidth}px`;
  }, [eraseFlyoutOpen, eraseTarget]);

  const openPaintRangeFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("terrain");
    setPaintRangeFlyoutOpen((current) => !current);
    setEraseFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
  };

  const openRegionFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("region");
    setRegionFlyoutOpen((current) => !current);
    setPaintRangeFlyoutOpen(false);
    setEraseFlyoutOpen(false);
    event.stopPropagation();
  };

  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("erase");
    setEraseFlyoutOpen((current) => !current);
    setPaintRangeFlyoutOpen(false);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
  };

  const selectEraseTarget = (target: EraseTarget): void => {
    onToolChange?.("erase");
    setEraseTarget(target);
    onEraseTargetChange?.(target);
  };

  const selectSimpleTool = (tool: "grab" | "shape"): void => {
    onToolChange?.(tool);
    closeFlyouts();
  };

  const toggleSidebar = (): void => {
    closeFlyouts();
    setSidebarOpen((current) => !current);
  };

  const toolPalette: ReactNode = (
    <aside ref={paletteRef} className={`tool-sidebar${sidebarOpen ? "" : " is-collapsed"}`} aria-label="地図ツールパレット">
      <div className="tool-sidebar-header">
        <div className="tool-sidebar-heading">
          <p className="tool-sidebar-kicker">
            <span>Realm</span>
            <span className="tool-sidebar-version" aria-label={`バージョン ${packageJson.version}`}>{packageJson.version}</span>
          </p>
          <h2>地図ツール</h2>
        </div>
        <button
          className="tool-sidebar-toggle"
          type="button"
          aria-label={sidebarOpen ? "地図ツールパレットを閉じる" : "地図ツールパレットを開く"}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? "地図ツールパレットを閉じる" : "地図ツールパレットを開く"}
          onClick={toggleSidebar}
        >
          <SidebarSimple aria-hidden="true" size={17} weight="bold" />
        </button>
      </div>
      <div className="tool-sidebar-body">
        <div className="tool-sidebar-tools" role="toolbar" aria-label="地図ツール">
          <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${mode === "cell-select" ? " is-active" : ""}`}
              type="button"
              aria-label="地形を描く（太さ調整）"
              aria-pressed={mode === "cell-select"}
              aria-haspopup="true"
              aria-expanded={paintRangeFlyoutOpen}
              aria-controls={PAINT_RANGE_FLYOUT_ID}
              title="地形を描く（太さ調整）"
              onClick={openPaintRangeFlyout}
            >
              <SlidersHorizontal aria-hidden="true" size={17} weight="bold" />
              <span>地形を描く</span>
              <span className="tool-sidebar-button-detail">太さ</span>
            </button>
            {paintRangeFlyoutOpen ? (
            <div id={PAINT_RANGE_FLYOUT_ID} className="tool-flyout tool-flyout-range" role="group" aria-label="描画範囲の調整">
              <div className="tool-flyout-label-row">
                <label htmlFor="map-paint-range">描画範囲</label>
                <output htmlFor="map-paint-range">{paintRange}セル</output>
              </div>
              <input
                id="map-paint-range"
                type="range"
                min={CELL_PAINT_RANGE_MIN}
                max={CELL_PAINT_RANGE_MAX}
                step={1}
                value={paintRange}
                aria-label="描画範囲"
                aria-valuetext={`描画範囲${paintRange}セル`}
                onChange={(event) => setPaintRange(Number(event.target.value))}
              />
            </div>
            ) : null}
          </div>

          <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${mode === "cell-region" || mode === "region" ? " is-active" : ""}`}
              type="button"
              aria-label="領域"
              aria-pressed={mode === "cell-region" || mode === "region"}
              aria-haspopup="true"
              aria-expanded={regionFlyoutOpen}
              aria-controls={REGION_FLYOUT_ID}
              title="領域"
              onClick={openRegionFlyout}
            >
              <Hexagon aria-hidden="true" size={17} weight="fill" color={effectiveRegionColor} />
              <span>領域</span>
              <span className="tool-sidebar-button-detail">色</span>
            </button>
            {regionFlyoutOpen ? (
            <div id={REGION_FLYOUT_ID} className="tool-flyout tool-flyout-region" role="group" aria-label="領域の色">
              <span className="tool-flyout-label">領域の色</span>
              <div className="region-color-options" role="radiogroup" aria-label="領域色の候補">
                {REGION_COLORS.map((color, index) => (
                  <label className="region-color-option" key={color} title={`領域色 ${index + 1} ${color}`}>
                    <input
                      type="radio"
                      name="map-region-color"
                      value={color}
                      checked={effectiveRegionColor === color}
                      aria-label={`領域色 ${index + 1} ${color}`}
                      onChange={() => { setLocalRegionColor(color); onRegionColorChange?.(color); }}
                    />
                    <span className="region-color-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
                  </label>
                ))}
              </div>
            </div>
            ) : null}
          </div>

          <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${mode === "cell-erase" ? " is-active" : ""}`}
              type="button"
              aria-label="消しゴム"
              aria-pressed={mode === "cell-erase"}
              aria-haspopup="true"
              aria-expanded={eraseFlyoutOpen}
              aria-controls={ERASE_FLYOUT_ID}
              title="消しゴム"
              onClick={openEraseFlyout}
            >
              <Eraser aria-hidden="true" size={17} weight="bold" />
              <span>消しゴム</span>
              <span className="tool-sidebar-button-detail">調整</span>
            </button>
            {eraseFlyoutOpen ? (
            <div id={ERASE_FLYOUT_ID} className="tool-flyout tool-flyout-erase" role="group" aria-label="消しゴムの調整">
              <div className="eraser-targets" role="group" aria-label="削除対象">
                <span className="tool-flyout-label">削除対象</span>
                <div ref={eraserTargetButtonsRef} className="eraser-target-buttons">
                  <span ref={eraserTargetPillRef} className="eraser-target-pill" aria-hidden="true" />
                  {ERASE_TARGETS.map((target) => (
                    <button
                      className="eraser-target-button"
                      key={target.id}
                      type="button"
                      aria-pressed={eraseTarget === target.id}
                      onClick={() => selectEraseTarget(target.id)}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tool-flyout-label-row">
                <label htmlFor="map-erase-range">消しゴムの太さ</label>
                <output htmlFor="map-erase-range">{eraseRange}セル</output>
              </div>
              <input
                id="map-erase-range"
                type="range"
                min={CELL_PAINT_RANGE_MIN}
                max={CELL_PAINT_RANGE_MAX}
                step={1}
                value={eraseRange}
                aria-label="消しゴムの太さ"
                aria-valuetext={`消しゴムの太さ${eraseRange}セル`}
                onChange={(event) => setEraseRange(Number(event.target.value))}
              />
            </div>
            ) : null}
          </div>

          <div className="tool-sidebar-item">
            <button className={`tool-sidebar-button${mode === "grab" ? " is-active" : ""}`} type="button" aria-label="グラブ" aria-pressed={mode === "grab"} title="グラブ" onClick={() => selectSimpleTool("grab")}>
              <HandGrabbing aria-hidden="true" size={17} weight="bold" />
              <span>グラブ</span>
            </button>
          </div>
          <div className="tool-sidebar-item">
            <button className={`tool-sidebar-button${mode === "shape" ? " is-active" : ""}`} type="button" aria-label="シェイピング" aria-pressed={mode === "shape"} title="シェイピング" onClick={() => selectSimpleTool("shape")}>
              <Magnet aria-hidden="true" size={17} weight="bold" />
              <span>シェイピング</span>
            </button>
          </div>
        </div>
        <p className="tool-sidebar-help">ツールを選択すると、必要な調整項目がここに開きます。</p>
      </div>
    </aside>
  );

  return {
    paintRange,
    eraseRadius: cellPaintRadiusForRange(eraseRange),
    regionColor: effectiveRegionColor,
    sidebarOpen,
    toolPalette,
  };
}
