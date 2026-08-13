import { contextBridge } from "electron";

import { realmApi } from "./api";

contextBridge.exposeInMainWorld("realmApi", realmApi);
