import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forgeDmgFileName, macBuildTarget } from "./mac-build-target.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const dmgRoot = path.join(appRoot, macBuildTarget.outputDirectory, macBuildTarget.dmgDirectory);
const releaseRoot = path.join(repositoryRoot, "release-assets");
const artifactName = forgeDmgFileName(packageJson.version);
const artifactSource = path.join(dmgRoot, artifactName);
if (!(await readdir(dmgRoot).catch(() => [])).includes(artifactName)) {
  throw new Error(`Expected ${path.relative(appRoot, artifactSource)}. Run pnpm make:mac first.`);
}

try {
  await mkdir(releaseRoot);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    throw new Error("release-assets already exists. Inspect and move it before preparing another release.");
  }
  throw error;
}

const releaseArtifactName = `Realm-${packageJson.version}-macOS-arm64.dmg`;
try {
  await copyFile(artifactSource, path.join(releaseRoot, releaseArtifactName));
  await copyFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), path.join(releaseRoot, "THIRD_PARTY_NOTICES.md"));
  await copyFile(
    path.join(repositoryRoot, "sbom", "realm-dependencies.cdx.json"),
    path.join(releaseRoot, "realm-dependencies.cdx.json"),
  );
  const releaseArtifactPath = path.join(releaseRoot, releaseArtifactName);
  const digest = createHash("sha256").update(await readFile(releaseArtifactPath)).digest("hex");
  await writeFile(path.join(releaseRoot, `${releaseArtifactName}.sha256`), `${digest}  ${releaseArtifactName}\n`, "utf8");
} catch (error) {
  await rm(releaseRoot, { recursive: true });
  throw error;
}

console.log(`Prepared release-assets/${releaseArtifactName} with checksum, notices, and SBOM.`);
