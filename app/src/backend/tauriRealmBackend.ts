import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { ApplyCellAttributesInput, AssetRead, CellAttributeSnapshot, CellViewportInput, ProjectSummary, RealmBackend, RealmSnapshot } from "./types";

export const tauriRealmBackend: RealmBackend = {
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  createProject: (input) => invoke<RealmSnapshot>("create_project", { name: input.name }),
  openProject: (input) => invoke<RealmSnapshot>("open_project", { libraryId: input.libraryId }),
  importProject: (input) => invoke<RealmSnapshot>("import_project", { path: input.path }),
  exportProject: (input) => invoke<void>("export_project", { path: input.path }),
  writeArtifact: (input) => invoke<void>("write_artifact", { path: input.path, bytes: input.bytes }),
  saveProject: (input) => invoke<RealmSnapshot>("save_project", { input }),
  updateProjectSettings: (input) => invoke<RealmSnapshot>("update_project_settings", { input }),
  applyCellAttributes: (input: ApplyCellAttributesInput) => invoke<RealmSnapshot>("apply_cell_attributes", { input }),
  viewCellAttributes: (input: CellViewportInput) => invoke<CellAttributeSnapshot[]>("view_cell_attributes", { input }),
  createFeature: (input) => invoke<RealmSnapshot>("create_feature", { input }),
  createFeaturesBatch: (input) => invoke<RealmSnapshot>("create_features_batch", { input }),
  reviseFeaturesBatch: (input) => invoke<RealmSnapshot>("revise_features_batch", { input }),
  deleteFeaturesBatch: (input) => invoke<RealmSnapshot>("delete_features_batch", { input }),
  setFeaturesLocked: (input) => invoke<RealmSnapshot>("set_features_locked", { input }),
  importAsset: (input) => invoke<RealmSnapshot>("import_asset", { input }),
  importAssetsBatch: (input) => invoke<RealmSnapshot>("import_assets_batch", { input }),
  readAsset: (input) => invoke<AssetRead>("read_asset", { input }),
  deleteAsset: (input) => invoke<RealmSnapshot>("delete_asset", { input }),
  deleteAssetsBatch: (input) => invoke<RealmSnapshot>("delete_assets_batch", { input }),
  reviseFeature: (input) => invoke<RealmSnapshot>("revise_feature", { input }),
  deleteFeature: (input) => invoke<RealmSnapshot>("delete_feature", { input }),
  undoProject: () => invoke<RealmSnapshot>("undo_project"),
  redoProject: () => invoke<RealmSnapshot>("redo_project"),
  closeProject: () => invoke<void>("close_project"),
  getOpenProject: () => invoke<RealmSnapshot | null>("get_open_project"),
};

const withRealmExtension = (path: string): string =>
  path.toLocaleLowerCase("en-US").endsWith(".realmmap") ? path : `${path}.realmmap`;

export const chooseTauriTransferPath = async (mode: "import" | "export", suggestedName = "Realm移行データ.realmmap"): Promise<string | null> => {
  if (mode === "export") {
    const selected = await saveDialog({
      defaultPath: suggestedName,
      filters: [{ name: "Realm移行データ", extensions: ["realmmap"] }],
    });
    return selected ? withRealmExtension(selected) : null;
  }

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Realm移行データ", extensions: ["realmmap"] }],
  });
  return typeof selected === "string" ? selected : null;
};

export const chooseTauriArtifactPath = async (format: "png" | "jpg" | "pdf", suggestedName: string): Promise<string | null> => {
  const selected = await saveDialog({
    defaultPath: `${suggestedName}.${format}`,
    filters: [{ name: format === "png" ? "PNG画像" : format === "jpg" ? "JPEG画像" : "PDF", extensions: [format] }],
  });
  if (!selected) return null;
  return selected.toLocaleLowerCase("en-US").endsWith(`.${format}`) ? selected : `${selected}.${format}`;
};
