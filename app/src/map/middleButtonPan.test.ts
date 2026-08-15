import MapBrowserEvent from "ol/MapBrowserEvent";
import MapBrowserEventType from "ol/MapBrowserEventType";
import Draw from "ol/interaction/Draw";
import DragPan from "ol/interaction/DragPan";
import { describe, expect, it, vi } from "vitest";
import { RealmMapAdapter } from "./MapAdapter";
import type { RealmMapMode } from "./contracts";

const middleButtonModes: RealmMapMode[] = [
  "pan", "cell-select", "cell-region", "grab", "shape", "cell-erase", "erase",
  "terrain", "forest", "river", "coastline", "country", "region", "boundary", "city", "town", "polygon-hole", "label-path",
];

describe("middle-button map pan", () => {
  it("moves the view without starting a tool gesture in every mode", () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const map = adapter.getMap();
    map.setSize([640, 480]);
    const drawn = vi.fn();
    adapter.onDraw(drawn);
    const getEventPixel = vi.spyOn(map, "getEventPixel").mockImplementation((event) => {
      const pointer = event as MouseEvent;
      return [pointer.clientX, pointer.clientY];
    });

    const dispatch = (type: string, originalEvent: MouseEvent, activePointers: MouseEvent[]): void => {
      const event = new MapBrowserEvent(type, map, originalEvent as never, type === MapBrowserEventType.POINTERDRAG, undefined, activePointers as never);
      event.pixel = [originalEvent.clientX, originalEvent.clientY];
      event.coordinate = [0, 0];
      for (const interaction of map.getInteractions().getArray().slice().reverse()) {
        if (!interaction.getActive() || interaction.handleEvent(event) !== false) continue;
        break;
      }
    };

    try {
      const dragPans = map.getInteractions().getArray().filter((item): item is DragPan => item instanceof DragPan);
      expect(dragPans).toHaveLength(2);
      for (const mode of middleButtonModes) {
        adapter.setMode(mode);
        adapter.resetView();
        const before = map.getView().getCenter();
        const down = new MouseEvent("pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100 });
        const drag = new MouseEvent("pointermove", { button: 1, buttons: 4, clientX: 120, clientY: 100 });
        const secondDrag = new MouseEvent("pointermove", { button: 1, buttons: 4, clientX: 140, clientY: 100 });
        const up = new MouseEvent("pointerup", { button: 1, buttons: 0, clientX: 140, clientY: 100 });
        dispatch(MapBrowserEventType.POINTERDOWN, down, [down]);
        dispatch(MapBrowserEventType.POINTERDRAG, drag, [drag]);
        dispatch(MapBrowserEventType.POINTERDRAG, secondDrag, [secondDrag]);
        dispatch(MapBrowserEventType.POINTERUP, up, []);
        expect(map.getView().getCenter(), `mode: ${mode}`).not.toEqual(before);
      }
      expect(drawn).not.toHaveBeenCalled();
    } finally {
      getEventPixel.mockRestore();
      adapter.dispose();
      host.remove();
    }
  });

  it("keeps primary-button region drawing freehand while ignoring middle-button down", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    const map = adapter.getMap();

    try {
      for (const mode of ["region", "cell-region"] as const) {
        adapter.setMode(mode);
        const draw = map.getInteractions().getArray().find((interaction) => interaction instanceof Draw) as Draw;
        expect(draw.getFreehand(), `mode: ${mode}`).toBe(true);
        const middle = new MouseEvent("pointerdown", { button: 1, buttons: 4 });
        const middleEvent = new MapBrowserEvent(MapBrowserEventType.POINTERDOWN, map, middle as never, false, undefined, [middle] as never);
        middleEvent.pixel = [100, 100];
        middleEvent.coordinate = [0, 0];
        expect(draw.handleEvent(middleEvent)).toBe(true);

        const primary = new MouseEvent("pointerdown", { button: 0, buttons: 1 });
        const primaryEvent = new MapBrowserEvent(MapBrowserEventType.POINTERDOWN, map, primary as never, false, undefined, [primary] as never);
        primaryEvent.pixel = [100, 100];
        primaryEvent.coordinate = [0, 0];
        expect(draw.handleEvent(primaryEvent)).toBe(false);
        draw.abortDrawing();
      }
    } finally {
      adapter.dispose();
      host.remove();
    }
  });
});
