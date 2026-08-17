import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MapObject } from "../backend";
import { cellPaintRadiusForRange, type RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas } from "./MapCanvas";
import "../styles.css";

const createPaletteRenderer = (): RealmMapRenderer => ({
  getZoom: vi.fn(() => 1),
  setZoom: vi.fn(),
  resetView: vi.fn(),
  setObjects: vi.fn(),
  setActiveLayer: vi.fn(),
  setTheme: vi.fn(),
  setThemeOverrides: vi.fn(),
  setGridVisible: vi.fn(),
  setGridOptions: vi.fn(),
  setCellGridVisible: vi.fn(),
  setCellGridOptions: vi.fn(),
  setPresentationMode: vi.fn(),
  setAssets: vi.fn(),
  setObjectKindVisibility: vi.fn(),
  setMode: vi.fn(),
  setDrawingOptions: vi.fn(),
  setCellPaintRadius: vi.fn(),
  setSelected: vi.fn(),
  setSelectedObjects: vi.fn(),
  setSelectedCells: vi.fn(),
  setCellAttributes: vi.fn(),
  setCellEraseRadius: vi.fn(),
  onDraw: vi.fn(() => vi.fn()),
  onSelectObjects: vi.fn(() => vi.fn()),
  onSelect: vi.fn(() => vi.fn()),
  onCellSelect: vi.fn(() => vi.fn()),
  onModifyObjects: vi.fn(() => vi.fn()),
  onModify: vi.fn(() => vi.fn()),
  onEraseObjects: vi.fn(() => vi.fn()),
  onErase: vi.fn(() => vi.fn()),
  onLayerShift: vi.fn(() => vi.fn()),
  onError: vi.fn(() => vi.fn()),
  onZoomChange: vi.fn(() => vi.fn()),
  updateSize: vi.fn(),
  exportRaster: vi.fn(async () => ({ bytes: [], width: 1, height: 1 })),
  dispose: vi.fn(),
});

describe("MapCanvas", () => {
  it("keeps the app version out of the tool rail", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    expect(screen.queryByLabelText(/バージョン/u)).not.toBeInTheDocument();
  });

  it("selects one of ten circular region colors through an accessible flyout", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    const onRegionColorChange = vi.fn();
    render(<MapCanvas activeLayer="region" mode="cell-region" onZoomChange={vi.fn()} onToolChange={onToolChange} onRegionColorChange={onRegionColorChange} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    expect(map).toHaveClass("map-canvas-mode-cell-region", "map-canvas-draw");
    expect(map.parentElement).toHaveClass("map-canvas-frame");
    expect(screen.getByText("自由線で囲んだ内側の六角セルを領域として塗ります。色を選んで描き、Escapeで取り消せます。端の大きさを変えるときは掴むに切り替えます。")).toBeInTheDocument();
    const regionButton = screen.getByRole("button", { name: "範囲描画" });
    expect(regionButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(regionButton);
    expect(onToolChange).toHaveBeenCalledWith("area");
    expect(screen.getByRole("group", { name: "領域の色" })).toBeInTheDocument();
    const colors = screen.getAllByRole("radio");
    expect(colors).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "領域色 8 #7A6FA8" })).toBeChecked();
    const color = screen.getByRole("radio", { name: "領域色 6 #2468AC" });
    expect(color.nextElementSibling).toHaveClass("region-color-swatch");
    fireEvent.click(color);
    expect(onRegionColorChange).toHaveBeenCalledWith("#2468AC");
  });

  it("keeps the tool rail available before the first map gesture after selecting grab", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    const onMapPointerDown = vi.fn();
    render(<MapCanvas onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    map.addEventListener("pointerdown", onMapPointerDown);
    fireEvent.click(screen.getByRole("button", { name: "掴む" }));

    expect(onToolChange).toHaveBeenCalledWith("grab");
    expect(screen.getByRole("complementary", { name: "地図ツールレール" })).toBeInTheDocument();
    fireEvent.pointerDown(map, { button: 0 });
    expect(onMapPointerDown).toHaveBeenCalledOnce();
  });

  it("renders a fixed icon-only rail with grid, area, erase, and grab", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    const palette = screen.getByRole("complementary", { name: "地図ツールレール" });
    expect(palette).toHaveClass("tool-rail");
    expect(screen.getAllByRole("button").filter((button) => button.classList.contains("tool-rail-button"))).toHaveLength(5);
    expect(palette.querySelectorAll(".tool-rail-tools .tool-rail-button > svg")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "グリッド描画" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "範囲描画" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "消す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "掴む" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新規作成" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新規作成" }).parentElement).toHaveClass("tool-rail-footer");
    expect(screen.queryByText("地形を描く")).not.toBeInTheDocument();
    expect(screen.queryByText("地形消しゴム")).not.toBeInTheDocument();
    expect(screen.queryByText("グラブ")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "領域の色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "消す対象" })).not.toBeInTheDocument();
  });

  it("keeps contextual settings available from the icon rail", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas activeLayer="region" mode="cell-region" onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    fireEvent.click(screen.getByRole("button", { name: "グリッド描画" }));
    expect(screen.getAllByRole("radio")).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "消す" }));
    expect(screen.getByRole("group", { name: "消す対象" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "領域の色" })).not.toBeInTheDocument();
  });

  it("exposes shaping for the region layer", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    const { rerender } = render(<MapCanvas activeLayer="region" onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);

    const shapeButton = screen.getByRole("button", { name: "シェイピング" });
    expect(shapeButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(shapeButton);
    expect(onToolChange).toHaveBeenCalledWith("shape");
    rerender(<MapCanvas activeLayer="region" mode="shape" onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);
    expect(screen.getByRole("button", { name: "シェイピング" })).toHaveAttribute("aria-pressed", "true");
  });

  it("calls the new project handler from the bottom rail action", () => {
    const renderer = createPaletteRenderer();
    const onCreateProject = vi.fn();
    render(<MapCanvas onZoomChange={vi.fn()} onCreateProject={onCreateProject} createRenderer={() => renderer} />);

    const button = screen.getByRole("button", { name: "新規作成" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it("maps the grab icon to object selection on the object layer", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    render(<MapCanvas activeLayer="object" mode="city" onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);

    expect(screen.getAllByRole("button").filter((button) => button.classList.contains("tool-rail-button"))).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "掴む" }));
    expect(onToolChange).toHaveBeenCalledWith("select");
    expect(screen.getByRole("button", { name: "描く" })).toBeInTheDocument();
  });

  it("renders the controlled renderer preview without map-frame controls", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas mode="cell-select" preview showCellGrid onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    expect(renderer.setPresentationMode).toHaveBeenLastCalledWith(true);
    expect(renderer.setMode).toHaveBeenLastCalledWith("pan");
    expect(screen.queryByRole("button", { name: "レンダリングプレビューを表示" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編集画面に戻る" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "地図ツールレール" })).not.toBeInTheDocument();
    expect(screen.getByText("レンダリングプレビューを表示しています。編集はできません。ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。")).toBeInTheDocument();
    expect(map).toHaveClass("map-canvas-mode-pan");
  });

  it("cleans each adapter instance exactly once across StrictMode effect replay", () => {
    const firstRenderer = createPaletteRenderer();
    const secondRenderer = createPaletteRenderer();
    const renderers = [firstRenderer, secondRenderer];
    const createRenderer = vi.fn(() => renderers.shift()!);
    const exporterEvents: string[] = [];
    const { unmount } = render(
      <StrictMode>
        <MapCanvas
          onZoomChange={vi.fn()}
          onExporterReady={(exporter) => exporterEvents.push(exporter ? "ready" : "clear")}
          createRenderer={createRenderer}
        />
      </StrictMode>,
    );

    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(firstRenderer.dispose).toHaveBeenCalledOnce();
    expect(secondRenderer.dispose).not.toHaveBeenCalled();
    unmount();
    expect(firstRenderer.dispose).toHaveBeenCalledOnce();
    expect(secondRenderer.dispose).toHaveBeenCalledOnce();
    expect(exporterEvents).toEqual(["ready", "clear", "ready", "clear"]);
  });

  it("does not resync semantically unchanged renderer collections or grid options", () => {
    const renderer = createPaletteRenderer();
    const createRenderer = vi.fn(() => renderer);
    const object: MapObject = {
      id: "city-1",
      kind: "city",
      label: "City",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { labelColor: "#102030" },
      zIndex: 2,
      locked: false,
    };
    const firstGrid = { kind: "hex" as const, color: "#102030", width: 1, spacingDegrees: 12 };
    const firstCellGrid = { color: "#102030", width: 1 };
    const { rerender } = render(
      <MapCanvas
        objects={[object]}
        gridOptions={firstGrid}
        cellGridOptions={firstCellGrid}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    const initialCalls = {
      features: (renderer.setObjects as ReturnType<typeof vi.fn>).mock.calls.length,
      grid: (renderer.setGridOptions as ReturnType<typeof vi.fn>).mock.calls.length,
      cellGrid: (renderer.setCellGridOptions as ReturnType<typeof vi.fn>).mock.calls.length,
    };

    rerender(
      <MapCanvas
        objects={[{ ...object, properties: { labelColor: "#102030" } }]}
        gridOptions={{ ...firstGrid }}
        cellGridOptions={{ ...firstCellGrid }}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    expect(renderer.setObjects).toHaveBeenCalledTimes(initialCalls.features);
    expect(renderer.setGridOptions).toHaveBeenCalledTimes(initialCalls.grid);
    expect(renderer.setCellGridOptions).toHaveBeenCalledTimes(initialCalls.cellGrid);

    rerender(
      <MapCanvas
        objects={[{ ...object, label: "Updated city" }]}
        gridOptions={{ ...firstGrid, spacingDegrees: 15 }}
        cellGridOptions={{ ...firstCellGrid, width: 1.5 }}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    expect(renderer.setObjects).toHaveBeenCalledTimes(initialCalls.features + 1);
    expect(renderer.setGridOptions).toHaveBeenCalledTimes(initialCalls.grid + 1);
    expect(renderer.setCellGridOptions).toHaveBeenCalledTimes(initialCalls.cellGrid + 1);
  });

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
      setObjects: vi.fn(),
      setTheme: vi.fn(),
      setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(),
      setGridOptions: vi.fn(),
      setCellGridVisible: vi.fn(),
      setCellGridOptions: vi.fn(),
      setAssets: vi.fn(),
      setActiveLayer: vi.fn(), setObjectKindVisibility: vi.fn(),
      setMode: vi.fn(),
      setDrawingOptions: vi.fn(),
      setCellPaintRadius: vi.fn(),
      setCellEraseRadius: vi.fn(),
      setSelected: vi.fn(),
      setSelectedObjects: vi.fn(),
      setSelectedCells: vi.fn(),
      setCellAttributes: vi.fn(),
      onDraw: vi.fn((listener) => { drawListener = listener as typeof drawListener; return vi.fn(); }),
      onSelectObjects: vi.fn((listener) => { selectFeaturesListener = listener as typeof selectFeaturesListener; return vi.fn(); }),
      onSelect: vi.fn(() => vi.fn()),
      onCellSelect: vi.fn((listener) => { cellSelectListener = listener; return vi.fn(); }),
      onModifyObjects: vi.fn((listener) => { modifyFeaturesListener = listener as typeof modifyFeaturesListener; return vi.fn(); }),
      onModify: vi.fn(() => vi.fn()),
      onEraseObjects: vi.fn(() => vi.fn()),
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
    const palette = screen.getByRole("complementary", { name: "地図ツールレール" });
    expect(palette).toHaveClass("tool-rail");
    expect(screen.getAllByRole("button").filter((button) => button.classList.contains("tool-rail-button"))).toHaveLength(5);
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    expect(document.querySelector(".radial-palette")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "消す" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "グリッド描画" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "地図ツール" })).toBeInTheDocument();
    const onMapPointerDown = vi.fn();
    map.addEventListener("pointerdown", onMapPointerDown);
    const terrainButton = screen.getByRole("button", { name: "グリッド描画" });
    fireEvent.pointerEnter(terrainButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    fireEvent.click(terrainButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "描画と削除の太さ" })).not.toBeInTheDocument();
    const eraserButton = screen.getByRole("button", { name: "消す" });
    fireEvent.click(eraserButton);
    const eraseFlyout = screen.getByRole("group", { name: "消す対象" });
    fireEvent.pointerEnter(eraseFlyout);
    fireEvent.pointerDown(eraseFlyout);
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.pointerDown(map, { button: 0 });
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "消す対象" })).not.toBeInTheDocument();
    rerender(<MapCanvas mode="cell-select" strokeRange={3} zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(cellPaintRadiusForRange(3));
    rerender(<MapCanvas mode="cell-erase" strokeRange={3} zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(0);
    expect(renderer.setCellEraseRadius).toHaveBeenLastCalledWith(cellPaintRadiusForRange(3));
    expect(screen.getByRole("complementary", { name: "地図ツールレール" })).toBeInTheDocument();
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
    expect(screen.getByText("六角グリッドを一時的な選択範囲として押したままなぞります。選択結果はPolygonへ変換して1回で保存します。ホイールを押したままドラッグすると地図を移動できます。Escapeで選択を取り消せます。")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-draw");
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-mode-cell-select");
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-select");

    rerender(<MapCanvas mode="grab" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地形または領域の正確なPolygonの辺・頂点をつまみ、連続的に広げたり狭めたりできます。図形の内側をつまむと領域全体を移動します。グリッドへの吸着は離したときに行い、pointermove中は保存しません。pointercancel、Escape、フォーカス喪失で取り消せます。"))
      .toBeInTheDocument();

    rerender(<MapCanvas mode="cell-erase" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地形だけを六角セル単位で消去します。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。")).toBeInTheDocument();
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
    expect(screen.getByText("六角グリッドを一時的な選択範囲として押したままなぞります。選択結果はPolygonへ変換して1回で保存します。ホイールを押したままドラッグすると地図を移動できます。Escapeで選択を取り消せます。")).toBeInTheDocument();

    rerender(<MapCanvas mode="pan" disabled zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("ドラッグまたはホイールを押したままドラッグで地図を移動し、ホイールで拡大縮小します。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("pan");
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-disabled");
    unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("shows only the active layer as the eraser target", () => {
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => 1), setZoom: vi.fn(), resetView: vi.fn(), setObjects: vi.fn(), setTheme: vi.fn(), setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(), setGridOptions: vi.fn(), setCellGridVisible: vi.fn(), setCellGridOptions: vi.fn(), setAssets: vi.fn(), setActiveLayer: vi.fn(), setObjectKindVisibility: vi.fn(),
      setMode: vi.fn(), setDrawingOptions: vi.fn(), setCellPaintRadius: vi.fn(), setCellEraseRadius: vi.fn(), setSelected: vi.fn(), setSelectedObjects: vi.fn(), setSelectedCells: vi.fn(), setCellAttributes: vi.fn(),
      onDraw: vi.fn(() => vi.fn()), onSelectObjects: vi.fn(() => vi.fn()), onSelect: vi.fn(() => vi.fn()), onCellSelect: vi.fn(() => vi.fn()), onModifyObjects: vi.fn(() => vi.fn()), onModify: vi.fn(() => vi.fn()), onEraseObjects: vi.fn(() => vi.fn()), onErase: vi.fn(() => vi.fn()), onLayerShift: vi.fn(() => vi.fn()), onError: vi.fn(() => vi.fn()), onZoomChange: vi.fn(() => vi.fn()), updateSize: vi.fn(), exportRaster: vi.fn(async () => ({ bytes: [], width: 1, height: 1 })), dispose: vi.fn(),
    };
    const onToolChange = vi.fn();
    render(<MapCanvas activeLayer="region" onToolChange={onToolChange} onZoomChange={vi.fn()} createRenderer={() => renderer} />);
    fireEvent.contextMenu(screen.getByRole("region", { name: "世界地図" }), { clientX: 100, clientY: 100 });
    const eraserButton = screen.getByRole("button", { name: "消す" });
    expect(eraserButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eraserButton);
    expect(onToolChange).toHaveBeenCalledWith("erase");
    expect(eraserButton).toHaveAttribute("aria-expanded", "true");
    const eraseFlyout = screen.getByRole("group", { name: "消す対象" });
    expect(eraseFlyout).toHaveClass("tool-flyout-erase");
    expect(screen.getByRole("status", { name: "削除対象" })).toHaveTextContent("領域だけ");
    expect(screen.getByRole("button", { name: "グリッド描画" })).toHaveAttribute("aria-label", "グリッド描画");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
