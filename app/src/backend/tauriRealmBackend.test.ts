const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.openDialog,
  save: mocks.saveDialog,
}));

import { chooseTauriArtifactPath, chooseTauriTransferPath, tauriRealmBackend } from "./tauriRealmBackend";
import type { RealmSnapshot } from "./types";

const snapshot: RealmSnapshot = {
  formatVersion: 8,
  path: "/tmp/test.realmmap",
  world: { id: "world-test", name: "Test" },
  features: [],
  assets: [],
  settings: { themeId: "ink", showGrid: true, exportScale: 2, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} },
  featureCount: 0,
  canUndo: false,
  canRedo: false,
};

describe("Tauri Realm backend", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.openDialog.mockReset();
    mocks.saveDialog.mockReset();
    mocks.invoke.mockResolvedValue(snapshot);
  });

  it("uses the coarse native project commands with their exact payloads", async () => {
    await tauriRealmBackend.listProjects();
    await tauriRealmBackend.createProject({ name: "New" });
    await tauriRealmBackend.openProject({ libraryId: "550e8400-e29b-41d4-a716-446655440000" });
    await tauriRealmBackend.importProject({ path: "/tmp/import.realmmap" });
    await tauriRealmBackend.exportProject({ path: "/tmp/export.realmmap" });
    await tauriRealmBackend.writeArtifact({ path: "/tmp/map.png", bytes: [1, 2] });
    await tauriRealmBackend.saveProject({ name: "Saved" });
    await tauriRealmBackend.createFeature({ featureType: "city", name: "City", geometry: { type: "Point", coordinates: [1, 2] } });
    await tauriRealmBackend.createFeaturesBatch({ features: [{ featureType: "tree", name: "Tree", geometry: { type: "Point", coordinates: [2, 3] } }] });
    await tauriRealmBackend.reviseFeaturesBatch({ features: [{ id: "feature-id", name: "Moved", geometry: { type: "Point", coordinates: [3, 4] } }] });
    await tauriRealmBackend.deleteFeaturesBatch({ ids: ["feature-id"] });
    await tauriRealmBackend.setFeaturesLocked({ ids: ["feature-id"], locked: true });
    await tauriRealmBackend.reviseFeature({ id: "feature-id", name: "New City", geometry: { type: "Point", coordinates: [2, 3] } });
    await tauriRealmBackend.deleteFeature({ id: "feature-id" });
    await tauriRealmBackend.undoProject();
    await tauriRealmBackend.redoProject();
    await tauriRealmBackend.closeProject();
    await tauriRealmBackend.getOpenProject();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_projects");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "create_project", { name: "New" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "open_project", { libraryId: "550e8400-e29b-41d4-a716-446655440000" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "import_project", { path: "/tmp/import.realmmap" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "export_project", { path: "/tmp/export.realmmap" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, "write_artifact", { path: "/tmp/map.png", bytes: [1, 2] });
    expect(mocks.invoke).toHaveBeenNthCalledWith(7, "save_project", { input: { name: "Saved" } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(8, "create_feature", {
      input: { featureType: "city", name: "City", geometry: { type: "Point", coordinates: [1, 2] } },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(9, "create_features_batch", { input: { features: [{ featureType: "tree", name: "Tree", geometry: { type: "Point", coordinates: [2, 3] } }] } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(10, "revise_features_batch", { input: { features: [{ id: "feature-id", name: "Moved", geometry: { type: "Point", coordinates: [3, 4] } }] } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(11, "delete_features_batch", { input: { ids: ["feature-id"] } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(12, "set_features_locked", { input: { ids: ["feature-id"], locked: true } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(13, "revise_feature", {
      input: { id: "feature-id", name: "New City", geometry: { type: "Point", coordinates: [2, 3] } },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(14, "delete_feature", { input: { id: "feature-id" } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(15, "undo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(16, "redo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(17, "close_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(18, "get_open_project");
  });

  it("normalizes transfer export paths and preserves valid extension casing", async () => {
    mocks.saveDialog.mockResolvedValueOnce("/tmp/World").mockResolvedValueOnce("/tmp/World.REALMMAP");
    await expect(chooseTauriTransferPath("export")).resolves.toBe("/tmp/World.realmmap");
    await expect(chooseTauriTransferPath("export")).resolves.toBe("/tmp/World.REALMMAP");
    expect(mocks.saveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "Realm移行データ.realmmap",
      filters: [{ name: "Realm移行データ", extensions: ["realmmap"] }],
    }));
  });

  it("uses typed sparse-cell commands", async () => {
    await tauriRealmBackend.applyCellAttributes({
      cellIds: ["1:2", "2:2"],
      attribute: "forest",
      value: "on",
    });
    await tauriRealmBackend.viewCellAttributes({ minX: 0, maxX: 10 });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "apply_cell_attributes", {
      input: { cellIds: ["1:2", "2:2"], attribute: "forest", value: "on" },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "view_cell_attributes", {
      input: { minX: 0, maxX: 10 },
    });
  });

  it("uses bounded embedded-asset commands", async () => {
    const input = { mime: "image/png", bytes: [137, 80, 78, 71], width: 16, height: 16, metadata: { pack: "own" } };
    await tauriRealmBackend.importAsset(input);
    await tauriRealmBackend.importAssetsBatch({ packName: "Own Pack", assets: [input] });
    await tauriRealmBackend.readAsset({ id: "asset-id" });
    await tauriRealmBackend.deleteAsset({ id: "asset-id" });
    await tauriRealmBackend.deleteAssetsBatch({ ids: ["asset-id"] });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "import_asset", { input });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "import_assets_batch", { input: { packName: "Own Pack", assets: [input] } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "read_asset", { input: { id: "asset-id" } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "delete_asset", { input: { id: "asset-id" } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "delete_assets_batch", { input: { ids: ["asset-id"] } });
  });

  it("persists only typed project view settings through one command", async () => {
    const input = { settings: { themeId: "atlas" as const, showGrid: false, exportScale: 4 as const, exportExtent: "world" as const, canvasWidth: 4096, canvasHeight: 2048, gridKind: "hex" as const, gridColor: "#102030", gridWidth: 1.5, gridSpacing: 12, themeOverrides: { land: "#aabbcc" } } };
    await tauriRealmBackend.updateProjectSettings(input);
    expect(mocks.invoke).toHaveBeenCalledWith("update_project_settings", { input });
  });

  it("returns null for cancelled or non-file dialog results", async () => {
    mocks.saveDialog.mockResolvedValue(null);
    mocks.openDialog.mockResolvedValueOnce("/tmp/World.realmmap").mockResolvedValueOnce(null).mockResolvedValueOnce(["/tmp/World.realmmap"]);

    await expect(chooseTauriTransferPath("export")).resolves.toBeNull();
    await expect(chooseTauriTransferPath("import")).resolves.toBe("/tmp/World.realmmap");
    await expect(chooseTauriTransferPath("import")).resolves.toBeNull();
    await expect(chooseTauriTransferPath("import")).resolves.toBeNull();
    expect(mocks.openDialog).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
  });

  it("chooses image and PDF destinations with explicit extensions", async () => {
    mocks.saveDialog.mockResolvedValueOnce("/tmp/map").mockResolvedValueOnce("/tmp/map").mockResolvedValueOnce("/tmp/map.PDF");
    await expect(chooseTauriArtifactPath("png", "World")).resolves.toBe("/tmp/map.png");
    await expect(chooseTauriArtifactPath("jpg", "World")).resolves.toBe("/tmp/map.jpg");
    await expect(chooseTauriArtifactPath("pdf", "World")).resolves.toBe("/tmp/map.PDF");
  });
});
