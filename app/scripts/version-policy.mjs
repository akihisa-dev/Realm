import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "check";
if (!new Set(["check", "check-staged"]).has(command)) {
  console.error("Usage: version-policy.mjs check|check-staged");
  process.exit(2);
}

const readVersionFile = async (repositoryPath, appPath) => command === "check-staged"
  ? execFileSync("git", ["show", `:${repositoryPath}`], { cwd: appRoot, encoding: "utf8" })
  : readFile(path.join(appRoot, appPath), "utf8");
const packageJson = JSON.parse(await readVersionFile("app/package.json", "package.json"));
const cargoToml = await readVersionFile("app/src-tauri/Cargo.toml", "src-tauri/Cargo.toml");
const tauriConfig = JSON.parse(await readVersionFile("app/src-tauri/tauri.conf.json", "src-tauri/tauri.conf.json"));
const version = packageJson.version;
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!semverPattern.test(version) || cargoVersion !== version || tauriConfig.version !== version) {
  console.error(`Version mismatch: package=${version}, cargo=${cargoVersion ?? "missing"}, tauri=${tauriConfig.version ?? "missing"}.`);
  process.exit(1);
}

console.log(`Version policy passed (${version}).`);
