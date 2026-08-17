import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import { contentKindOf, type ActiveKind, type LayerId, type ObjectKind } from "../../backend";

const REGION_FLYOUT_ID = "map-region-flyout";
const ERASE_FLYOUT_ID = "map-eraser-flyout";
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
  regionColor?: string | undefined;
  onToolChange: ((tool: "grid" | "area" | "terrain" | "region" | "object" | "select" | "erase" | "grab" | "shape") => void) | undefined;
  onRegionColorChange: ((color: string) => void) | undefined;
  onCreateProject?: (() => void) | undefined;
  createProjectDisabled?: boolean | undefined;
};

export type PaletteFlyoutState = {
  strokeRadius: number;
  eraseRadius: number;
  regionColor: string;
  toolPalette: ReactNode;
};

/** Owns the fixed left tool rail and its contextual flyouts. */
export function usePaletteFlyouts({ hostRef, mode, activeLayer, activeKind, strokeRange = CELL_PAINT_RANGE_MIN, regionColor, onToolChange, onRegionColorChange, onCreateProject, createProjectDisabled = false }: PaletteFlyoutOptions): PaletteFlyoutState {
  const paletteRef = useRef<HTMLElement>(null);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [regionFlyoutTool, setRegionFlyoutTool] = useState<CellPaintTool | null>(null);
  const [localRegionColor, setLocalRegionColor] = useState("#7A6FA8");
  const effectiveRegionColor = regionColor ?? localRegionColor;

  const closeFlyouts = (): void => {
    setEraseFlyoutOpen(false);
    setRegionFlyoutTool(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeFlyouts();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof window.Node)) return;
      if (paletteRef.current?.contains(event.target)) return;
      if (!eraseFlyoutOpen && regionFlyoutTool === null) return;
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
  }, [eraseFlyoutOpen, hostRef, regionFlyoutTool]);

  const kind: ActiveKind = activeKind ?? (activeLayer === "terrain" || activeLayer === "region" ? activeLayer : "terrain");
  const contentKind = contentKindOf(kind);
  const isObjectKind = contentKind === "object";
  const layerLabel = kind === "terrain" ? "地形" : kind === "region" ? "領域" : "オブジェクト";
  const toggleCellPaintTool = (tool: CellPaintTool, event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.(tool);
    if (!isObjectKind) {
      setRegionFlyoutTool((current) => current === tool ? null : tool);
      setEraseFlyoutOpen(false);
    } else closeFlyouts();
    event.stopPropagation();
  };

  const selectObjectDrawTool = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("object");
    closeFlyouts();
    event.stopPropagation();
  };

  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("erase");
    setEraseFlyoutOpen((current) => !current);
    setRegionFlyoutTool(null);
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
  const drawContextFlyout: ReactNode = regionFlyoutTool !== null && !isObjectKind ? (
    <div id={REGION_FLYOUT_ID} className="tool-flyout tool-flyout-region" role="group" aria-label="描くの設定">
      <span className="tool-flyout-label">描く方法</span>
      <div className="draw-method-options" role="group" aria-label="描く方法">
        <button type="button" className={regionFlyoutTool === "grid" ? "is-active" : ""} onClick={() => { onToolChange?.("grid"); setRegionFlyoutTool("grid"); }}>グリッド</button>
        <button type="button" className={regionFlyoutTool === "area" ? "is-active" : ""} onClick={() => { onToolChange?.("area"); setRegionFlyoutTool("area"); }}>範囲</button>
      </div>
      {kind === "region" ? <div className="region-color-options" role="radiogroup" aria-label="領域色の候補">{REGION_COLORS.map((color, index) => <label className="region-color-option" key={color} title={`領域色 ${index + 1} ${color}`}><input type="radio" name="map-region-color" value={color} checked={effectiveRegionColor === color} aria-label={`領域色 ${index + 1} ${color}`} onChange={() => { setLocalRegionColor(color); onRegionColorChange?.(color); }} /><span className="region-color-swatch" aria-hidden="true" style={{ backgroundColor: color }} /></label>)}</div> : null}
    </div>
  ) : null;
  const toolPalette: ReactNode = (
    <aside ref={paletteRef} className="tool-rail" aria-label="地図ツールレール">
      <div className="tool-rail-tools" role="toolbar" aria-label="地図ツール">
        <div className="tool-rail-item">
          <button className={`tool-rail-button${gridIsActive || areaIsActive ? " is-active" : ""}`} type="button" aria-label="描く" aria-pressed={gridIsActive || areaIsActive} aria-haspopup={!isObjectKind ? "true" : undefined} aria-expanded={!isObjectKind ? regionFlyoutTool !== null : undefined} aria-controls={!isObjectKind ? REGION_FLYOUT_ID : undefined} title="描く" onClick={(event) => isObjectKind ? selectObjectDrawTool(event) : toggleCellPaintTool(regionFlyoutTool === "area" ? "area" : "grid", event)}>
            <PencilSimple aria-hidden="true" size={20} weight="bold" />
          </button>
          {drawContextFlyout}
        </div>

        <div className="tool-rail-item">
          <button
            className={`tool-rail-button${eraseIsActive ? " is-active" : ""}`}
            type="button"
            aria-label="消す"
            aria-pressed={eraseIsActive}
            aria-haspopup="true"
            aria-expanded={eraseFlyoutOpen}
            aria-controls={ERASE_FLYOUT_ID}
            title="消す"
            onClick={openEraseFlyout}
          >
            <Eraser aria-hidden="true" size={20} weight="bold" />
          </button>
          {eraseFlyoutOpen ? (
            <div id={ERASE_FLYOUT_ID} className="tool-flyout tool-flyout-erase" role="group" aria-label="消す対象">
              <div className="eraser-targets" role="status" aria-label="削除対象"><span className="tool-flyout-label">削除対象</span><strong>{layerLabel}だけ</strong></div>
            </div>
          ) : null}
        </div>

        <div className="tool-rail-item">
          <button className={`tool-rail-button${grabIsActive ? " is-active" : ""}`} type="button" aria-label="掴む" aria-pressed={grabIsActive} title="掴む" onClick={selectGrabTool}>
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
          disabled={createProjectDisabled || !onCreateProject}
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
