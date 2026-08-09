import { access, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(appRoot, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const appBundle = path.join(bundleRoot, "macos", "Realm.app");
const dmgDirectory = path.join(bundleRoot, "dmg");
const plist = path.join(appBundle, "Contents", "Info.plist");

await access(plist);
const plistValue = (key) => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" }).trim();
const executableName = plistValue("CFBundleExecutable");
if (!executableName || path.basename(executableName) !== executableName) throw new Error("Invalid bundle executable name.");
const executable = path.join(appBundle, "Contents", "MacOS", executableName);
await access(executable);
const dmgFiles = (await readdir(dmgDirectory)).filter((name) => name.endsWith(".dmg"));
if (dmgFiles.length !== 1) throw new Error(`Expected one DMG artifact; found ${dmgFiles.length}.`);
const expectedDmg = `Realm_${packageJson.version}_aarch64.dmg`;
if (dmgFiles[0] !== expectedDmg) throw new Error(`Unexpected DMG name: ${dmgFiles[0]}.`);
const dmgPath = path.join(dmgDirectory, expectedDmg);
execFileSync("hdiutil", ["verify", dmgPath], { stdio: "pipe" });

const fileDescription = execFileSync("file", [executable], { encoding: "utf8" });
if (!fileDescription.includes("arm64") || fileDescription.includes("x86_64")) {
  throw new Error(`Packaged executable is not arm64-only: ${fileDescription.trim()}`);
}
execFileSync("plutil", ["-lint", plist], { stdio: "inherit" });
if (plistValue("CFBundleIdentifier") !== "dev.akihisa.realm") throw new Error("Unexpected bundle identifier.");
if (plistValue("CFBundleShortVersionString") !== packageJson.version) throw new Error("Unexpected bundle version.");
if (plistValue("LSMinimumSystemVersion") !== "14.0") throw new Error("Unexpected minimum macOS version.");
const documentTypes = execFileSync("plutil", ["-extract", "CFBundleDocumentTypes", "json", "-o", "-", plist], { encoding: "utf8" });
if (!documentTypes.includes("realmmap")) throw new Error("The Realm project file association is missing.");

let signing = "unsigned";
try {
  execFileSync("codesign", ["--verify", "--deep", "--strict", appBundle], { stdio: "pipe" });
  signing = "ad-hoc or signed";
} catch {
  // Signing and notarization are intentionally outside the initial artifact path.
}

console.log(`Package artifacts passed (${signing}): ${path.relative(appRoot, appBundle)} and ${dmgFiles[0]}.`);
