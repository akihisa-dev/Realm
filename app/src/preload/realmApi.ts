import { ipcRenderer } from "electron";
import type { ElectronRealmApi } from "../shared/realmContract";

type Invoke = (channel: string, input?: unknown) => Promise<unknown>;
const invoke = (channel: string, input?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, input);
export function createRealmApi(call: Invoke = invoke): ElectronRealmApi {
  const request = <T>(method: string, input?: unknown): Promise<T> => call("realm:" + method, input) as Promise<T>;
  return {
    listProjects: () => request("listProjects"), createProject: (input) => request("createProject", input), openProject: (input) => request("openProject", input), importProject: (input) => request("importProject", input), exportProject: (input) => request("exportProject", input), writeArtifact: (input) => request("writeArtifact", input), saveProject: (input) => request("saveProject", input), updateProjectSettings: (input) => request("updateProjectSettings", input), replaceTerrainLayer: (input) => request("replaceTerrainLayer", input), replaceRegionLayer: (input) => request("replaceRegionLayer", input), replaceObjectLayer: (input) => request("replaceObjectLayer", input), importAsset: (input) => request("importAsset", input), importAssetsBatch: (input) => request("importAssetsBatch", input), readAsset: (input) => request("readAsset", input), deleteAsset: (input) => request("deleteAsset", input), deleteAssetsBatch: (input) => request("deleteAssetsBatch", input), undoProject: () => request("undoProject"), redoProject: () => request("redoProject"), closeProject: () => request("closeProject"), getOpenProject: () => request("getOpenProject"), chooseTransferPath: (input) => request("chooseTransferPath", input), chooseArtifactPath: (input) => request("chooseArtifactPath", input),
  };
}
export const realmApi = createRealmApi();
