import { ipcRenderer } from "electron";

import { createRealmApi } from "./realmApi";
import type { ElectronRealmApi } from "../shared/realmContract";

type Invoke = (channel: string, input?: unknown) => Promise<unknown>;
const invoke: Invoke = (channel, input) => ipcRenderer.invoke(channel, input);

/** The only renderer-facing bridge. Native handles and filesystem objects never cross it. */
export const realmApi: ElectronRealmApi & { apiContractVersion: 1 } = {
  apiContractVersion: 1,
  ...createRealmApi(invoke),
};

export type RealmApi = typeof realmApi;
