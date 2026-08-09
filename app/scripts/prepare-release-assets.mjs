import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const bundleRoot = path.join(appRoot, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle");
const dmgRoot = path.join(bundleRoot, "dmg");
const releaseRoot = path.join(repositoryRoot, "release-assets");
const dmgs = (await readdir(dmgRoot)).filter((entry) => entry.endsWith(".dmg"));

if (dmgs.length !== 1) throw new Error(`Expected one DMG, found ${dmgs.length}.`);

try {
  await mkdir(releaseRoot);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    throw new Error("release-assets already exists. Inspect and move it before preparing another release.");
  }
  throw error;
}

const artifactName = `Realm-${packageJson.version}-macOS-arm64.dmg`;
const artifactPath = path.join(releaseRoot, artifactName);
try {
  await copyFile(path.join(dmgRoot, dmgs[0]), artifactPath);
  await copyFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), path.join(releaseRoot, "THIRD_PARTY_NOTICES.md"));
  await copyFile(
    path.join(repositoryRoot, "sbom", "realm-dependencies.cdx.json"),
    path.join(releaseRoot, "realm-dependencies.cdx.json"),
  );
  const digest = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  await writeFile(path.join(releaseRoot, `${artifactName}.sha256`), `${digest}  ${artifactName}\n`, "utf8");
} catch (error) {
  await rm(releaseRoot, { recursive: true });
  throw error;
}

console.log(`Prepared release-assets/${artifactName} with checksum, notices, and SBOM.`);
