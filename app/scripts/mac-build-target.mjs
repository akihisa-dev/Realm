export const macBuildTarget = Object.freeze({
  arch: "arm64",
  platform: "darwin",
  outputDirectory: "out/darwin",
  packageDirectoryName: "Realm-darwin-arm64",
  dmgDirectory: "make",
});

export function assertAppleSiliconHost(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error(`Realm macOS builds require an Apple Silicon Mac. Actual host: ${platform}/${arch}`);
  }
}

export function forgeBuildArguments(command) {
  if (command !== "make" && command !== "package") throw new Error("Usage: node scripts/run-forge-build.mjs <make|package>");
  return ["exec", "electron-forge", command, "--platform", "darwin", "--arch", "arm64"];
}

export function forgeDmgFileName(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("DMG artifact version must use MAJOR.MINOR.PATCH.");
  return `Realm-${version}-arm64.dmg`;
}
