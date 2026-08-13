import { access, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { macBuildTarget } from "./mac-build-target.mjs";

const kind = process.argv[2];
if (kind !== "development" && kind !== "package") { console.error("Usage: pnpm smoke:electron <development|package> [--evidence-dir path]"); process.exit(2); }
const index = process.argv.indexOf("--evidence-dir");
const evidence = index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : await (async () => { const d = await import("node:fs/promises"); return d.mkdtemp(path.join(os.tmpdir(), "realm-electron-smoke-")); })();
await mkdir(evidence, { recursive: true });
const checks = { platform: process.platform === "darwin", architecture: process.arch === "arm64", noGuiLaunch: true };
if (kind === "package") { const executable = path.resolve("out", "darwin", macBuildTarget.packageDirectoryName, "Realm.app", "Contents", "MacOS", "Realm"); try { await access(executable); checks.packageExecutable = true; } catch { checks.packageExecutable = false; } }
const report = { status: Object.values(checks).every(Boolean) ? "passed" : "failed", kind, checks, evidenceDirectory: evidence, guiLaunched: false };
await writeFile(path.join(evidence, `${kind}-report.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
if (report.status !== "passed") process.exitCode = 1;
