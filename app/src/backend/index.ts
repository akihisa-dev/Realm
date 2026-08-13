import { MemoryRealmBackend } from "./memoryRealmBackend";
import { electronRealmBackend } from "./electronRealmBackend";
import { localizedErrorMessage } from "../locales/ja";
import type { ArtifactFormat, ElectronRealmApi, TransferPathMode } from "../shared/realmContract";

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

type RealmWindow = Window & { realmApi?: ElectronRealmApi };
const isElectronRuntime = (): boolean => typeof window !== "undefined" && "realmApi" in (window as RealmWindow);

const memoryBackend = new MemoryRealmBackend();

export const defaultBackend = isElectronRuntime() ? electronRealmBackend : memoryBackend;

export const chooseTransferPath = async (mode: "import" | "export", suggestedName?: string): Promise<string | null> => {
  if (!isElectronRuntime()) return null;
  return (window as RealmWindow).realmApi?.chooseTransferPath({ mode: mode as TransferPathMode, ...(suggestedName ? { suggestedName } : {}) }) ?? null;
};

export const chooseArtifactPath = async (format: "png" | "jpg" | "pdf", suggestedName: string): Promise<string | null> => {
  if (!isElectronRuntime()) return null;
  return (window as RealmWindow).realmApi?.chooseArtifactPath({ format: format as ArtifactFormat, suggestedName }) ?? null;
};

export const errorMessage = localizedErrorMessage;
