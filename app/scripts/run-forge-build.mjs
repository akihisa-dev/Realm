import { spawn, spawnSync } from "node:child_process";
import { assertAppleSiliconHost, forgeBuildArguments } from "./mac-build-target.mjs";

const command = process.argv[2];
if (!command || process.argv.length !== 3) {
  console.error("Usage: node scripts/run-forge-build.mjs <make|package>");
  process.exit(2);
}
try {
  assertAppleSiliconHost();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const nativeTools = spawnSync(process.execPath, ["scripts/build-native-storage-tools.mjs"], { cwd: process.cwd(), stdio: "inherit", shell: false });
if (nativeTools.status !== 0) process.exit(nativeTools.status ?? 1);
const child = spawn("pnpm", forgeBuildArguments(command), { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, REALM_FORGE_OUT_DIR: "out/darwin" } });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
