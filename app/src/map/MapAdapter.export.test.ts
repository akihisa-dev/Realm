import * as SelectModule from "ol/interaction/Select";
import { RealmMapAdapter } from "./MapAdapter";

describe("RealmMapAdapter raster export", () => {
  it("rejects invalid or unsafe configured export dimensions before rendering", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    await expect(adapter.exportRaster("image/png", 1, "world", { width: 511, height: 1024 })).rejects.toThrow("512〜8192px");
    await expect(adapter.exportRaster("image/png", 2, "world", { width: 8192, height: 8192 })).rejects.toThrow("大きすぎます");
    await expect(adapter.exportRaster("image/jpeg", 1, "world", { width: 1024, height: 1024, quality: 0.49 })).rejects.toThrow("50〜100%");
    adapter.dispose();
    host.remove();
  });

  it("exports configured pixels without selection chrome and restores map state", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = new RealmMapAdapter({ target: host });
    adapter.setObjects([{ id: "selected", kind: "city", label: "Selected", geometry: { type: "Point", coordinates: [0, 0] }, properties: {}, zIndex: 0, locked: false }]);
    adapter.setActiveLayer("object");
    adapter.setSelectedObjects(["selected"]);
    const map = adapter.getMap();
    map.setSize([640, 480]);
    const view = map.getView();
    view.setCenter([12, 8]);
    const originalResolution = view.getResolution();
    const renderSpy = vi.spyOn(map, "renderSync").mockImplementation(() => undefined);
    const fillRect = vi.fn(); const drawImage = vi.fn(); const beginPath = vi.fn(); const arc = vi.fn(); const fill = vi.fn();
    const context = { fillStyle: "", fillRect, drawImage, beginPath, arc, fill } as unknown as CanvasRenderingContext2D;
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = 640; sourceCanvas.height = 480; host.append(sourceCanvas);
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, mimeType, quality) => {
      expect(mimeType).toBe("image/png");
      expect(quality).toBe(0.8);
      callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob);
    });
    const raster = await adapter.exportRaster("image/png", 1, "viewport", { width: 512, height: 512, transparent: true, quality: 0.8 });
    expect(raster).toMatchObject({ width: 512, height: 512 });
    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(map.getSize()).toEqual([640, 480]);
    expect(view.getCenter()).toEqual([12, 8]);
    expect(view.getResolution()).toBe(originalResolution);
    const selection = map.getInteractions().getArray().find((item) => item instanceof SelectModule.default) as SelectModule.default;
    expect(selection.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["selected"]);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    toBlobSpy.mockRestore(); contextSpy.mockRestore(); renderSpy.mockRestore();
    adapter.dispose(); host.remove();
  });
});
