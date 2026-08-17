import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import packageJson from "../../package.json";

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: `Realm ${packageJson.version}`,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  };
}

export function showWhenReady(window: BrowserWindow): void {
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
}
