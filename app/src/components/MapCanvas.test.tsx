import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas } from "./MapCanvas";
import { positionPaletteFlyout } from "./paletteFlyout";

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
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    expect(document.querySelector(".radial-palette")).toHaveStyle({ left: "120px", top: "80px" });
    expect(document.querySelector(".radial-palette")).toHaveClass("radial-palette-opening");
    expect(document.querySelectorAll(".radial-palette-slot")).toHaveLength(9);
    expect(document.querySelector(".radial-palette")?.textContent).not.toContain("描画範囲");
    expect(document.querySelector(".radial-palette-range-tool .radial-palette-range-button")?.textContent).toBe("");
    expect(screen.getByRole("toolbar", { name: "地図ツールパレット" })).toBeInTheDocument();
    const onMapPointerDown = vi.fn();
    map.addEventListener("pointerdown", onMapPointerDown);
    const rangeButton = screen.getByRole("button", { name: "描画範囲" });
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
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-select");

    rerender(<MapCanvas mode="cell-erase" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("六角セルを押したままなぞって地形を消去します。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-erase");

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

    rerender(<MapCanvas mode="pan" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("pan");
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
    fireEvent.click(screen.getByRole("button", { name: "消しゴム" }));
    expect(onToolChange).toHaveBeenCalledWith("erase");
    expect(screen.getByRole("group", { name: "消しゴムの調整" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "塊ごと" }));
    fireEvent.change(screen.getByRole("slider", { name: "消しゴムの太さ" }), { target: { value: "4" } });
    expect(renderer.setCellEraseOptions).toHaveBeenLastCalledWith({ mode: "cluster", radiusCells: 3 });
  });
});
