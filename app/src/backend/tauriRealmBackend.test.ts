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
  formatVersion: 3,
  path: "/tmp/test.realmmap",
  world: { id: "world-test", name: "Test" },
  features: [],
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
    expect(mocks.invoke).toHaveBeenNthCalledWith(9, "revise_feature", {
      input: { id: "feature-id", name: "New City", geometry: { type: "Point", coordinates: [2, 3] } },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(10, "delete_feature", { input: { id: "feature-id" } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(11, "undo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(12, "redo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(13, "close_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(14, "get_open_project");
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
    mocks.saveDialog.mockResolvedValueOnce("/tmp/map").mockResolvedValueOnce("/tmp/map.PDF");
    await expect(chooseTauriArtifactPath("png", "World")).resolves.toBe("/tmp/map.png");
    await expect(chooseTauriArtifactPath("pdf", "World")).resolves.toBe("/tmp/map.PDF");
  });
});
