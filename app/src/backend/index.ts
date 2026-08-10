import { MemoryRealmBackend } from "./memoryRealmBackend";
import { chooseTauriArtifactPath, chooseTauriTransferPath, tauriRealmBackend } from "./tauriRealmBackend";
import { localizedErrorMessage } from "../locales/ja";

export type {
  ApplyCellAttributesInput,
  AssetManifest,
  AssetRead,
  CellAttribute,
  CellAttributeSnapshot,
  CellViewportInput,
  CreateFeatureInput,
  CreateFeaturesBatchInput,
  DeleteFeaturesBatchInput,
  DeleteAssetsBatchInput,
  FeatureType,
  GeoJsonGeometry,
  ImportAssetInput,
  ImportAssetsBatchInput,
  Position,
  ProjectSettings,
  RealmBackend,
  RealmFeature,
  RealmSnapshot,
  ProjectSummary,
  ReviseFeatureInput,
  ReviseFeaturesBatchInput,
  SaveProjectInput,
  SetFeaturesLockedInput,
  World,
} from "./types";
export { MemoryRealmBackend } from "./memoryRealmBackend";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);

const memoryBackend = new MemoryRealmBackend();

export const defaultBackend = isTauriRuntime() ? tauriRealmBackend : memoryBackend;

export const chooseTransferPath = async (mode: "import" | "export", suggestedName?: string): Promise<string | null> =>
  isTauriRuntime() ? chooseTauriTransferPath(mode, suggestedName) : null;

export const chooseArtifactPath = async (format: "png" | "jpg" | "pdf", suggestedName: string): Promise<string | null> =>
  isTauriRuntime() ? chooseTauriArtifactPath(format, suggestedName) : null;

export const errorMessage = localizedErrorMessage;
