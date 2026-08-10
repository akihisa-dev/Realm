import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function assertInstalledDependencies(appDirectory) {
  const expectedPath = resolve(appDirectory, "pnpm-lock.yaml");
  const installedPath = resolve(appDirectory, "node_modules/.pnpm/lock.yaml");
  let expected;
  let installed;
  try {
    expected = readFileSync(expectedPath);
    installed = readFileSync(installedPath);
  } catch {
    throw new Error("Dependencies are not installed. Run 'pnpm install --frozen-lockfile'.");
  }
  if (!expected.equals(installed)) {
    throw new Error("Installed dependencies are stale. Run 'pnpm install --frozen-lockfile'.");
  }
  return true;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    assertInstalledDependencies(resolve(dirname(scriptPath), ".."));
    console.log("Installed dependencies match pnpm-lock.yaml.");
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
