import { BrowserWindow, type App } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadDevServerUrlWithRetry } from "./devServerLoader";
import { createMainWindowOptions, showWhenReady } from "./windowOptions";
import { installWindowSecurityPolicy, isAllowedRendererNavigation } from "./windowSecurity";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export function createMainWindow(app: Pick<App, "quit">): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");
  const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const window = new BrowserWindow(createMainWindowOptions(preloadPath));
  const rendererUrl = pathToFileURL(rendererPath).toString();
  installWindowSecurityPolicy(window, (url) => isAllowedRendererNavigation(url, rendererUrl, MAIN_WINDOW_VITE_DEV_SERVER_URL), { devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL });
  showWhenReady(window);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void loadDevServerUrlWithRetry(window, MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(rendererPath);
  }
  window.on("closed", () => app.quit());
  return window;
}
