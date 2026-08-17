import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject, type ReactNode } from "react";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { HandGrabbing } from "@phosphor-icons/react/dist/csr/HandGrabbing";
import { Magnet } from "@phosphor-icons/react/dist/csr/Magnet";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { CELL_PAINT_RANGE_MIN, cellPaintRadiusForRange } from "../../map/MapAdapter";
import type { LayerId, ObjectKind } from "../../backend";

const REGION_FLYOUT_ID = "map-region-flyout";
const ERASE_FLYOUT_ID = "map-eraser-flyout";
const OBJECT_KINDS = ["city", "text", "mountain", "forest"] as const;

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
export function usePaletteFlyouts({ hostRef, mode, activeLayer, strokeRange = CELL_PAINT_RANGE_MIN, regionColor, onToolChange, onRegionColorChange, onCreateProject, createProjectDisabled = false }: PaletteFlyoutOptions): PaletteFlyoutState {
  const paletteRef = useRef<HTMLElement>(null);
  const [eraseFlyoutOpen, setEraseFlyoutOpen] = useState(false);
  const [regionFlyoutOpen, setRegionFlyoutOpen] = useState(false);
  const [localRegionColor, setLocalRegionColor] = useState("#7A6FA8");
  const effectiveRegionColor = regionColor ?? localRegionColor;

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
    setRegionFlyoutOpen((current) => !current);
    setEraseFlyoutOpen(false);
    event.stopPropagation();
  };

  const openEraseFlyout = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onToolChange?.("erase");
    setEraseFlyoutOpen((current) => !current);
    setRegionFlyoutOpen(false);
    event.stopPropagation();
  };

  const selectGrabTool = (): void => {
    onToolChange?.(activeLayer === "object" ? "select" : "grab");
    closeFlyouts();
  };

  const selectShapeTool = (): void => {
    onToolChange?.("shape");
    closeFlyouts();
  };

  const drawIsActive = activeLayer === "terrain"
    ? mode === "cell-select"
    : activeLayer === "region"
      ? mode === "cell-region"
      : OBJECT_KINDS.includes(mode as ObjectKind);
  const eraseIsActive = mode === "cell-erase" || (activeLayer === "object" && mode === "erase");
  const grabIsActive = activeLayer === "object" ? mode === "pan" : mode === "grab";
  const shapeIsActive = activeLayer === "region" && mode === "shape";

  const toolPalette: ReactNode = (
    <aside ref={paletteRef} className="tool-rail" aria-label="地図ツールレール">
      <div className="tool-rail-tools" role="toolbar" aria-label="地図ツール">
        <div className="tool-rail-item">
          <button
            className={`tool-rail-button${drawIsActive ? " is-active" : ""}`}
            type="button"
            aria-label="描く"
            aria-pressed={drawIsActive}
            aria-haspopup={activeLayer === "region" ? "true" : undefined}
            aria-expanded={activeLayer === "region" ? regionFlyoutOpen : undefined}
            aria-controls={activeLayer === "region" ? REGION_FLYOUT_ID : undefined}
            title="描く"
            onClick={activeLayer === "region" ? openRegionFlyout : selectPaintTool}
          >
            <PencilSimple aria-hidden="true" size={20} weight="bold" />
          </button>
          {activeLayer === "region" && regionFlyoutOpen ? (
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

        {activeLayer === "region" ? (
          <div className="tool-rail-item">
            <button className={`tool-rail-button${shapeIsActive ? " is-active" : ""}`} type="button" aria-label="シェイピング" aria-pressed={shapeIsActive} title="シェイピング" onClick={selectShapeTool}>
              <Magnet aria-hidden="true" size={20} weight="bold" />
            </button>
          </div>
        ) : null}
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
