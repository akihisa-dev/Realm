import { MemoryRealmBackend } from "./memoryRealmBackend";
import { chooseTauriArtifactPath, chooseTauriTransferPath, tauriRealmBackend } from "./tauriRealmBackend";

export type {
  ApplyCellAttributesInput,
  CellAttribute,
  CellAttributeSnapshot,
  CellViewportInput,
  CreateFeatureInput,
  Era,
  EraInput,
  FeatureType,
  GeoJsonGeometry,
  RealmBackend,
  RealmFeature,
  RealmSnapshot,
  ProjectSummary,
  ReviseFeatureInput,
  SaveProjectInput,
  TimelineEvent,
  TimelineEventInput,
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

export const chooseArtifactPath = async (format: "png" | "pdf", suggestedName: string): Promise<string | null> =>
  isTauriRuntime() ? chooseTauriArtifactPath(format, suggestedName) : null;

export const errorMessage = (cause: unknown, fallback: string): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = Reflect.get(cause, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};
