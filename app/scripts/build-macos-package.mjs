import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const bundleRoot = path.join(appRoot, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle");
const macosRoot = path.join(bundleRoot, "macos");
const appBundle = path.join(macosRoot, "Realm.app");
const dmgRoot = path.join(bundleRoot, "dmg");
const dmgPath = path.join(dmgRoot, `Realm_${packageJson.version}_aarch64.dmg`);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS package can only be built on Apple Silicon macOS.");
}
if (!(await stat(appBundle).catch(() => null))?.isDirectory()) {
  throw new Error("Realm.app is missing; build the Tauri application bundle first.");
}

await mkdir(dmgRoot, { recursive: true });
await rm(dmgPath, { force: true });
execFileSync("hdiutil", [
  "create",
  "-quiet",
  "-volname", "Realm",
  "-srcfolder", macosRoot,
  "-format", "UDZO",
  "-ov",
  dmgPath,
], { stdio: "inherit" });

if (!(await stat(dmgPath).catch(() => null))?.isFile()) {
  throw new Error("hdiutil did not create the expected Realm DMG.");
}
console.log(`Built ${path.relative(appRoot, dmgPath)} without mounting a Finder volume.`);
