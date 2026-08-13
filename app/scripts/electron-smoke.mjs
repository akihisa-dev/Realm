import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { macBuildTarget } from "./mac-build-target.mjs";

const kind = process.argv[2];
if (kind !== "development" && kind !== "package") { console.error("Usage: pnpm smoke:electron <development|package> [--evidence-dir path]"); process.exit(2); }
const index = process.argv.indexOf("--evidence-dir");
const evidence = index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : await mkdtemp(path.join(os.tmpdir(), "realm-electron-smoke-"));
await mkdir(evidence, { recursive: true });
const userData = await mkdtemp(path.join(os.tmpdir(), "realm-electron-user-data-"));
const reportPath = path.join(evidence, `${kind}-report.json`);
const checks = { platform: process.platform === "darwin", architecture: process.arch === "arm64" };
let command = process.execPath; let args = [path.resolve("scripts", "start-development-app.mjs"), "--user-data-dir", userData];
if (kind === "package") { const executable = path.resolve("out", "darwin", macBuildTarget.packageDirectoryName, "Realm.app", "Contents", "MacOS", "Realm"); try { await access(executable); checks.packageExecutable = true; } catch { checks.packageExecutable = false; } const runtime = process.env.REALM_PACKAGE_SMOKE_RUNTIME === "1"; if (!runtime) { const report = { status: Object.values(checks).every(Boolean) ? "passed" : "failed", kind, checks, evidenceDirectory: evidence, guiLaunched: false }; await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report)); process.exitCode = report.status === "passed" ? 0 : 1; await rm(userData, { recursive: true, force: true }); process.exit(); } command = executable; args = []; }
if (!Object.values(checks).every(Boolean)) { const report = { status: "failed", kind, checks, evidenceDirectory: evidence, guiLaunched: false }; await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); process.exitCode = 1; }
else {
  const child = spawn(command, args, { cwd: path.resolve("."), env: { ...process.env, REALM_ELECTRON_SMOKE_KIND: kind, REALM_ELECTRON_SMOKE_REPORT_PATH: reportPath, REALM_ELECTRON_SMOKE_USER_DATA_DIR: userData }, stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
  const code = await new Promise((resolve) => { child.once("error", () => resolve(1)); child.once("exit", (value) => resolve(value ?? 1)); });
  clearTimeout(timer); const report = JSON.parse(await readFile(reportPath, "utf8")).status === "passed" && code === 0;
  console.log(JSON.stringify({ kind, status: report ? "passed" : "failed", evidenceDirectory: evidence })); process.exitCode = report ? 0 : 1;
}
await rm(userData, { recursive: true, force: true });
