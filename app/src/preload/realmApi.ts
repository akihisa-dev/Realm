import { ipcRenderer } from "electron";
import type { ElectronRealmApi } from "../shared/realmContract";

type Invoke = (channel: string, input?: unknown) => Promise<unknown>;
const invoke = (channel: string, input?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, input);
export function createRealmApi(call: Invoke = invoke): ElectronRealmApi {
  const request = <T>(method: string, input?: unknown): Promise<T> => call("realm:" + method, input) as Promise<T>;
  return {
    listProjects: () => request("listProjects"), createProject: (input) => request("createProject", input), openProject: (input) => request("openProject", input), importProject: (input) => request("importProject", input), exportProject: (input) => request("exportProject", input), writeArtifact: (input) => request("writeArtifact", input), saveProject: (input) => request("saveProject", input), updateProjectSettings: (input) => request("updateProjectSettings", input), createFeature: (input) => request("createFeature", input), createFeaturesBatch: (input) => request("createFeaturesBatch", input), reviseFeaturesBatch: (input) => request("reviseFeaturesBatch", input), deleteFeaturesBatch: (input) => request("deleteFeaturesBatch", input), setFeaturesLocked: (input) => request("setFeaturesLocked", input), importAsset: (input) => request("importAsset", input), importAssetsBatch: (input) => request("importAssetsBatch", input), readAsset: (input) => request("readAsset", input), deleteAsset: (input) => request("deleteAsset", input), deleteAssetsBatch: (input) => request("deleteAssetsBatch", input), reviseFeature: (input) => request("reviseFeature", input), deleteFeature: (input) => request("deleteFeature", input), undoProject: () => request("undoProject"), redoProject: () => request("redoProject"), createMapShapes: (input) => request("createMapShapes", input), updateMapShapes: (input) => request("updateMapShapes", input), deleteMapShapes: (input) => request("deleteMapShapes", input), closeProject: () => request("closeProject"), getOpenProject: () => request("getOpenProject"), chooseTransferPath: (input) => request("chooseTransferPath", input), chooseArtifactPath: (input) => request("chooseArtifactPath", input),
  };
}
export const realmApi = createRealmApi();
