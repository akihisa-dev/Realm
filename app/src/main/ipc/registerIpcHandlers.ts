import type { RealmCommands } from "../commands/realmCommands";
import type { ArtifactFormat, TransferPathMode } from "../../shared/realmContract";
import { asRealmError, RealmError } from "../domain/errors";

export const REALM_IPC_CHANNELS = [
  "realm:listProjects", "realm:createProject", "realm:openProject", "realm:importProject", "realm:exportProject", "realm:writeArtifact", "realm:saveProject", "realm:updateProjectSettings", "realm:createFeature", "realm:createFeaturesBatch", "realm:reviseFeature", "realm:reviseFeaturesBatch", "realm:deleteFeature", "realm:deleteFeaturesBatch", "realm:setFeaturesLocked", "realm:importAsset", "realm:importAssetsBatch", "realm:readAsset", "realm:deleteAsset", "realm:deleteAssetsBatch", "realm:applyCellAttributes", "realm:viewCellAttributes", "realm:undoProject", "realm:redoProject", "realm:closeProject", "realm:getOpenProject", "realm:chooseTransferPath", "realm:chooseArtifactPath",
] as const;
export type RealmIpcChannel = typeof REALM_IPC_CHANNELS[number];
type IpcMainLike = { handle(channel: string, listener: (...args: unknown[]) => unknown): void; removeHandler?(channel: string): void };
export type RealmIpcRegistration = (() => void) & { drain(): Promise<void> };
export type RealmIpcEvent = { sender: { id: number }; senderFrame?: { url?: string }; };
export type RealmIpcSecurityOptions = { allowedSenderIds: readonly number[]; allowedRendererOrigins: readonly string[]; maxPayloadBytes?: number };
export type RealmIpcDialogs = {
  chooseTransferPath?: (input: { mode: TransferPathMode; suggestedName?: string }) => Promise<string | null>;
  chooseArtifactPath?: (input: { format: ArtifactFormat; suggestedName: string }) => Promise<string | null>;
};

const handlers: Partial<Record<RealmIpcChannel, keyof RealmCommands>> = {
  "realm:listProjects": "listProjects", "realm:createProject": "createProject", "realm:openProject": "openProject", "realm:importProject": "importProject", "realm:exportProject": "exportProject", "realm:writeArtifact": "writeArtifact", "realm:saveProject": "saveProject", "realm:updateProjectSettings": "updateProjectSettings", "realm:createFeature": "createFeature", "realm:createFeaturesBatch": "createFeaturesBatch", "realm:reviseFeature": "reviseFeature", "realm:reviseFeaturesBatch": "reviseFeaturesBatch", "realm:deleteFeature": "deleteFeature", "realm:deleteFeaturesBatch": "deleteFeaturesBatch", "realm:setFeaturesLocked": "setFeaturesLocked", "realm:importAsset": "importAsset", "realm:importAssetsBatch": "importAssetsBatch", "realm:readAsset": "readAsset", "realm:deleteAsset": "deleteAsset", "realm:deleteAssetsBatch": "deleteAssetsBatch", "realm:applyCellAttributes": "applyCellAttributes", "realm:viewCellAttributes": "viewCellAttributes", "realm:undoProject": "undoProject", "realm:redoProject": "redoProject", "realm:closeProject": "closeProject", "realm:getOpenProject": "getOpenProject",
};

const DEFAULT_MAX_PAYLOAD_BYTES = 80 * 1024 * 1024;
const NO_INPUT_CHANNELS = new Set<RealmIpcChannel>(["realm:listProjects", "realm:undoProject", "realm:redoProject", "realm:closeProject", "realm:getOpenProject"]);
const PATH_FIELDS = new Set(["path", "libraryId"]);
const ID_FIELDS = new Set(["id", "ids", "cellIds"]);
const DIALOG_NAME_FIELDS = new Set(["suggestedName"]);

function validateInputBoundary(channel: RealmIpcChannel, input: unknown): void {
  if (input === undefined) {
    if (!NO_INPUT_CHANNELS.has(channel)) throw new RealmError("invalid_input", "The IPC request payload is required.");
    return;
  }
  // A no-input command has an intentionally empty wire contract.  Do not silently
  // pass an object through to a method which does not accept one; callers that send
  // `{}` (or any other payload) are malformed at the IPC boundary.
  if (NO_INPUT_CHANNELS.has(channel)) throw new RealmError("invalid_input", "This IPC command does not accept a payload.");
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new RealmError("invalid_input", "The IPC request payload must be an object.");
  const record = input as Record<string, unknown>;
  if (channel === "realm:openProject" && (Object.keys(record).some((key) => key !== "libraryId") || typeof record.libraryId !== "string" || record.libraryId.trim().length === 0 || record.libraryId.length > 256)) {
    throw new RealmError("invalid_input", "Opening a project requires one managed library identifier.");
  }
  for (const [key, value] of Object.entries(record)) {
    if (PATH_FIELDS.has(key)) {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 4096) throw new RealmError("invalid_path", "The requested path is invalid.");
    }
    if (ID_FIELDS.has(key)) {
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0 || values.length > 4096 || values.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) throw new RealmError("invalid_input", "The requested identifier is invalid.");
    }
    if (DIALOG_NAME_FIELDS.has(key) && (typeof value !== "string" || value.length === 0 || value.length > 255 || value.includes("/") || value.includes("\\") || value === "." || value === "..")) throw new RealmError("invalid_input", "The suggested filename is invalid.");
  }
  if (channel === "realm:chooseTransferPath" && record.mode !== "import" && record.mode !== "export") throw new RealmError("invalid_input", "The transfer mode is invalid.");
  if (channel === "realm:chooseArtifactPath") {
    if (record.format !== "png" && record.format !== "jpg" && record.format !== "pdf") throw new RealmError("invalid_input", "The artifact format is invalid.");
    if (!Object.hasOwn(record, "suggestedName")) throw new RealmError("invalid_input", "The suggested filename is required.");
  }
}

function isAllowedOrigin(url: string | undefined, origins: readonly string[]): boolean {
  if (!url) return false;
  try {
    const actual = new URL(url);
    return origins.some((candidate) => {
      try {
        const expected = new URL(candidate);
        return actual.protocol === expected.protocol
          && actual.hostname === expected.hostname
          && actual.port === expected.port
          // A production renderer is loaded from one exact file.  A prefix check
          // would also authorize a sibling such as `index.html.evil`.
          && (actual.protocol !== "file:" || actual.pathname === expected.pathname);
      }
      catch { return false; }
    });
  } catch { return false; }
}
function payloadSize(input: unknown): number { try { return new TextEncoder().encode(JSON.stringify(input)).length; } catch { return Number.POSITIVE_INFINITY; } }

export function registerIpcHandlers(ipcMain: IpcMainLike, commands: RealmCommands, security: RealmIpcSecurityOptions, dialogs: RealmIpcDialogs = {}): RealmIpcRegistration {
  if (!security.allowedSenderIds.length || !security.allowedRendererOrigins.length) throw new Error("Realm IPC requires an explicit renderer sender/origin allow-list.");
  const maxPayloadBytes = security.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  let serial: Promise<void> = Promise.resolve();
  let accepting = true;
  for (const channel of REALM_IPC_CHANNELS) {
    ipcMain.removeHandler?.(channel);
    const method = handlers[channel];
    ipcMain.handle(channel, async (...args: unknown[]) => {
      try {
        const event = args[0] as RealmIpcEvent | undefined;
        const input = args[1];
        const senderId = event && typeof event === "object" && event.sender && typeof event.sender.id === "number"
          ? event.sender.id
          : undefined;
        if (!accepting) throw new RealmError("invalid_input", "Realm IPC is shutting down.");
        if (senderId === undefined || !security.allowedSenderIds.includes(senderId) || !isAllowedOrigin(event?.senderFrame?.url, security.allowedRendererOrigins)) {
          throw new RealmError("invalid_input", "Realm IPC sender is not authorized.");
        }
        if (payloadSize(input) > maxPayloadBytes) throw new RealmError("invalid_input", "Realm IPC payload is too large.");
        validateInputBoundary(channel, input);
        const operation = channel === "realm:chooseTransferPath"
          ? () => dialogs.chooseTransferPath ? dialogs.chooseTransferPath(input as { mode: TransferPathMode; suggestedName?: string }) : Promise.resolve(null)
          : channel === "realm:chooseArtifactPath"
            ? () => dialogs.chooseArtifactPath ? dialogs.chooseArtifactPath(input as { format: ArtifactFormat; suggestedName: string }) : Promise.resolve(null)
            : method && typeof commands[method] === "function"
              ? (commands[method] as unknown as (value?: unknown) => Promise<unknown>).bind(commands)
              : undefined;
        if (!operation) throw new RealmError("invalid_input", "Realm IPC channel is not implemented.");
        const run = serial.then(() => input === undefined ? operation() : operation(input));
        serial = run.then(() => undefined, () => undefined);
        return await run;
      } catch (error) {
        const normalized = asRealmError(error);
        throw { code: normalized.code, message: normalized.message };
      }
    });
  }
  const close = (() => { accepting = false; for (const channel of REALM_IPC_CHANNELS) ipcMain.removeHandler?.(channel); }) as RealmIpcRegistration;
  close.drain = async () => { accepting = false; await serial; };
  return close;
}

export { handlers as realmIpcHandlers };
