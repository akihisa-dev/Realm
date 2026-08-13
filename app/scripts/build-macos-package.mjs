import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forgeDmgFileName, macBuildTarget } from "./mac-build-target.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const packageRoot = path.join(appRoot, macBuildTarget.outputDirectory, macBuildTarget.packageDirectoryName);
const appBundle = path.join(packageRoot, "Realm.app");
const dmgRoot = path.join(appRoot, macBuildTarget.outputDirectory, macBuildTarget.dmgDirectory);
const dmgPath = path.join(dmgRoot, forgeDmgFileName(packageJson.version));

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS package can only be built on Apple Silicon macOS.");
}
if (!(await stat(appBundle).catch(() => null))?.isDirectory()) {
  throw new Error("Realm.app is missing; run pnpm package:mac first.");
}

await mkdir(dmgRoot, { recursive: true });
await rm(dmgPath, { force: true });
execFileSync("hdiutil", [
  "create",
  "-quiet",
  "-volname", "Realm",
  "-srcfolder", packageRoot,
  "-format", "UDZO",
  "-ov",
  dmgPath,
], { stdio: "inherit" });

if (!(await stat(dmgPath).catch(() => null))?.isFile()) {
  throw new Error("hdiutil did not create the expected Realm DMG.");
}
console.log(`Built ${path.relative(appRoot, dmgPath)} without mounting a Finder volume.`);
