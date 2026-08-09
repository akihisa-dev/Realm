import { RealmMapAdapter } from "./MapAdapter";
import DragPan from "ol/interaction/DragPan";
import KeyboardPan from "ol/interaction/KeyboardPan";
import KeyboardZoom from "ol/interaction/KeyboardZoom";
import MouseWheelZoom from "ol/interaction/MouseWheelZoom";

describe("RealmMapAdapter", () => {
  it("creates a bounded world view and disposes its OpenLayers target", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);

    const adapter = new RealmMapAdapter({ target: host });
    expect(adapter.getMap().getView().getProjection().getCode()).toBe("EPSG:4326");
    const interactions = adapter.getMap().getInteractions().getArray();
    expect(interactions.some((interaction) => interaction instanceof DragPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof MouseWheelZoom)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardPan)).toBe(true);
    expect(interactions.some((interaction) => interaction instanceof KeyboardZoom)).toBe(true);
    adapter.setZoom(3);
    expect(adapter.getZoom()).toBe(3);
    adapter.setZoom(99);
    expect(adapter.getZoom()).toBe(8);
    adapter.setZoom(-99);
    expect(adapter.getZoom()).toBe(0);
    adapter.dispose();
    expect(adapter.getMap().getTarget()).toBeNull();
    host.remove();
  });
});
