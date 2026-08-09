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

import { chooseTauriProjectPath, tauriRealmBackend } from "./tauriRealmBackend";
import type { RealmSnapshot } from "./types";

const snapshot: RealmSnapshot = {
  formatVersion: 1,
  path: "/tmp/test.realmmap",
  world: { id: "world-test", name: "Test", currentYear: 0 },
  eras: [],
  features: [],
  timelineEvents: [],
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
    await tauriRealmBackend.createProject({ path: "/tmp/new.realmmap", name: "New" });
    await tauriRealmBackend.openProject({ path: "/tmp/open.realmmap" });
    await tauriRealmBackend.saveProject({ name: "Saved", currentYear: 12, eras: [], timelineEvents: [] });
    await tauriRealmBackend.viewProjectYear(12);
    await tauriRealmBackend.createFeature({ featureType: "city", name: "City", validFromYear: 12, geometry: { type: "Point", coordinates: [1, 2] } });
    await tauriRealmBackend.reviseFeature({ id: "feature-id", name: "New City", validFromYear: 13, geometry: { type: "Point", coordinates: [2, 3] } });
    await tauriRealmBackend.deleteFeature({ id: "feature-id", validFromYear: 14 });
    await tauriRealmBackend.undoProject();
    await tauriRealmBackend.redoProject();
    await tauriRealmBackend.closeProject();
    await tauriRealmBackend.getOpenProject();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "create_project", { path: "/tmp/new.realmmap", name: "New" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "open_project", { path: "/tmp/open.realmmap" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "save_project", { input: { name: "Saved", currentYear: 12, eras: [], timelineEvents: [] } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "view_project_year", { year: 12 });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "create_feature", { input: { featureType: "city", name: "City", validFromYear: 12, geometry: { type: "Point", coordinates: [1, 2] } } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, "revise_feature", { input: { id: "feature-id", name: "New City", validFromYear: 13, geometry: { type: "Point", coordinates: [2, 3] } } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(7, "delete_feature", { input: { id: "feature-id", validFromYear: 14 } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(8, "undo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(9, "redo_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(10, "close_project");
    expect(mocks.invoke).toHaveBeenNthCalledWith(11, "get_open_project");
  });

  it("normalizes create paths and preserves valid extension casing", async () => {
    mocks.saveDialog.mockResolvedValueOnce("/tmp/World").mockResolvedValueOnce("/tmp/World.REALMMAP");
    await expect(chooseTauriProjectPath("create")).resolves.toBe("/tmp/World.realmmap");
    await expect(chooseTauriProjectPath("create")).resolves.toBe("/tmp/World.REALMMAP");
    expect(mocks.saveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "無題の世界.realmmap",
      filters: [{ name: "Realm map", extensions: ["realmmap"] }],
    }));
  });

  it("returns null for cancelled or non-file dialog results", async () => {
    mocks.saveDialog.mockResolvedValue(null);
    mocks.openDialog.mockResolvedValueOnce("/tmp/World.realmmap").mockResolvedValueOnce(null).mockResolvedValueOnce(["/tmp/World.realmmap"]);

    await expect(chooseTauriProjectPath("create")).resolves.toBeNull();
    await expect(chooseTauriProjectPath("open")).resolves.toBe("/tmp/World.realmmap");
    await expect(chooseTauriProjectPath("open")).resolves.toBeNull();
    await expect(chooseTauriProjectPath("open")).resolves.toBeNull();
    expect(mocks.openDialog).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
  });
});
