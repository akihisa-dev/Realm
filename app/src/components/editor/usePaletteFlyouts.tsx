import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { GridFour } from "@phosphor-icons/react/dist/csr/GridFour";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Polygon } from "@phosphor-icons/react/dist/csr/Polygon";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { CELL_PAINT_RANGE_MAX, CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import { contentKindOf, type ActiveKind, type LayerId, type ObjectKind } from "../../backend";

const REGION_COLOR_FLYOUT_ID = "map-region-color-flyout";
const OBJECT_KINDS = ["city", "text", "mountain", "forest"] as const;
type CellPaintTool = "grid" | "area";

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
  activeKind?: ActiveKind;
  strokeRange?: number | undefined;
  onStrokeRangeChange?: ((range: number) => void) | undefined;
  regionColor?: string | undefined;
  onToolChange: ((tool: "grid" | "area" | "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape") => void) | undefined;
  onKindChange?: ((kind: ActiveKind) => void) | undefined;
  objectLabel?: string;
  onObjectLabelChange?: ((label: string) => void) | undefined;
  onStartObjectDraw?: (() => void) | undefined;
  onStartNewRegion?: (() => void) | undefined;
  showDrawingSetup?: boolean;
  onRegionColorChange: ((color: string) => void) | undefined;
  onCreateProject?: (() => void) | undefined;
  createProjectDisabled?: boolean | undefined;
  disabled?: boolean;
};

export type PaletteFlyoutState = {
  strokeRadius: number;
  eraseRadius: number;
  regionColor: string;
  toolPalette: ReactNode;
};

/** Owns the fixed left tool rail and its contextual flyouts. */
export function usePaletteFlyouts({ hostRef, mode, activeLayer, activeKind, strokeRange = CELL_PAINT_RANGE_MIN, onStrokeRangeChange, regionColor, onToolChange, onKindChange, objectLabel = "", onObjectLabelChange, onStartObjectDraw, onStartNewRegion, showDrawingSetup = false, onRegionColorChange, onCreateProject, createProjectDisabled = false, disabled = false }: PaletteFlyoutOptions): PaletteFlyoutState {
  const paletteRef = useRef<HTMLElement>(null);
  const [regionColorFlyoutTool, setRegionColorFlyoutTool] = useState<CellPaintTool | null>(null);
  const [localRegionColor, setLocalRegionColor] = useState("#7A6FA8");
  const effectiveRegionColor = regionColor ?? localRegionColor;

  const closeFlyouts = (): void => {
    setRegionColorFlyoutTool(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeFlyouts();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof window.Node)) return;
      if (paletteRef.current?.contains(event.target)) return;
      if (regionColorFlyoutTool === null) return;
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
  }, [hostRef, regionColorFlyoutTool]);

  const kind: ActiveKind = activeKind ?? (activeLayer === "terrain" || activeLayer === "region" ? activeLayer : "terrain");
  const contentKind = contentKindOf(kind);
  const isObjectKind = contentKind === "object";
  const toggleCellPaintTool = (tool: CellPaintTool, event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.(tool);
    if (!isObjectKind) {
      setRegionColorFlyoutTool(kind === "region" ? tool : null);
    } else closeFlyouts();
    event.stopPropagation();
  };

  const selectObjectDrawTool = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("object");
    closeFlyouts();
    event.stopPropagation();
  };

  const selectEraseTool = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("erase");
    closeFlyouts();
    event.stopPropagation();
  };

  const selectGrabTool = (): void => {
    onToolChange?.("grab");
    closeFlyouts();
  };

  const gridIsActive = isObjectKind ? OBJECT_KINDS.includes(mode as ObjectKind) : mode === "cell-select";
  const areaIsActive = !isObjectKind && mode === "cell-region";
  const eraseIsActive = mode === "cell-erase" || (isObjectKind && mode === "erase");
  const grabIsActive = mode === "grab";
  const regionColorFlyout: ReactNode = regionColorFlyoutTool !== null && kind === "region" ? (
    <div id={REGION_COLOR_FLYOUT_ID} className="tool-flyout tool-flyout-region" role="group" aria-label="領域色の候補">
      <div className="region-color-options" role="radiogroup" aria-label="領域色の候補">{REGION_COLORS.map((color, index) => <label className="region-color-option" key={color} title={`領域色 ${index + 1} ${color}`}><input type="radio" name="map-region-color" value={color} checked={effectiveRegionColor === color} aria-label={`領域色 ${index + 1} ${color}`} onChange={() => { setLocalRegionColor(color); onRegionColorChange?.(color); }} disabled={disabled} /><span className="region-color-swatch" aria-hidden="true" style={{ backgroundColor: color }} /></label>)}</div>
    </div>
  ) : null;
  const toolPalette: ReactNode = (
    <aside ref={paletteRef} className="tool-rail drawing-tool-sidebar" data-panel="drawing-tools" aria-label={showDrawingSetup ? "描画ツール" : "地図ツールレール"}>
      {showDrawingSetup ? <>
      <div className="drawing-kind-picker" role="radiogroup" aria-label="描画分類">
        {(["terrain", "region", "city", "text", "forest", "mountain"] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={kind === option} className={kind === option ? "is-active" : ""} onClick={() => onKindChange?.(option)} disabled={disabled || createProjectDisabled}>{({ terrain: "地形", region: "領域", city: "都市", text: "テキスト", forest: "森", mountain: "山" } as const)[option]}</button>)}
      </div></> : null}
      {showDrawingSetup ? <div className="drawing-tool-settings" role="group" aria-label="描画設定">
        <label htmlFor="sidebar-stroke-range">太さ</label>
        <input id="sidebar-stroke-range" type="range" min={CELL_PAINT_RANGE_MIN} max={CELL_PAINT_RANGE_MAX} step={1} value={strokeRange} aria-label="描画と削除の太さ" aria-valuetext={`太さ${strokeRange}セル`} onChange={(event) => onStrokeRangeChange?.(Number(event.target.value))} disabled={disabled} /><output htmlFor="sidebar-stroke-range">{strokeRange}セル</output>
        {isObjectKind ? <><label htmlFor="sidebar-object-label">ラベル</label><input id="sidebar-object-label" value={objectLabel} onChange={(event) => onObjectLabelChange?.(event.target.value)} disabled={disabled} /><button type="button" className="layer-primary-action" onClick={onStartObjectDraw} disabled={disabled || createProjectDisabled || !onStartObjectDraw}>配置開始</button></> : kind === "region" ? <button type="button" className="layer-primary-action" onClick={onStartNewRegion} disabled={disabled || createProjectDisabled || !onStartNewRegion}>新しい領域</button> : null}
      </div> : null}
      <div className="tool-rail-tools" role="toolbar" aria-label="地図ツール">
        {isObjectKind ? <div className="tool-rail-item">
          <button className={`tool-rail-button${gridIsActive ? " is-active" : ""}`} type="button" aria-label="描く" aria-pressed={gridIsActive} title="描く" onClick={selectObjectDrawTool} disabled={disabled}>
            <PencilSimple aria-hidden="true" size={20} weight="bold" />
          </button>
        </div> : <>
          <div className="tool-rail-item">
            <button className={`tool-rail-button${gridIsActive ? " is-active" : ""}`} type="button" aria-label="グリッド" aria-pressed={gridIsActive} aria-controls={kind === "region" ? REGION_COLOR_FLYOUT_ID : undefined} aria-expanded={kind === "region" ? regionColorFlyoutTool === "grid" : undefined} title="グリッド" onClick={(event) => toggleCellPaintTool("grid", event)} disabled={disabled}><GridFour aria-hidden="true" size={20} weight="bold" /></button>
            {regionColorFlyoutTool === "grid" ? regionColorFlyout : null}
          </div>
          <div className="tool-rail-item">
            <button className={`tool-rail-button${areaIsActive ? " is-active" : ""}`} type="button" aria-label="範囲" aria-pressed={areaIsActive} aria-controls={kind === "region" ? REGION_COLOR_FLYOUT_ID : undefined} aria-expanded={kind === "region" ? regionColorFlyoutTool === "area" : undefined} title="範囲" onClick={(event) => toggleCellPaintTool("area", event)} disabled={disabled}><Polygon aria-hidden="true" size={20} weight="bold" /></button>
            {regionColorFlyoutTool === "area" ? regionColorFlyout : null}
          </div>
        </>}

        <div className="tool-rail-item">
          <button
            className={`tool-rail-button${eraseIsActive ? " is-active" : ""}`}
            type="button"
            aria-label="消す"
            aria-pressed={eraseIsActive}
            title="消す"
            onClick={selectEraseTool}
            disabled={disabled}
          >
            <Eraser aria-hidden="true" size={20} weight="bold" />
          </button>
        </div>

        <div className="tool-rail-item">
          <button className={`tool-rail-button${grabIsActive ? " is-active" : ""}`} type="button" aria-label="掴む" aria-pressed={grabIsActive} title="掴む" onClick={selectGrabTool} disabled={disabled}>
            <HandGrabbing aria-hidden="true" size={20} weight="bold" />
          </button>
        </div>

      </div>
      <div className="tool-rail-footer">
        <button
          className="tool-rail-button tool-rail-new-button"
          type="button"
          aria-label="新規作成"
          title="新規作成"
          onClick={onCreateProject}
          disabled={disabled || createProjectDisabled || !onCreateProject}
        >
          <PlusCircle aria-hidden="true" size={20} weight="bold" />
        </button>
      </div>
    </aside>
  );

  return {
    strokeRadius: cellPaintRadiusForRange(strokeRange),
    eraseRadius: cellPaintRadiusForRange(strokeRange),
    regionColor: effectiveRegionColor,
    toolPalette,
  };
}
