import MultiLineString from "ol/geom/MultiLineString";
import VectorLayer from "ol/layer/Vector";
import { RealmMapAdapter, cellCenter } from "./MapAdapter";

describe("terrain boundary resize in RealmMapAdapter", () => {
  it("emits a terrain boundary resize from grab mode and restores the smooth outline", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const smoothLayer = adapter.getMap().getLayers().item(8) as VectorLayer;
    const smoothSource = smoothLayer.getSource();
    const resized: unknown[] = [];
    adapter.onCellResize((input) => resized.push(input));
    adapter.setCellAttributes([
      { cellId: "10:10", attribute: "terrain", value: "terrain" },
      { cellId: "11:10", attribute: "terrain", value: "terrain" },
      { cellId: "10:11", attribute: "terrain", value: "terrain" },
      { cellId: "30:30", attribute: "terrain", value: "terrain" },
    ]);
    expect((smoothSource?.getFeatures()[0]?.getGeometry() as MultiLineString).getLineStrings()).toHaveLength(2);
    adapter.setMode("grab");
    const pointer = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(pointer, "isPrimary", { value: true });
    const grab = adapter.getMap().getInteractions().getArray().at(-1) as unknown as {
      handleDownEvent: (event: unknown) => boolean;
      handleDragEvent: (event: unknown) => void;
      handleUpEvent: (event: unknown) => boolean;
    };
    const start = cellCenter(10, 10);
    const outside = cellCenter(10, 9);
    const boundary: [number, number] = [(start[0] + outside[0]) / 2, (start[1] + outside[1]) / 2];
    expect(grab.handleDownEvent({ originalEvent: pointer, coordinate: boundary })).toBe(true);
    expect(smoothLayer.getVisible()).toBe(true);
    expect((smoothSource?.getFeatures()[0]?.getGeometry() as MultiLineString).getLineStrings()).toHaveLength(1);
    grab.handleDragEvent({ originalEvent: pointer, coordinate: outside });
    grab.handleUpEvent({ originalEvent: pointer, coordinate: outside });
    expect(resized).toEqual([{ cellIds: ["9:10"], attribute: "terrain", value: "terrain" }]);
    expect(smoothLayer.getVisible()).toBe(true);
    expect((smoothSource?.getFeatures()[0]?.getGeometry() as MultiLineString).getLineStrings()).toHaveLength(2);

    adapter.dispose();
    host.remove();
  });
});
