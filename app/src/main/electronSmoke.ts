import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { App, BrowserWindow, IpcMain } from "electron";

const REPORT = "REALM_ELECTRON_SMOKE_REPORT_PATH";
const USER_DATA = "REALM_ELECTRON_SMOKE_USER_DATA_DIR";
const KIND = "REALM_ELECTRON_SMOKE_KIND";
export type ElectronSmokeConfig = { kind: "development" | "package"; reportPath: string; userDataPath: string };
type Checks = { mainWindowCreated: boolean; rendererLoaded: boolean; preloadApiAvailable: boolean; initialLibraryIsEmpty: boolean };

export function resolveElectronSmokeConfig(environment: NodeJS.ProcessEnv = process.env): ElectronSmokeConfig | null {
  const reportPath = environment[REPORT], userDataPath = environment[USER_DATA], kind = environment[KIND];
  if (!reportPath && !userDataPath && !kind) return null;
  if (!reportPath || !userDataPath || (kind !== "development" && kind !== "package")) throw new Error(`${REPORT}, ${USER_DATA}, and ${KIND} must be set together for an Electron smoke run.`);
  if (!path.isAbsolute(reportPath) || !path.isAbsolute(userDataPath)) throw new Error("Electron smoke report and user data paths must be absolute paths.");
  return { kind, reportPath: path.resolve(reportPath), userDataPath: path.resolve(userDataPath) };
}

export function configureElectronSmokeUserDataPath(app: Pick<App, "setPath">, config: ElectronSmokeConfig | null): boolean {
  if (!config) return false;
  app.setPath("userData", config.userDataPath);
  return true;
}

export function attachElectronSmoke(app: Pick<App, "quit" | "exit">, window: BrowserWindow, config: ElectronSmokeConfig | null, ipcMain: Pick<IpcMain, "once">, listProjects: () => Promise<unknown[]>): void {
  if (!config) return;
  let finished = false;
  let rendererLoaded = false;
  let preloadReady = false;
  const maybeFinish = async () => {
    if (!rendererLoaded || !preloadReady || finished) return;
    const projects = await listProjects();
    const checks = { mainWindowCreated: true, rendererLoaded: true, preloadApiAvailable: true, initialLibraryIsEmpty: projects.length === 0 };
    const passed = Object.values(checks).every(Boolean);
    void finish(passed ? "passed" : "failed", checks, passed ? undefined : "One or more startup checks did not pass.");
  };
  const finish = async (status: "passed" | "failed", checks: Checks, diagnostic?: string) => {
    if (finished) return; finished = true;
    const report = { status, kind: config.kind, checks, diagnostics: diagnostic ? [diagnostic] : [], userDataDirectory: config.userDataPath, guiLaunched: true, finishedAt: new Date().toISOString() };
    try { await mkdir(path.dirname(config.reportPath), { recursive: true }); await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); } catch { app.exit(1); return; }
    if (status === "passed") app.quit(); else app.exit(1);
  };
  const failed = (diagnostic: string) => finish("failed", { mainWindowCreated: true, rendererLoaded: false, preloadApiAvailable: false, initialLibraryIsEmpty: false }, diagnostic);
  window.webContents.once("did-fail-load", (_event, code, description) => void failed(`Renderer failed to load (${code}): ${description}`));
  ipcMain.once("realm:smoke-ready", (event: { sender: { id: number } }) => {
    if (event.sender.id !== window.webContents.id) return void failed("Unauthorized smoke readiness sender.");
    preloadReady = true;
    void maybeFinish();
  });
  window.webContents.once("did-finish-load", () => {
    rendererLoaded = true;
    void maybeFinish();
  });
}
