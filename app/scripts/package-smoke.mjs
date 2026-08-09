import { access } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = path.join(
  appRoot,
  "src-tauri",
  "target",
  "aarch64-apple-darwin",
  "release",
  "bundle",
  "macos",
  "Realm.app",
);
const plist = path.join(appBundle, "Contents", "Info.plist");
const executableName = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", plist], { encoding: "utf8" }).trim();
if (!executableName || path.basename(executableName) !== executableName) throw new Error("Invalid bundle executable name.");
const executable = path.join(appBundle, "Contents", "MacOS", executableName);

await access(executable);
const child = spawn(executable, [], {
  env: { ...process.env, REALM_PACKAGE_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const result = await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    resolve({ alive: true });
  }, 5_000);
  child.once("exit", (code, signal) => {
    clearTimeout(timeout);
    resolve({ alive: false, code, signal });
  });
});

if (!result.alive) {
  throw new Error(`Packaged Realm exited during smoke test (${JSON.stringify(result)}): ${stderr.trim()}`);
}

console.log("Packaged Realm remained healthy for the five-second launch smoke.");
