import * as SelectModule from "ol/interaction/Select";
import VectorLayer from "ol/layer/Vector";
import { RealmMapAdapter } from "./MapAdapter";

const OBJECT_LAYER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const layerTree = { nodes: [{ id: OBJECT_LAYER, parentId: null, kind: "leaf" as const, name: "Object", order: 0, visible: true, locked: false }] };
const createAdapter = (host: HTMLDivElement): RealmMapAdapter => { const adapter = new RealmMapAdapter({ target: host }); adapter.setLayerTree(layerTree); return adapter; };

describe("RealmMapAdapter raster export", () => {
  it("rejects invalid or unsafe configured export dimensions before rendering", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = createAdapter(host);
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
    const adapter = createAdapter(host);
    adapter.setObjects([{ id: "selected", layerId: OBJECT_LAYER, kind: "city", label: "Selected", geometry: { type: "Point", coordinates: [0, 0] }, properties: {}, zIndex: 0, locked: false }]);
    adapter.setActiveLayer(OBJECT_LAYER); adapter.setActiveKind("city");
    adapter.setMode("city");
    adapter.setSelectedObjects(["selected"]);
    const adapterState = adapter as unknown as { activeMode: string };
    const modeBeforeExport = adapterState.activeMode;
    const map = adapter.getMap();
    map.setSize([640, 480]);
    const view = map.getView();
    view.setCenter([12, 8]);
    const originalResolution = view.getResolution();
    const renderSpy = vi.spyOn(map, "renderSync").mockImplementation(() => undefined);
    const fillRect = vi.fn(); const drawImage = vi.fn(); const beginPath = vi.fn(); const arc = vi.fn(); const fill = vi.fn();
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const context = { fillStyle: "", fillRect, drawImage, beginPath, arc, fill, save: vi.fn(), restore: vi.fn(), createLinearGradient: vi.fn(() => gradient), createRadialGradient: vi.fn(() => gradient) } as unknown as CanvasRenderingContext2D;
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
    expect(adapterState.activeMode).toBe(modeBeforeExport);
    const selection = map.getInteractions().getArray().find((item) => item instanceof SelectModule.default) as SelectModule.default;
    expect(selection.getFeatures().getArray().map((feature) => feature.getId())).toEqual(["selected"]);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    toBlobSpy.mockRestore(); contextSpy.mockRestore(); renderSpy.mockRestore();
    adapter.dispose(); host.remove();
  });

  it("uses the presentation terrain layer for export and restores edit visibility", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.append(host);
    const adapter = createAdapter(host);
    adapter.setMapShapes?.([{
      id: "terrain-preview",
      layer: "terrain",
      value: "terrain",
      geometryVersion: 1,
      snapGridVersion: 1,
      geometry: { type: "Polygon", coordinates: [[[-12, -8], [12, -8], [12, 8], [-12, -8]]] },
    }]);
    const map = adapter.getMap();
    map.setSize([640, 480]);
    const presentationLayer = map.getLayers().item(9) as VectorLayer;
    let sawPresentationLayer = false;
    const renderSpy = vi.spyOn(map, "renderSync").mockImplementation(() => { sawPresentationLayer ||= presentationLayer.getVisible(); });
    const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(), createLinearGradient: vi.fn(() => gradient), createRadialGradient: vi.fn(() => gradient) } as unknown as CanvasRenderingContext2D;
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = 640; sourceCanvas.height = 480; host.append(sourceCanvas);
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback({ arrayBuffer: async () => new Uint8Array([1]).buffer } as Blob));

    await adapter.exportRaster("image/png");

    expect(renderSpy).toHaveBeenCalled();
    expect(sawPresentationLayer).toBe(true);
    expect(presentationLayer.getVisible()).toBe(false);
    expect(presentationLayer.getSource()?.getFeatures()).toHaveLength(0);
    toBlobSpy.mockRestore(); contextSpy.mockRestore(); renderSpy.mockRestore();
    adapter.dispose();
    host.remove();
  });
});
