import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas } from "./MapCanvas";
import { positionPaletteFlyout } from "./paletteFlyout";
import "../styles.css";

const createPaletteRenderer = (): RealmMapRenderer => ({
  getZoom: vi.fn(() => 1),
  setZoom: vi.fn(),
  resetView: vi.fn(),
  setFeatures: vi.fn(),
  setTheme: vi.fn(),
  setThemeOverrides: vi.fn(),
  setGridVisible: vi.fn(),
  setGridOptions: vi.fn(),
  setCellGridVisible: vi.fn(),
  setCellGridOptions: vi.fn(),
  setAssets: vi.fn(),
  setLayerVisibility: vi.fn(),
  setMode: vi.fn(),
  setDrawingOptions: vi.fn(),
  setCellPaintRadius: vi.fn(),
  setSelected: vi.fn(),
  setSelectedFeatures: vi.fn(),
  setSelectedCells: vi.fn(),
  setCellAttributes: vi.fn(),
  setCellEraseOptions: vi.fn(),
  onDraw: vi.fn(() => vi.fn()),
  onSelectFeatures: vi.fn(() => vi.fn()),
  onSelect: vi.fn(() => vi.fn()),
  onCellSelect: vi.fn(() => vi.fn()),
  onModifyFeatures: vi.fn(() => vi.fn()),
  onModify: vi.fn(() => vi.fn()),
  onEraseFeatures: vi.fn(() => vi.fn()),
  onErase: vi.fn(() => vi.fn()),
  onLayerShift: vi.fn(() => vi.fn()),
  onError: vi.fn(() => vi.fn()),
  onZoomChange: vi.fn(() => vi.fn()),
  updateSize: vi.fn(),
  exportRaster: vi.fn(async () => ({ bytes: [], width: 1, height: 1 })),
  dispose: vi.fn(),
});

const rect = (left: number, top: number, right: number, bottom: number): DOMRect => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
  x: left, y: top, toJSON: () => ({}),
} as DOMRect);

describe("positionPaletteFlyout", () => {
  const palette = { left: 100, top: 100, right: 200, bottom: 200 };
  const size = { width: 176, height: 58 };
  it.each([
    ["right", palette, { left: 210, top: 130, right: 238, bottom: 158 }, { width: 500, height: 400 }],
    ["left", { left: 250, top: 100, right: 350, bottom: 200 }, { left: 250, top: 130, right: 278, bottom: 158 }, { width: 390, height: 400 }],
    ["bottom", palette, { left: 130, top: 180, right: 158, bottom: 208 }, { width: 300, height: 300 }],
    ["top", palette, { left: 130, top: 102, right: 158, bottom: 130 }, { width: 300, height: 180 }],
  ])("chooses %s outside the palette with a gap", (side, paletteRect, anchor, viewport) => {
    const position = positionPaletteFlyout(paletteRect, anchor, viewport, size);
    expect(position.side).toBe(side);
    expect(position.left >= 0 && position.top >= 0).toBe(true);
    expect(position.left + size.width <= viewport.width).toBe(true);
    expect(position.top + size.height <= viewport.height).toBe(true);
    expect(position.left >= paletteRect.right || position.left + size.width <= paletteRect.left || position.top >= paletteRect.bottom || position.top + size.height <= paletteRect.top).toBe(true);
  });
});

describe("MapCanvas", () => {
  it("drives the canvas only through the replaceable renderer contract", () => {
    vi.useFakeTimers();
    let zoom = 1;
    let zoomListener: ((nextZoom: number) => void) | null = null;
    let drawListener: ((geometry: never) => void) | null = null;
    let selectFeaturesListener: ((ids: readonly string[]) => void) | null = null;
    let cellSelectListener: ((ids: readonly string[]) => void) | null = null;
    let modifyFeaturesListener: ((changes: readonly { id: string; geometry: never }[]) => void) | null = null;
    let errorListener: ((code: "drawing_self_intersection") => void) | null = null;
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => zoom),
      setZoom: vi.fn((nextZoom) => { zoom = nextZoom; }),
      resetView: vi.fn(),
      setFeatures: vi.fn(),
      setTheme: vi.fn(),
      setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(),
      setGridOptions: vi.fn(),
      setCellGridVisible: vi.fn(),
      setCellGridOptions: vi.fn(),
      setAssets: vi.fn(),
      setLayerVisibility: vi.fn(),
      setMode: vi.fn(),
      setDrawingOptions: vi.fn(),
      setCellPaintRadius: vi.fn(),
      setSelected: vi.fn(),
      setSelectedFeatures: vi.fn(),
      setSelectedCells: vi.fn(),
      setCellAttributes: vi.fn(),
      onDraw: vi.fn((listener) => { drawListener = listener as typeof drawListener; return vi.fn(); }),
      onSelectFeatures: vi.fn((listener) => { selectFeaturesListener = listener as typeof selectFeaturesListener; return vi.fn(); }),
      onSelect: vi.fn(() => vi.fn()),
      onCellSelect: vi.fn((listener) => { cellSelectListener = listener; return vi.fn(); }),
      onModifyFeatures: vi.fn((listener) => { modifyFeaturesListener = listener as typeof modifyFeaturesListener; return vi.fn(); }),
      onModify: vi.fn(() => vi.fn()),
      onEraseFeatures: vi.fn(() => vi.fn()),
      onErase: vi.fn(() => vi.fn()),
      onLayerShift: vi.fn(() => vi.fn()),
      onError: vi.fn((listener) => { errorListener = listener as typeof errorListener; return vi.fn(); }),
      onZoomChange: vi.fn((listener) => {
        zoomListener = listener;
        return vi.fn();
      }),
      updateSize: vi.fn(),
      exportRaster: vi.fn(async () => ({ bytes: [1], width: 1, height: 1 })),
      dispose: vi.fn(),
    };
    const createRenderer = vi.fn(() => renderer);
    const onZoomChange = vi.fn();
    const onError = vi.fn();
    const onCellSelect = vi.fn();
    const { rerender, unmount } = render(
      <MapCanvas zoom={3} onZoomChange={onZoomChange} onError={onError} onCellSelect={onCellSelect} createRenderer={createRenderer} />,
    );

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(renderer.setZoom).toHaveBeenCalledWith(3);
    expect(onZoomChange).toHaveBeenLastCalledWith(3);
    expect(renderer.setGridVisible).toHaveBeenCalledWith(true);
    expect(renderer.setCellGridVisible).toHaveBeenCalledWith(false);
    expect(renderer.setCellGridOptions).toHaveBeenCalledWith({ color: "#d1d7dc", width: 0.65 });
    expect(renderer.setThemeOverrides).toHaveBeenCalledWith({});
    expect(renderer.setGridOptions).toHaveBeenCalledWith({ kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 });
    expect(renderer.setDrawingOptions).toHaveBeenCalledWith({ gesture: "freehand", smoothingPasses: 1, snapAngleDegrees: null });
    expect(renderer.setCellPaintRadius).toHaveBeenCalledWith(0);
    expect(renderer.setCellAttributes).toHaveBeenCalledWith([]);
    expect(renderer.setSelectedCells).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("group", { name: "現在の地図操作" })).not.toBeInTheDocument();
    const map = screen.getByRole("region", { name: "世界地図" });
    expect(map).toHaveClass("map-canvas-mode-pan");
    expect(map).not.toHaveClass("map-canvas-disabled");
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    expect(document.querySelector(".radial-palette")).toHaveStyle({ left: "120px", top: "80px" });
    expect(document.querySelector(".radial-palette")).toHaveClass("radial-palette-opening");
    expect(document.querySelectorAll(".radial-palette-slot")).toHaveLength(2);
    expect(document.querySelectorAll(".radial-palette-slot[aria-hidden='true']")).toHaveLength(0);
    expect(document.querySelector(".radial-palette")?.textContent).not.toContain("描画範囲");
    expect(document.querySelector(".radial-palette-range-tool .radial-palette-range-button")?.textContent).toBe("");
    expect(screen.getByRole("button", { name: "消しゴム" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "地形を描く（太さ調整）" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "地図ツールパレット" })).toBeInTheDocument();
    const onMapPointerDown = vi.fn();
    map.addEventListener("pointerdown", onMapPointerDown);
    const rangeButton = screen.getByRole("button", { name: "地形を描く（太さ調整）" });
    fireEvent.pointerEnter(rangeButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    fireEvent.click(rangeButton);
    expect(document.querySelector(".palette-flyout")).toBeInTheDocument();
    let rangeSlider = screen.getByRole("slider", { name: "描画範囲" });
    expect(rangeSlider).toHaveAttribute("aria-valuetext", "描画範囲1セル");
    fireEvent.pointerLeave(rangeButton);
    expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();
    const rangeFlyout = screen.getByRole("group", { name: "描画範囲の調整" });
    fireEvent.pointerEnter(rangeFlyout);
    fireEvent.pointerDown(rangeFlyout);
    fireEvent.change(rangeSlider, { target: { value: "3" } });
    expect(rangeSlider).toHaveAttribute("aria-valuetext", "描画範囲3セル");
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(0);
    fireEvent.click(rangeButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    fireEvent.click(rangeButton);
    expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();
    fireEvent.keyDown(rangeButton, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    fireEvent.focus(rangeButton);
    fireEvent.keyDown(rangeButton, { key: "Enter" });
    fireEvent.click(rangeButton);
    expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();
    rangeSlider = screen.getByRole("slider", { name: "描画範囲" });
    rerender(<MapCanvas mode="cell-select" zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(2);
    rerender(<MapCanvas mode="cell-erase" zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(0);
    const rangePopover = screen.getByRole("group", { name: "描画範囲の調整" });
    fireEvent.pointerEnter(rangePopover);
    expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();
    fireEvent.pointerDown(rangeSlider);
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    act(() => { vi.advanceTimersByTime(360); });
    expect(document.querySelector(".radial-palette")).toHaveClass("radial-palette-open");
    fireEvent.pointerDown(document.querySelector(".radial-palette") as Element);
    expect(document.querySelector(".radial-palette")).toBeInTheDocument();
    fireEvent.pointerDown(map, { button: 0 });
    expect(document.querySelector(".radial-palette")).toHaveClass("radial-palette-closing");
    act(() => { vi.advanceTimersByTime(360); });
    expect(document.querySelector(".radial-palette")).not.toBeInTheDocument();
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(360); });
    expect(document.querySelector(".radial-palette")).not.toBeInTheDocument();
    (drawListener as ((geometry: never) => void) | null)?.({} as never);
    (selectFeaturesListener as ((ids: readonly string[]) => void) | null)?.([]);
    (cellSelectListener as ((ids: readonly string[]) => void) | null)?.(["2:3"]);
    expect(onCellSelect).toHaveBeenCalledWith(["2:3"]);
    (modifyFeaturesListener as ((changes: readonly { id: string; geometry: never }[]) => void) | null)?.([{ id: "id", geometry: {} as never }]);
    (errorListener as ((code: "drawing_self_intersection") => void) | null)?.("drawing_self_intersection");
    expect(onError).toHaveBeenCalledWith("drawing_self_intersection");
    act(() => { zoomListener?.(4); });
    expect(onZoomChange).toHaveBeenLastCalledWith(4);

    rerender(<MapCanvas zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setZoom).toHaveBeenLastCalledWith(5);
    rerender(<MapCanvas showGrid={false} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setGridVisible).toHaveBeenLastCalledWith(false);
    rerender(<MapCanvas showCellGrid cellGridOptions={{ color: "#102030", width: 1.5 }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setCellGridVisible).toHaveBeenLastCalledWith(true);
    expect(renderer.setCellGridOptions).toHaveBeenLastCalledWith({ color: "#102030", width: 1.5 });
    rerender(<MapCanvas gridOptions={{ kind: "hex", color: "#102030", width: 1.5, spacingDegrees: 12 }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setGridOptions).toHaveBeenLastCalledWith({ kind: "hex", color: "#102030", width: 1.5, spacingDegrees: 12 });
    rerender(<MapCanvas themeOverrides={{ land: "#aabbcc" }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setThemeOverrides).toHaveBeenLastCalledWith({ land: "#aabbcc" });

    rerender(<MapCanvas mode="cell-select" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("六角セルを押したままなぞって選択します。ホイールを押したままドラッグすると地図を移動できます。選択したセルへ地形属性を適用します。Escapeで選択を取り消せます。")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-draw");
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-mode-cell-select");
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-select");

    rerender(<MapCanvas mode="cell-erase" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("六角セルを押したままなぞって地形を消去します。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-erase");
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-mode-cell-erase");

    const syncOrder: string[] = [];
    renderer.setCellAttributes = vi.fn(() => { syncOrder.push("attributes"); });
    renderer.setMode = vi.fn(() => { syncOrder.push("mode"); });
    rerender(<MapCanvas mode="cell-erase" cellAttributes={[{ cellId: "1:1", attribute: "terrain", value: "terrain" }]} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    syncOrder.length = 0;
    rerender(<MapCanvas mode="pan" cellAttributes={[]} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(syncOrder).toEqual(["attributes", "mode"]);

    rerender(<MapCanvas mode="cell-select" drawingOptions={{ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setDrawingOptions).toHaveBeenLastCalledWith({ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 });
    expect(screen.getByText("六角セルを押したままなぞって選択します。ホイールを押したままドラッグすると地図を移動できます。選択したセルへ地形属性を適用します。Escapeで選択を取り消せます。")).toBeInTheDocument();

    rerender(<MapCanvas mode="pan" disabled zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("pan");
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-disabled");
    unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("moves eraser selection into the map palette and exposes mode and thickness controls", () => {
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => 1), setZoom: vi.fn(), resetView: vi.fn(), setFeatures: vi.fn(), setTheme: vi.fn(), setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(), setGridOptions: vi.fn(), setCellGridVisible: vi.fn(), setCellGridOptions: vi.fn(), setAssets: vi.fn(), setLayerVisibility: vi.fn(),
      setMode: vi.fn(), setDrawingOptions: vi.fn(), setCellPaintRadius: vi.fn(), setCellEraseOptions: vi.fn(), setSelected: vi.fn(), setSelectedFeatures: vi.fn(), setSelectedCells: vi.fn(), setCellAttributes: vi.fn(),
      onDraw: vi.fn(() => vi.fn()), onSelectFeatures: vi.fn(() => vi.fn()), onSelect: vi.fn(() => vi.fn()), onCellSelect: vi.fn(() => vi.fn()), onModifyFeatures: vi.fn(() => vi.fn()), onModify: vi.fn(() => vi.fn()), onEraseFeatures: vi.fn(() => vi.fn()), onErase: vi.fn(() => vi.fn()), onLayerShift: vi.fn(() => vi.fn()), onError: vi.fn(() => vi.fn()), onZoomChange: vi.fn(() => vi.fn()), updateSize: vi.fn(), exportRaster: vi.fn(async () => ({ bytes: [], width: 1, height: 1 })), dispose: vi.fn(),
    };
    const onToolChange = vi.fn();
    render(<MapCanvas onToolChange={onToolChange} onZoomChange={vi.fn()} createRenderer={() => renderer} />);
    fireEvent.contextMenu(screen.getByRole("region", { name: "世界地図" }), { clientX: 100, clientY: 100 });
    const eraserButton = screen.getByRole("button", { name: "消しゴム" });
    const paintButton = screen.getByRole("button", { name: "地形を描く（太さ調整）" });
    expect(eraserButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eraserButton);
    expect(onToolChange).toHaveBeenCalledWith("erase");
    expect(eraserButton).toHaveAttribute("aria-expanded", "true");
    const eraseFlyout = screen.getByRole("group", { name: "消しゴムの調整" });
    expect(eraseFlyout).toHaveClass("palette-flyout-erase");
    expect(screen.getByRole("group", { name: "消しゴムの調整" }).querySelector("legend")).toHaveTextContent("性質");
    expect(screen.getByRole("radio", { name: "グリッドごと" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "塊ごと" })).not.toBeChecked();
    fireEvent.click(paintButton);
    fireEvent.click(eraserButton);
    expect(screen.getByRole("group", { name: "消しゴムの調整" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "塊ごと" }));
    fireEvent.change(screen.getByRole("slider", { name: "消しゴムの太さ" }), { target: { value: "4" } });
    expect(renderer.setCellEraseOptions).toHaveBeenLastCalledWith({ mode: "cluster", radiusCells: 3 });
  });

  it("keeps the range flyout in the body portal and repositions it after real rects arrive", () => {
    const renderer = createPaletteRenderer();
    const pendingObservers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    let pendingFrame: FrameRequestCallback | null = null;
    const originalResizeObserver = globalThis.ResizeObserver;

    class ControlledResizeObserver {
      readonly disconnect = vi.fn();

      constructor(_callback: ResizeObserverCallback) {
        pendingObservers.push(this);
      }

      observe(): void { /* The test invokes the callback explicitly. */ }
      unobserve(): void { /* noop */ }
    }

    vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 17;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { unmount } = render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);
    try {
      const map = screen.getByRole("region", { name: "世界地図" });
      fireEvent.contextMenu(map, { clientX: 0, clientY: 0 });
      const palette = screen.getByRole("toolbar", { name: "地図ツールパレット" });
      const rangeButton = screen.getByRole("button", { name: "地形を描く（太さ調整）" });
      vi.spyOn(palette, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));
      vi.spyOn(rangeButton, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));

      // The opening pointer event is inside the palette, so the capture listener
      // must not treat the same interaction as an outside dismissal.
      fireEvent.pointerDown(rangeButton);
      fireEvent.click(rangeButton);
      const flyout = screen.getByRole("group", { name: "描画範囲の調整" });
      expect(flyout.parentElement).toBe(document.body);
      expect(rangeButton.closest(".radial-palette-slot")?.contains(flyout)).toBe(false);
      expect(Number.isFinite(Number.parseFloat(flyout.style.left))).toBe(true);
      expect(Number.isFinite(Number.parseFloat(flyout.style.top))).toBe(true);
      const computed = getComputedStyle(flyout);
      expect(computed.position).toBe("fixed");
      expect(computed.display).toBe("grid");
      expect(computed.visibility).toBe("visible");
      expect(computed.opacity).toBe("1");
      expect(computed.pointerEvents).toBe("auto");
      expect(pendingFrame).not.toBeNull();
      expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();

      const realPalette = rect(100, 100, 200, 200);
      const realAnchor = rect(180, 110, 208, 138);
      vi.spyOn(palette, "getBoundingClientRect").mockReturnValue(realPalette);
      vi.spyOn(rangeButton, "getBoundingClientRect").mockReturnValue(realAnchor);
      vi.spyOn(flyout, "getBoundingClientRect").mockReturnValue(rect(0, 0, 176, 58));
      act(() => { pendingFrame?.(0); });

      const flyoutLeft = Number.parseFloat(flyout.style.left);
      const flyoutTop = Number.parseFloat(flyout.style.top);
      expect(flyoutLeft).toBe(220);
      expect(flyoutTop).toBe(95);
      expect(flyoutLeft >= realPalette.right || flyoutLeft + 176 <= realPalette.left || flyoutTop >= realPalette.bottom || flyoutTop + 58 <= realPalette.top).toBe(true);
      expect(flyoutLeft - realAnchor.right).toBe(12);

      expect(pendingObservers.length).toBeGreaterThan(0);
      fireEvent.pointerLeave(rangeButton);
      fireEvent.pointerEnter(flyout);
      const slider = screen.getByRole("slider", { name: "描画範囲" });
      fireEvent.pointerDown(flyout);
      fireEvent.change(slider, { target: { value: "3" } });
      expect(slider).toHaveAttribute("aria-valuetext", "描画範囲3セル");
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    } finally {
      unmount();
      expect(pendingObservers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
      vi.unstubAllGlobals();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    }
  });

  it("uses a finite viewport fallback when ResizeObserver and rAF are unavailable", () => {
    vi.useFakeTimers();
    const renderer = createPaletteRenderer();
    const originalResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", undefined);

    const { unmount } = render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);
    try {
      const map = screen.getByRole("region", { name: "世界地図" });
      fireEvent.contextMenu(map, { clientX: 0, clientY: 0 });
      fireEvent.click(screen.getByRole("button", { name: "地形を描く（太さ調整）" }));
      const flyout = screen.getByRole("group", { name: "描画範囲の調整" });
      const left = Number.parseFloat(flyout.style.left);
      const top = Number.parseFloat(flyout.style.top);
      expect(Number.isFinite(left)).toBe(true);
      expect(Number.isFinite(top)).toBe(true);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + 176).toBeLessThanOrEqual(window.innerWidth);
      expect(top + 58).toBeLessThanOrEqual(window.innerHeight);
      act(() => { vi.runOnlyPendingTimers(); });
      expect(screen.getByRole("group", { name: "描画範囲の調整" })).toBeInTheDocument();
    } finally {
      unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    }
  });
});
