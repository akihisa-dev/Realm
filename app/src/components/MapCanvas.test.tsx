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
    const renderer: RealmMapRenderer = {
      getZoom: vi.fn(() => zoom),
      setZoom: vi.fn((nextZoom) => { zoom = nextZoom; }),
      resetView: vi.fn(),
      setFeatures: vi.fn(),
      setMode: vi.fn(),
      setSelected: vi.fn(),
      onDraw: vi.fn(() => vi.fn()),
      onSelect: vi.fn(() => vi.fn()),
      onModify: vi.fn(() => vi.fn()),
      onZoomChange: vi.fn((listener) => {
        zoomListener = listener;
        return vi.fn();
      }),
      updateSize: vi.fn(),
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
    expect(screen.getByRole("group", { name: "現在の地図操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "地図を移動" }));
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "表示を中央に戻す" }));
    expect(renderer.resetView).toHaveBeenCalledOnce();
    act(() => { zoomListener?.(4); });
    expect(onZoomChange).toHaveBeenLastCalledWith(4);

    rerender(<MapCanvas zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setZoom).toHaveBeenLastCalledWith(5);

    rerender(<MapCanvas mode="river" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地図上でマウスまたはトラックパッドを押したままドラッグし、線または領域を描きます。")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "世界地図" })).toHaveClass("map-canvas-draw");
    expect(renderer.setMode).toHaveBeenLastCalledWith("river");

    rerender(<MapCanvas mode="city" zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(screen.getByText("地図上をクリックして点を配置します。")).toBeInTheDocument();
    expect(renderer.setMode).toHaveBeenLastCalledWith("city");
    unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
