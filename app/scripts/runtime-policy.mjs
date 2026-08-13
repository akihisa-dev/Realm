import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const expectedNode = (await readFile(path.join(repositoryRoot, ".node-version"), "utf8")).trim();
const expectedPnpm = String(packageJson.packageManager).replace(/^pnpm@/, "");
const actualNode = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? "";
const pnpmMatch = /(?:^|\s)pnpm\/([^\s]+)/.exec(userAgent);

const failures = [];
if (actualNode !== expectedNode) {
  failures.push(`Node.js ${expectedNode} is required; found ${actualNode}.`);
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  failures.push(`Realm development requires macOS arm64; found ${process.platform} ${process.arch}.`);
}

if (pnpmMatch && pnpmMatch[1] !== expectedPnpm) {
  failures.push(`pnpm ${expectedPnpm} is required; found ${pnpmMatch[1]}.`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`Runtime policy passed (Node.js ${actualNode}, pnpm ${pnpmMatch?.[1] ?? expectedPnpm}, macOS arm64).`);
