import { MemoryRealmBackend } from "./memoryRealmBackend";
import { chooseTauriProjectPath, tauriRealmBackend } from "./tauriRealmBackend";

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

export const chooseProjectPath = async (mode: "create" | "open"): Promise<string | null> => {
  if (isTauriRuntime()) return chooseTauriProjectPath(mode);
  return mode === "create" ? "browser://無題の世界.realmmap" : "browser://opened.realmmap";
};

export const projectNameFromPath = (path: string): string => {
  const filename = path.split(/[\\/]/u).pop() ?? "無題の世界.realmmap";
  return filename.replace(/\.realmmap$/iu, "") || "無題の世界";
};

export const errorMessage = (cause: unknown, fallback: string): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = Reflect.get(cause, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};
