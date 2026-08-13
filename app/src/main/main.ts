import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createRealmCommands } from "./commands/realmCommands";
import { registerIpcHandlers, type RealmIpcRegistration } from "./ipc/registerIpcHandlers";
import { createMainWindow } from "./mainWindow";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let closeIpcHandlers: RealmIpcRegistration | null = null;
let commands: ReturnType<typeof createRealmCommands> | null = null;
let quitting = false;

function configureUserDataDirectory(): void {
  const override = process.env.REALM_DEV_USER_DATA_DIR;
  if (override && path.isAbsolute(override)) app.setPath("userData", override);
}

function registerRealmIpc(window: BrowserWindow): void {
  commands ??= createRealmCommands({ libraryDirectory: path.join(app.getPath("userData"), "library") });
  closeIpcHandlers?.();
  const productionRendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const allowedRendererOrigins = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? [MAIN_WINDOW_VITE_DEV_SERVER_URL]
    : [pathToFileURL(productionRendererPath).toString()];
  closeIpcHandlers = registerIpcHandlers(ipcMain, commands, {
    allowedSenderIds: [window.webContents.id],
    allowedRendererOrigins,
    maxPayloadBytes: 80 * 1024 * 1024,
  }, {
    chooseTransferPath: async ({ mode, suggestedName }) => {
      if (mode === "export") {
        const result = await dialog.showSaveDialog(window, {
          defaultPath: suggestedName ?? "Realm移行データ.realmmap",
          filters: [{ name: "Realm移行データ", extensions: ["realmmap"] }],
          properties: ["showOverwriteConfirmation"],
        });
        if (result.canceled || !result.filePath) return null;
        return result.filePath.toLowerCase().endsWith(".realmmap") ? result.filePath : result.filePath + ".realmmap";
      }
      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [{ name: "Realm移行データ", extensions: ["realmmap"] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    chooseArtifactPath: async ({ format, suggestedName }) => {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: suggestedName + "." + format,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        properties: ["showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      return result.filePath.toLowerCase().endsWith("." + format) ? result.filePath : result.filePath + "." + format;
    },
  });
}

function createWindow(): void {
  mainWindow = createMainWindow(app);
  registerRealmIpc(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setName("Realm");
  configureUserDataDirectory();

  app.whenReady().then(async () => {
    if (process.platform !== "darwin") {
      app.quit();
      return;
    }
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error: unknown) => {
    console.error("Realm failed to initialize", error);
    app.exit(1);
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const registration = closeIpcHandlers;
    void (async () => {
      // Stop accepting new IPC calls, then wait for already-dispatched calls to
      // leave the serialized mutation queue before closing SQLite.
      await registration?.drain();
      await commands?.closeProject();
      registration?.();
      closeIpcHandlers = null;
      app.quit();
    })().catch((error: unknown) => {
      console.error("Realm failed to close cleanly", error);
      registration?.();
      closeIpcHandlers = null;
      app.exit(1);
    });
  });
}

void MAIN_WINDOW_VITE_DEV_SERVER_URL;
