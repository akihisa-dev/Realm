import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas, MapZoomControls } from "./MapCanvas";

describe("MapZoomControls", () => {
  it("reports the scale and clamps zoom actions at both boundaries", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MapZoomControls zoom={1} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "地図のズーム" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "縮小" }));
    fireEvent.click(screen.getByRole("button", { name: "拡大" }));
    expect(onChange).toHaveBeenNthCalledWith(1, 0);
    expect(onChange).toHaveBeenNthCalledWith(2, 2);

    rerender(<MapZoomControls zoom={0} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "縮小" })).toBeDisabled();
    rerender(<MapZoomControls zoom={8} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "拡大" })).toBeDisabled();
  });

  it("drives the canvas only through the replaceable renderer contract", () => {
    let zoom = 1;
    let zoomListener: ((nextZoom: number) => void) | null = null;
    let drawListener: ((geometry: never) => void) | null = null;
    let selectFeaturesListener: ((ids: readonly string[]) => void) | null = null;
    let cellListener: ((ids: readonly string[]) => void) | null = null;
    let modifyFeaturesListener: ((changes: readonly { id: string; geometry: never }[]) => void) | null = null;
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => zoom),
      setZoom: vi.fn((nextZoom) => { zoom = nextZoom; }),
      resetView: vi.fn(),
      setFeatures: vi.fn(),
      setTheme: vi.fn(),
      setThemeOverrides: vi.fn(),
      setGridVisible: vi.fn(),
      setGridOptions: vi.fn(),
      setAssets: vi.fn(),
      setLayerVisibility: vi.fn(),
      setMode: vi.fn(),
      setDrawingOptions: vi.fn(),
      setCellBrushRadius: vi.fn(),
      setSelected: vi.fn(),
      setSelectedFeatures: vi.fn(),
      setSelectedCells: vi.fn(),
      setCellAttributes: vi.fn(),
      onDraw: vi.fn((listener) => { drawListener = listener as typeof drawListener; return vi.fn(); }),
      onSelectFeatures: vi.fn((listener) => { selectFeaturesListener = listener as typeof selectFeaturesListener; return vi.fn(); }),
      onSelect: vi.fn(() => vi.fn()),
      onCellSelect: vi.fn((listener) => { cellListener = listener; return vi.fn(); }),
      onModifyFeatures: vi.fn((listener) => { modifyFeaturesListener = listener as typeof modifyFeaturesListener; return vi.fn(); }),
      onModify: vi.fn(() => vi.fn()),
      onEraseFeatures: vi.fn(() => vi.fn()),
      onErase: vi.fn(() => vi.fn()),
      onLayerShift: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
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
    const { rerender, unmount } = render(
      <MapCanvas zoom={3} onZoomChange={onZoomChange} createRenderer={createRenderer} />,
    );

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(renderer.setZoom).toHaveBeenCalledWith(3);
    expect(onZoomChange).toHaveBeenLastCalledWith(3);
    expect(renderer.setGridVisible).toHaveBeenCalledWith(true);
    expect(renderer.setThemeOverrides).toHaveBeenCalledWith({});
    expect(renderer.setGridOptions).toHaveBeenCalledWith({ kind: "graticule", color: "#687784", width: 1, spacingDegrees: 10 });
    expect(renderer.setDrawingOptions).toHaveBeenCalledWith({ gesture: "freehand", smoothingPasses: 1, snapAngleDegrees: null });
    expect(screen.getByRole("group", { name: "現在の地図操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "地図を移動" }));
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveFocus();
    (drawListener as ((geometry: never) => void) | null)?.({} as never);
    (selectFeaturesListener as ((ids: readonly string[]) => void) | null)?.([]);
    (cellListener as ((ids: readonly string[]) => void) | null)?.([]);
    (modifyFeaturesListener as ((changes: readonly { id: string; geometry: never }[]) => void) | null)?.([{ id: "id", geometry: {} as never }]);
    fireEvent.click(screen.getByRole("button", { name: "表示を中央に戻す" }));
    expect(renderer.resetView).toHaveBeenCalledOnce();
    act(() => { zoomListener?.(4); });
    expect(onZoomChange).toHaveBeenLastCalledWith(4);

    rerender(<MapCanvas zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setZoom).toHaveBeenLastCalledWith(5);
    rerender(<MapCanvas showGrid={false} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setGridVisible).toHaveBeenLastCalledWith(false);
    rerender(<MapCanvas gridOptions={{ kind: "hex", color: "#102030", width: 1.5, spacingDegrees: 12 }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setGridOptions).toHaveBeenLastCalledWith({ kind: "hex", color: "#102030", width: 1.5, spacingDegrees: 12 });
    rerender(<MapCanvas themeOverrides={{ land: "#aabbcc" }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setThemeOverrides).toHaveBeenLastCalledWith({ land: "#aabbcc" });

    rerender(<MapCanvas mode="river" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地図上で押したまま線または領域を描きます。続けて複数の地物を描けます。Escapeで描画中の線を取り消せます。")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-draw");
    expect(renderer.setMode).toHaveBeenLastCalledWith("river");

    const onToolWheel = vi.fn();
    rerender(<MapCanvas mode="river" drawingOptions={{ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 }} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} onToolWheel={onToolWheel} />);
    expect(renderer.setDrawingOptions).toHaveBeenLastCalledWith({ gesture: "vertices", smoothingPasses: 0, snapAngleDegrees: 45 });
    expect(screen.getByText("地図上を順にクリックして線または領域を描きます。Altで直線化、Alt+Shiftで45°に揃え、右クリックまたはダブルクリックで確定、Escapeで取り消せます。")).toBeInTheDocument();
    fireEvent.wheel(screen.getByRole("region", { name: "世界地図" }), { deltaY: -1, shiftKey: true });
    expect(onToolWheel).toHaveBeenCalledWith(1, true);

    rerender(<MapCanvas mode="cell-select" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地図上で押したまま筆のように塗り、通過したセルへ属性を付けます。クリックでも円形に塗れます。Escapeで選択を解除できます。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("cell-select");
    rerender(<MapCanvas mode="cell-select" selectedCellIds={["256:128"]} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setSelectedCells).toHaveBeenLastCalledWith(["256:128"]);
    rerender(<MapCanvas mode="cell-select" cellBrushRadius={4} zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setCellBrushRadius).toHaveBeenLastCalledWith(4);
    const canvas = screen.getByRole("region", { name: "世界地図" });
    Object.defineProperty(canvas, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, width: 512, height: 256, right: 512, bottom: 256, x: 0, y: 0, toJSON: () => ({}) }) });
    const pointerMove = new Event("pointermove", { bubbles: true });
    Object.defineProperties(pointerMove, { clientX: { value: 120 }, clientY: { value: 80 }, pointerType: { value: "pen" }, pressure: { value: 0.5 } });
    fireEvent(canvas, pointerMove);
    const preview = document.querySelector<HTMLElement>(".brush-preview");
    expect(preview).not.toBeNull();
    expect(preview?.style.width).toBe("64px");
    fireEvent.pointerLeave(canvas);
    expect(document.querySelector(".brush-preview")).toBeNull();

    rerender(<MapCanvas mode="city" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地図上をクリックして点を配置します。角括弧またはホイールで大きさ、カンマ・ピリオドで回転、Fで左右反転します。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("city");
    unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
