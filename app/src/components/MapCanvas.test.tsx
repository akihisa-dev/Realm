import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import packageJson from "../../package.json";
import type { RealmFeature } from "../backend";
import { cellPaintRadiusForRange, type RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas } from "./MapCanvas";
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
  setPresentationMode: vi.fn(),
  setAssets: vi.fn(),
  setLayerVisibility: vi.fn(),
  setMode: vi.fn(),
  setDrawingOptions: vi.fn(),
  setCellPaintRadius: vi.fn(),
  setSelected: vi.fn(),
  setSelectedFeatures: vi.fn(),
  setSelectedCells: vi.fn(),
  setCellAttributes: vi.fn(),
  setCellEraseRadius: vi.fn(),
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

describe("MapCanvas", () => {
  it("shows the current app version beside the Realm name", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    const version = screen.getByLabelText(`バージョン ${packageJson.version}`);
    expect(version).toHaveTextContent(packageJson.version);
    expect(version.parentElement).toHaveClass("tool-sidebar-kicker");
  });

  it("selects one of ten circular region colors through an accessible flyout", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    const onRegionColorChange = vi.fn();
    render(<MapCanvas mode="cell-region" onZoomChange={vi.fn()} onToolChange={onToolChange} onRegionColorChange={onRegionColorChange} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    expect(map).toHaveClass("map-canvas-mode-cell-region", "map-canvas-draw");
    expect(map.parentElement).toHaveClass("map-canvas-frame");
    expect(screen.getByText("自由線で囲んだ内側の六角セルを領域として塗ります。色を選んで描き、Escapeで取り消せます。端の大きさを変えるときはグラブに切り替えます。")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "領域の色" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    const regionButton = screen.getByRole("button", { name: "領域" });
    expect(regionButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(regionButton);
    expect(onToolChange).toHaveBeenCalledWith("region");
    const colors = screen.getAllByRole("radio");
    expect(colors).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "領域色 8 #7A6FA8" })).toBeChecked();
    const color = screen.getByRole("radio", { name: "領域色 6 #2468AC" });
    expect(color.nextElementSibling).toHaveClass("region-color-swatch");
    fireEvent.click(color);
    expect(onRegionColorChange).toHaveBeenCalledWith("#2468AC");
  });

  it("closes the palette before the first map gesture after selecting grab", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    const onMapPointerDown = vi.fn();
    render(<MapCanvas onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    map.addEventListener("pointerdown", onMapPointerDown);
    fireEvent.click(screen.getByRole("button", { name: "グラブ" }));

    expect(onToolChange).toHaveBeenCalledWith("grab");
    expect(screen.getByRole("complementary", { name: "地図ツールパレット" })).toBeInTheDocument();
    fireEvent.pointerDown(map, { button: 0 });
    expect(onMapPointerDown).toHaveBeenCalledOnce();
  });

  it("switches the left sidebar to an icon rail and reopens it", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    const palette = screen.getByRole("complementary", { name: "地図ツールパレット" });
    const shell = palette.parentElement;
    const closeButton = screen.getByRole("button", { name: "地図ツールパレットを閉じる" });
    expect(closeButton).toHaveAttribute("aria-expanded", "true");
    expect(palette).not.toHaveClass("is-collapsed");
    expect(shell).not.toHaveClass("map-canvas-sidebar-collapsed");
    expect(screen.getByText("地形を描く")).toBeInTheDocument();
    expect(screen.getByText("地形を描く")).toHaveClass("tool-sidebar-button-label");
    expect(screen.getByText("グラブ")).toBeInTheDocument();
    expect(screen.getByText("シェイピング")).toHaveClass("tool-sidebar-button-label");
    expect(screen.getByRole("group", { name: "領域の色" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "消しゴムの対象" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "地形削除" })).toBeInTheDocument();
    expect(screen.getByText("地形削除")).not.toHaveClass("sr-only");
    expect(screen.getByText("領域削除")).not.toHaveClass("sr-only");

    fireEvent.click(closeButton);

    expect(palette).toHaveClass("is-collapsed");
    expect(shell).toHaveClass("map-canvas-sidebar-collapsed");
    expect(screen.getAllByRole("button").filter((button) => button.classList.contains("tool-sidebar-button"))).toHaveLength(5);
    expect(palette.querySelectorAll(".tool-sidebar-button > svg")).toHaveLength(5);
    expect(screen.queryByRole("group", { name: "領域の色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "消しゴムの対象" })).not.toBeInTheDocument();
    const openButton = screen.getByRole("button", { name: "地図ツールパレットを開く" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(openButton);

    expect(palette).not.toHaveClass("is-collapsed");
    expect(shell).not.toHaveClass("map-canvas-sidebar-collapsed");
    expect(screen.getByRole("button", { name: "地図ツールパレットを閉じる" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "領域の色" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "消しゴムの対象" })).toBeInTheDocument();
  });

  it("keeps the hidden tool settings available from the collapsed rail", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    fireEvent.click(screen.getByRole("button", { name: "地図ツールパレットを閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "領域" }));
    expect(screen.getAllByRole("radio")).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "消しゴム" }));
    expect(screen.getByRole("group", { name: "消しゴムの対象" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "領域の色" })).not.toBeInTheDocument();
  });

  it("renders the controlled renderer preview without map-frame controls", () => {
    const renderer = createPaletteRenderer();
    render(<MapCanvas mode="cell-select" preview showCellGrid onZoomChange={vi.fn()} createRenderer={() => renderer} />);

    const map = screen.getByRole("region", { name: "世界地図" });
    expect(renderer.setPresentationMode).toHaveBeenLastCalledWith(true);
    expect(renderer.setMode).toHaveBeenLastCalledWith("pan");
    expect(screen.queryByRole("button", { name: "レンダリングプレビューを表示" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編集画面に戻る" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "地図ツールパレット" })).not.toBeInTheDocument();
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
    const feature: RealmFeature = {
      id: "city-1",
      featureType: "city",
      name: "City",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { zIndex: 2, labelColor: "#102030" },
    };
    const firstGrid = { kind: "hex" as const, color: "#102030", width: 1, spacingDegrees: 12 };
    const firstCellGrid = { color: "#102030", width: 1 };
    const { rerender } = render(
      <MapCanvas
        features={[feature]}
        gridOptions={firstGrid}
        cellGridOptions={firstCellGrid}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    const initialCalls = {
      features: (renderer.setFeatures as ReturnType<typeof vi.fn>).mock.calls.length,
      grid: (renderer.setGridOptions as ReturnType<typeof vi.fn>).mock.calls.length,
      cellGrid: (renderer.setCellGridOptions as ReturnType<typeof vi.fn>).mock.calls.length,
    };

    rerender(
      <MapCanvas
        features={[{ ...feature, properties: { labelColor: "#102030", zIndex: 2 } }]}
        gridOptions={{ ...firstGrid }}
        cellGridOptions={{ ...firstCellGrid }}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    expect(renderer.setFeatures).toHaveBeenCalledTimes(initialCalls.features);
    expect(renderer.setGridOptions).toHaveBeenCalledTimes(initialCalls.grid);
    expect(renderer.setCellGridOptions).toHaveBeenCalledTimes(initialCalls.cellGrid);

    rerender(
      <MapCanvas
        features={[{ ...feature, name: "Updated city" }]}
        gridOptions={{ ...firstGrid, spacingDegrees: 15 }}
        cellGridOptions={{ ...firstCellGrid, width: 1.5 }}
        onZoomChange={vi.fn()}
        createRenderer={createRenderer}
      />,
    );
    expect(renderer.setFeatures).toHaveBeenCalledTimes(initialCalls.features + 1);
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
      setCellEraseRadius: vi.fn(),
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
    const palette = screen.getByRole("complementary", { name: "地図ツールパレット" });
    expect(palette).toHaveClass("tool-sidebar");
    expect(screen.getAllByRole("button").filter((button) => button.classList.contains("tool-sidebar-button"))).toHaveLength(5);
    fireEvent.contextMenu(map, { clientX: 120, clientY: 80 });
    expect(document.querySelector(".radial-palette")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "消しゴム" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "地形を描く" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "地図ツール" })).toBeInTheDocument();
    const onMapPointerDown = vi.fn();
    map.addEventListener("pointerdown", onMapPointerDown);
    const terrainButton = screen.getByRole("button", { name: "地形を描く" });
    fireEvent.pointerEnter(terrainButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    fireEvent.click(terrainButton);
    expect(screen.queryByRole("group", { name: "描画範囲の調整" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "描画と削除の太さ" })).not.toBeInTheDocument();
    const eraserButton = screen.getByRole("button", { name: "消しゴム" });
    fireEvent.click(eraserButton);
    const eraseFlyout = screen.getByRole("group", { name: "消しゴムの対象" });
    fireEvent.pointerEnter(eraseFlyout);
    fireEvent.pointerDown(eraseFlyout);
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.pointerDown(map, { button: 0 });
    expect(onMapPointerDown).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("group", { name: "消しゴムの対象" })).toBeInTheDocument();
    rerender(<MapCanvas mode="cell-select" strokeRange={3} zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(cellPaintRadiusForRange(3));
    rerender(<MapCanvas mode="cell-erase" strokeRange={3} zoom={3} onZoomChange={onZoomChange} onCellSelect={onCellSelect} onError={onError} createRenderer={createRenderer} />);
    expect(renderer.setCellPaintRadius).toHaveBeenLastCalledWith(0);
    expect(renderer.setCellEraseRadius).toHaveBeenLastCalledWith(cellPaintRadiusForRange(3));
    expect(screen.getByRole("complementary", { name: "地図ツールパレット" })).toBeInTheDocument();
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
    expect(screen.getByText("六角セルを押したままなぞって地形または領域を消去します。消しゴムの調整で削除対象を切り替えられます。ホイールを押したままドラッグすると地図を移動できます。Escapeで消去を取り消せます。")).toBeInTheDocument();
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

  it("keeps eraser target selection in the left sidebar", () => {
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => 1), setZoom: vi.fn(), resetView: vi.fn(), setFeatures: vi.fn(), setTheme: vi.fn(), setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(), setGridOptions: vi.fn(), setCellGridVisible: vi.fn(), setCellGridOptions: vi.fn(), setAssets: vi.fn(), setLayerVisibility: vi.fn(),
      setMode: vi.fn(), setDrawingOptions: vi.fn(), setCellPaintRadius: vi.fn(), setCellEraseRadius: vi.fn(), setSelected: vi.fn(), setSelectedFeatures: vi.fn(), setSelectedCells: vi.fn(), setCellAttributes: vi.fn(),
      onDraw: vi.fn(() => vi.fn()), onSelectFeatures: vi.fn(() => vi.fn()), onSelect: vi.fn(() => vi.fn()), onCellSelect: vi.fn(() => vi.fn()), onModifyFeatures: vi.fn(() => vi.fn()), onModify: vi.fn(() => vi.fn()), onEraseFeatures: vi.fn(() => vi.fn()), onErase: vi.fn(() => vi.fn()), onLayerShift: vi.fn(() => vi.fn()), onError: vi.fn(() => vi.fn()), onZoomChange: vi.fn(() => vi.fn()), updateSize: vi.fn(), exportRaster: vi.fn(async () => ({ bytes: [], width: 1, height: 1 })), dispose: vi.fn(),
    };
    const onToolChange = vi.fn();
    const onEraseTargetChange = vi.fn();
    render(<MapCanvas onToolChange={onToolChange} onEraseTargetChange={onEraseTargetChange} onZoomChange={vi.fn()} createRenderer={() => renderer} />);
    fireEvent.contextMenu(screen.getByRole("region", { name: "世界地図" }), { clientX: 100, clientY: 100 });
    const eraserButton = screen.getByRole("button", { name: "消しゴム" });
    expect(eraserButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eraserButton);
    expect(onToolChange).toHaveBeenCalledWith("erase");
    expect(eraserButton).toHaveAttribute("aria-expanded", "true");
    const eraseFlyout = screen.getByRole("group", { name: "消しゴムの対象" });
    expect(eraseFlyout).toHaveClass("tool-flyout-erase");
    const eraseTargetGroup = screen.getByRole("group", { name: "削除対象" });
    expect(eraseTargetGroup).toBeInTheDocument();
    const terrainEraseButton = screen.getByRole("button", { name: "地形削除" });
    const regionEraseButton = screen.getByRole("button", { name: "領域削除" });
    const eraserTargetPill = eraseTargetGroup.querySelector(".eraser-target-pill");
    expect(eraserTargetPill).toHaveAttribute("aria-hidden", "true");
    expect(eraserTargetPill).toHaveClass("eraser-target-pill");
    expect(terrainEraseButton).toHaveAttribute("aria-pressed", "true");
    expect(regionEraseButton).toHaveAttribute("aria-pressed", "false");
    Object.defineProperty(terrainEraseButton, "offsetLeft", { configurable: true, value: 0 });
    Object.defineProperty(terrainEraseButton, "offsetWidth", { configurable: true, value: 80 });
    Object.defineProperty(regionEraseButton, "offsetLeft", { configurable: true, value: 84 });
    Object.defineProperty(regionEraseButton, "offsetWidth", { configurable: true, value: 80 });
    fireEvent.click(regionEraseButton);
    expect(onToolChange).toHaveBeenLastCalledWith("erase");
    expect(onEraseTargetChange).toHaveBeenCalledWith("region");
    expect(regionEraseButton).toHaveAttribute("aria-pressed", "true");
    expect(terrainEraseButton).toHaveAttribute("aria-pressed", "false");
    expect(eraserTargetPill).toHaveStyle({ left: "84px", width: "80px" });
    expect(screen.getAllByRole("radio")).toHaveLength(10);
  });

  it("exposes shaping as an accessible palette tool", () => {
    const renderer = createPaletteRenderer();
    const onToolChange = vi.fn();
    render(<MapCanvas onZoomChange={vi.fn()} onToolChange={onToolChange} createRenderer={() => renderer} />);
    const shapeButton = screen.getByRole("button", { name: "シェイピング" });
    expect(shapeButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(shapeButton);
    expect(onToolChange).toHaveBeenCalledWith("shape");
    expect(screen.getByRole("complementary", { name: "地図ツールパレット" })).toBeInTheDocument();
  });
});
