import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
const pinnedTools = [
  { command: "rustc", args: ["--version"], label: "Rust", expected: "1.97.1", pattern: /^rustc\s+(\S+)/u },
  { command: "cargo-deny", args: ["--version"], label: "cargo-deny", expected: "0.20.2", pattern: /^cargo-deny\s+(\S+)/u },
];

if (actualNode !== expectedNode) {
  failures.push(`Node.js ${expectedNode} is required; found ${actualNode}.`);
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  failures.push(`Realm development requires macOS arm64; found ${process.platform} ${process.arch}.`);
}

if (pnpmMatch && pnpmMatch[1] !== expectedPnpm) {
  failures.push(`pnpm ${expectedPnpm} is required; found ${pnpmMatch[1]}.`);
}

for (const tool of pinnedTools) {
  try {
    const output = execFileSync(tool.command, tool.args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const found = tool.pattern.exec(output)?.[1];
    if (found !== tool.expected) failures.push(`${tool.label} ${tool.expected} is required; found ${found ?? "an unknown version"}.`);
  } catch {
    failures.push(`${tool.label} ${tool.expected} is required but is not available.`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`Runtime policy passed (Node.js ${actualNode}, pnpm ${pnpmMatch?.[1] ?? expectedPnpm}, Rust 1.97.1, cargo-deny 0.20.2, macOS arm64).`);
