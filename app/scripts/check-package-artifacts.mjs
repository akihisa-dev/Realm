import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { forgeDmgFileName, macBuildTarget } from "./mac-build-target.mjs";
import { inspectPackagedResources } from "./package-content-report.mjs";

const exec = promisify(execFile);

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8"));
const packageDir = path.join(appDir, macBuildTarget.outputDirectory, macBuildTarget.packageDirectoryName);
const appBundle = path.join(packageDir, "Realm.app");
const executable = path.join(appBundle, "Contents", "MacOS", "Realm");
const resources = path.join(appBundle, "Contents", "Resources");
const infoPlist = path.join(appBundle, "Contents", "Info.plist");
await access(executable);
await access(infoPlist);
await access(path.join(resources, "realm_has_moved.dylib"));
await access(path.join(resources, "realm_atomic_publish"), fsConstants.X_OK);
const report = await inspectPackagedResources(resources);
for (const legalPath of ["LICENSE", "THIRD_PARTY_NOTICES.md", "sbom/realm-dependencies.cdx.json"]) {
  await access(path.join(resources, legalPath));
}
const { stdout: fileDescription } = await exec("file", [executable]);
if (!/Mach-O.*arm64/u.test(fileDescription)) {
  throw new Error(`Packaged executable is not arm64: ${fileDescription.trim()}`);
}
const { stdout: extensionDescription } = await exec("file", [path.join(resources, "realm_has_moved.dylib")]);
if (!/Mach-O.*arm64/u.test(extensionDescription)) {
  throw new Error(`Packaged SQLite extension is not arm64: ${extensionDescription.trim()}`);
}
const { stdout: atomicHelperDescription } = await exec("file", [path.join(resources, "realm_atomic_publish")]);
if (!/Mach-O.*arm64/u.test(atomicHelperDescription) || !/executable/u.test(atomicHelperDescription)) {
  throw new Error(`Packaged atomic publication helper is not an arm64 executable: ${atomicHelperDescription.trim()}`);
}
const { stdout: plistJson } = await exec("plutil", ["-convert", "json", "-o", "-", "--", infoPlist]);
const metadata = JSON.parse(plistJson);
if (metadata.CFBundleIdentifier !== "dev.akihisa.realm") {
  throw new Error(`Unexpected bundle identifier: ${metadata.CFBundleIdentifier ?? "missing"}`);
}
if (metadata.CFBundleShortVersionString !== packageJson.version) {
  throw new Error(`Bundle version mismatch: expected ${packageJson.version}, found ${metadata.CFBundleShortVersionString ?? "missing"}`);
}
const dmg = path.join(appDir, macBuildTarget.outputDirectory, macBuildTarget.dmgDirectory, forgeDmgFileName(packageJson.version));
await access(dmg);
console.log(`[check:package] OK: ${appBundle} (arm64, ${report.asarFileCount} asar files, metadata and legal resources checked)`);
