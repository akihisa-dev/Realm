import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RealmMapRenderer } from "../map/MapAdapter";
import { MapCanvas, MapZoomControls } from "./MapCanvas";

describe("MapZoomControls", () => {
  it("reports the scale and clamps zoom actions at both boundaries", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MapZoomControls zoom={1} onChange={onChange} />);
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
    act(() => { zoomListener?.(4); });
    expect(onZoomChange).toHaveBeenLastCalledWith(4);

    rerender(<MapCanvas zoom={5} onZoomChange={onZoomChange} createRenderer={createRenderer} />);
    expect(renderer.setZoom).toHaveBeenLastCalledWith(5);
    unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
