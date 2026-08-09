import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { RealmBackend, RealmSnapshot } from "./types";

export const tauriRealmBackend: RealmBackend = {
  createProject: (input) => invoke<RealmSnapshot>("create_project", { path: input.path, name: input.name }),
  openProject: (input) => invoke<RealmSnapshot>("open_project", { path: input.path }),
  saveProject: (input) => invoke<RealmSnapshot>("save_project", { input }),
  viewProjectYear: (year) => invoke<RealmSnapshot>("view_project_year", { year }),
  createFeature: (input) => invoke<RealmSnapshot>("create_feature", { input }),
  reviseFeature: (input) => invoke<RealmSnapshot>("revise_feature", { input }),
  deleteFeature: (input) => invoke<RealmSnapshot>("delete_feature", { input }),
  undoProject: () => invoke<RealmSnapshot>("undo_project"),
  redoProject: () => invoke<RealmSnapshot>("redo_project"),
  closeProject: () => invoke<void>("close_project"),
  getOpenProject: () => invoke<RealmSnapshot | null>("get_open_project"),
};

const withRealmExtension = (path: string): string =>
  path.toLocaleLowerCase("en-US").endsWith(".realmmap") ? path : `${path}.realmmap`;

export const chooseTauriProjectPath = async (mode: "create" | "open"): Promise<string | null> => {
  if (mode === "create") {
    const selected = await saveDialog({
      defaultPath: "無題の世界.realmmap",
      filters: [{ name: "Realm map", extensions: ["realmmap"] }],
    });
    return selected ? withRealmExtension(selected) : null;
  }

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Realm map", extensions: ["realmmap"] }],
  });
  return typeof selected === "string" ? selected : null;
};
