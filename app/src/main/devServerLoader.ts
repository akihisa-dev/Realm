import type { BrowserWindow } from "electron";

export async function loadDevServerUrlWithRetry(window: BrowserWindow, url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await window.loadURL(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Electron renderer dev server was not reachable: ${url}`);
}
