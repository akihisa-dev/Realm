import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { Hexagon } from "@phosphor-icons/react/dist/csr/Hexagon";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { Magnet } from "@phosphor-icons/react/dist/csr/Magnet";
import { Mountains } from "@phosphor-icons/react/dist/csr/Mountains";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import packageJson from "../../../package.json";
import { CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import type { LayerId, ObjectKind } from "../../backend";

const REGION_FLYOUT_ID = "map-region-flyout";
const ERASE_FLYOUT_ID = "map-eraser-flyout";
const OBJECT_KINDS = ["city", "text", "mountain", "forest"] as const;
const OBJECT_LABELS: Record<(typeof OBJECT_KINDS)[number], string> = { city: "都市", text: "テキスト", mountain: "山", forest: "森" };

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
  mode: "pan" | "cell-select" | "cell-region" | "grab" | "shape" | "cell-erase" | "erase" | ObjectKind;
  activeLayer: LayerId;
  strokeRange?: number | undefined;
  regionColor?: string | undefined;
  onToolChange: ((tool: "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape") => void) | undefined;
  onObjectKindChange: ((kind: ObjectKind) => void) | undefined;
  onRegionColorChange: ((color: string) => void) | undefined;
};

export type PaletteFlyoutState = {
  strokeRadius: number;
  eraseRadius: number;
  regionColor: string;
  sidebarOpen: boolean;
  toolPalette: ReactNode;
};

/** Owns the collapsible left tool sidebar, icon rail, and inline/flyout controls. */
export function usePaletteFlyouts({ hostRef, mode, activeLayer, strokeRange = CELL_PAINT_RANGE_MIN, regionColor, onToolChange, onObjectKindChange, onRegionColorChange }: PaletteFlyoutOptions): PaletteFlyoutState {
  const paletteRef = useRef<HTMLElement>(null);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [regionFlyoutOpen, setRegionFlyoutOpen] = useState(false);
  const [localRegionColor, setLocalRegionColor] = useState("#7A6FA8");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const effectiveRegionColor = regionColor ?? localRegionColor;
  const showRegionControls = sidebarOpen || regionFlyoutOpen;
  const showEraseControls = sidebarOpen || eraseFlyoutOpen;

  const closeFlyouts = (): void => {
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
      if (!eraseFlyoutOpen && !regionFlyoutOpen) return;
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
  }, [eraseFlyoutOpen, hostRef, regionFlyoutOpen]);

  const layerLabel = activeLayer === "terrain" ? "地形" : activeLayer === "region" ? "領域" : "オブジェクト";
  const selectPaintTool = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.(activeLayer === "terrain" ? "terrain" : activeLayer === "region" ? "region" : "object");
    closeFlyouts();
    event.stopPropagation();
  };

  const openRegionFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("region");
    setRegionFlyoutOpen((current) => sidebarOpen || !current);
    setEraseFlyoutOpen(false);
    event.stopPropagation();
  };

  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("erase");
    setEraseFlyoutOpen((current) => sidebarOpen || !current);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
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
          {activeLayer === "terrain" ? <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${mode === "cell-select" ? " is-active" : ""}`}
              type="button"
              aria-label="地形を描く"
              aria-pressed={mode === "cell-select"}
              title="地形を描く"
              onClick={selectPaintTool}
            >
              <Mountains aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">地形を描く</span>
            </button>
          </div> : null}

          {activeLayer === "region" ? <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${mode === "cell-region" ? " is-active" : ""}`}
              type="button"
              aria-label="領域を描く"
              aria-pressed={mode === "cell-region"}
              aria-haspopup={sidebarOpen ? undefined : "true"}
              aria-expanded={showRegionControls}
              aria-controls={REGION_FLYOUT_ID}
              title="領域を描く"
              onClick={openRegionFlyout}
            >
              <Hexagon aria-hidden="true" size={17} weight="fill" color={effectiveRegionColor} />
              <span className="tool-sidebar-button-label">領域を描く</span>
            </button>
            {showRegionControls ? (
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
          </div> : null}

          {activeLayer === "object" ? <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${OBJECT_KINDS.includes(mode as ObjectKind) ? " is-active" : ""}`}
              type="button"
              aria-label="オブジェクトを配置"
              aria-pressed={OBJECT_KINDS.includes(mode as ObjectKind)}
              title="オブジェクトを配置"
              onClick={selectPaintTool}
            >
              <Mountains aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">オブジェクトを配置</span>
            </button>
            <div className="tool-flyout tool-flyout-region" role="group" aria-label="オブジェクト種別">
              <span className="tool-flyout-label">配置する種類</span>
              <div className="eraser-target-buttons" role="group" aria-label="オブジェクト種別">
                {OBJECT_KINDS.map((kind) => <button key={kind} className="eraser-target-button" type="button" aria-label={OBJECT_LABELS[kind]} aria-pressed={mode === kind} onClick={() => { onObjectKindChange?.(kind); onToolChange?.("object"); }}><span className="eraser-target-button-label">{OBJECT_LABELS[kind]}</span></button>)}
              </div>
            </div>
          </div> : null}

          {activeLayer === "object" ? <div className="tool-sidebar-item">
            <button className={`tool-sidebar-button${mode === "pan" ? " is-active" : ""}`} type="button" aria-label="オブジェクトを選択・移動" aria-pressed={mode === "pan"} title="オブジェクトを選択・移動" onClick={() => onToolChange?.("select")}>
              <HandGrabbing aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">選択・移動</span>
            </button>
          </div> : null}

          <div className="tool-sidebar-item">
            <button
              className={`tool-sidebar-button${(mode === "cell-erase" || (activeLayer === "object" && mode === "erase")) ? " is-active" : ""}`}
              type="button"
              aria-label={`${layerLabel}消しゴム`}
              aria-pressed={mode === "cell-erase" || (activeLayer === "object" && mode === "erase")}
              aria-haspopup={sidebarOpen ? undefined : "true"}
              aria-expanded={showEraseControls}
              aria-controls={ERASE_FLYOUT_ID}
              title={`${layerLabel}消しゴム`}
              onClick={openEraseFlyout}
            >
              <Eraser aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">{layerLabel}消しゴム</span>
            </button>
            {showEraseControls ? (
            <div id={ERASE_FLYOUT_ID} className="tool-flyout tool-flyout-erase" role="group" aria-label="消しゴムの対象">
              <div className="eraser-targets" role="status" aria-label="削除対象"><span className="tool-flyout-label">削除対象</span><strong>{layerLabel}だけ</strong></div>
            </div>
            ) : null}
          </div>

          {activeLayer !== "object" ? <div className="tool-sidebar-item">
            <button className={`tool-sidebar-button${mode === "grab" ? " is-active" : ""}`} type="button" aria-label="グラブ" aria-pressed={mode === "grab"} title="グラブ" onClick={() => selectSimpleTool("grab")}>
              <HandGrabbing aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">グラブ</span>
            </button>
          </div> : null}
          {activeLayer === "region" ? <div className="tool-sidebar-item">
            <button className={`tool-sidebar-button${mode === "shape" ? " is-active" : ""}`} type="button" aria-label="シェイピング" aria-pressed={mode === "shape"} title="シェイピング" onClick={() => selectSimpleTool("shape")}>
              <Magnet aria-hidden="true" size={17} weight="bold" />
              <span className="tool-sidebar-button-label">シェイピング</span>
            </button>
          </div> : null}
        </div>
        <p className="tool-sidebar-help">開いたサイドバーではツール名と調整項目を表示します。閉じたときはアイコンから開けます。</p>
      </div>
    </aside>
  );

  return {
    strokeRadius: cellPaintRadiusForRange(strokeRange),
    eraseRadius: cellPaintRadiusForRange(strokeRange),
    regionColor: effectiveRegionColor,
    sidebarOpen,
    toolPalette,
  };
}
