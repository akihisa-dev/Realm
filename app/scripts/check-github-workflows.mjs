import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsRoot = path.resolve(appRoot, "..", ".github", "workflows");
const workflowNames = await readdir(workflowsRoot);
const failures = [];

const issueTemplateRoot = path.resolve(workflowsRoot, "..", "ISSUE_TEMPLATE");
const yamlFiles = [
  ...workflowNames.filter((name) => /\.ya?ml$/.test(name)).map((name) => path.join(workflowsRoot, name)),
  ...(await readdir(issueTemplateRoot)).filter((name) => /\.ya?ml$/.test(name)).map((name) => path.join(issueTemplateRoot, name)),
];
try {
  execFileSync("ruby", [
    "-e",
    "require 'yaml'; ARGV.each { |file| YAML.safe_load(File.read(file), [], [], true, file) }",
    ...yamlFiles,
  ], { stdio: "pipe" });
} catch {
  failures.push("GitHub workflow or issue-form YAML could not be parsed.");
}

for (const workflowName of workflowNames.filter((name) => /\.ya?ml$/.test(name))) {
  const source = await readFile(path.join(workflowsRoot, workflowName), "utf8");
  if (/pull_request_target\s*:/.test(source)) failures.push(`${workflowName} uses pull_request_target.`);
  if (/secrets\s*\./.test(source)) failures.push(`${workflowName} reads repository secrets.`);
  if (/\$\{\{\s*inputs\.[^}]+\}\}/.test(source)) failures.push(`${workflowName} interpolates a workflow input directly.`);
  if (/uses:\s*actions\/checkout@/.test(source) && !/persist-credentials:\s*false/.test(source)) {
    failures.push(`${workflowName} must disable persisted checkout credentials.`);
  }
  for (const match of source.matchAll(/uses:\s*([^\s]+)@([^\s]+)/g)) {
    const reference = match[2] ?? "";
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      failures.push(`${workflowName} must pin the action to a full immutable commit: ${match[0]}.`);
    }
  }
  const allowsWrite = /permissions:\s*\n(?:[ \t]+[^\n]+\n)*?[ \t]+contents:\s*write/m.test(source);
  if (allowsWrite && workflowName !== "draft-release.yml") {
    failures.push(`${workflowName} grants contents: write outside the draft release workflow.`);
  }
  if (!allowsWrite && !/permissions:\s*\n[ \t]+contents:\s*read/m.test(source)) {
    failures.push(`${workflowName} must declare contents: read.`);
  }
  if (!/concurrency:\s*\n/.test(source)) failures.push(`${workflowName} has no concurrency policy.`);
  if (/runs-on:\s*macos-(?!15\b)/.test(source)) failures.push(`${workflowName} must use the pinned macos-15 arm64 image.`);

  const isApplicationWorkflow = new Set(["ci.yml", "pre-release-verification.yml", "draft-release.yml"]).has(workflowName);
  if (isApplicationWorkflow) {
    for (const required of ["node-version-file: .node-version", "pnpm@11.20.0", "rustup toolchain install 1.97.1"]) {
      if (!source.includes(required)) failures.push(`${workflowName} is missing pinned setup: ${required}.`);
    }
  }
  if (workflowName === "ci.yml" && !source.includes("pnpm verify:ci")) {
    failures.push("ci.yml does not run the application CI gate.");
  }
  if (["ci.yml", "secret-guard.yml"].includes(workflowName)
      && (!source.includes("branches: [main]") || !source.includes("Scan pushed commits"))) {
    failures.push(`${workflowName} does not scan commits pushed to main.`);
  }
  if (workflowName === "pre-release-verification.yml" && !source.includes("retention-days: 7")) {
    failures.push("pre-release-verification.yml must keep evidence for exactly seven days.");
  }
  if (workflowName === "draft-release.yml"
      && (source.includes("release-assets/*") || !source.includes("mindepth 1 -maxdepth 1"))) {
    failures.push("draft-release.yml must validate and upload only the four named release assets.");
  }
  if (["pre-release-verification.yml", "draft-release.yml"].includes(workflowName)
      && !source.includes("pnpm verify:local:release")) {
    failures.push(`${workflowName} does not run the local release gate.`);
  }
}

if (failures.length > 0) {
  console.error("GitHub workflow validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`GitHub workflow validation passed (${workflowNames.length} files).`);
