import { contextBridge, ipcRenderer } from "electron";

import { realmApi } from "./api";

contextBridge.exposeInMainWorld("realmApi", realmApi);
if (process.env.REALM_ELECTRON_SMOKE_REPORT_PATH) {
  ipcRenderer.send("realm:smoke-ready");
}
