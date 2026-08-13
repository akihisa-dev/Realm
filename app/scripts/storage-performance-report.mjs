import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "baselines/storage-performance.json");
export const PERFORMANCE_TEST_PATH = "src/migration-tests/storagePerformance.test.ts";
export const REQUIRED_OPERATIONS = ["create", "open", "read", "terrainBatch", "save", "backup"];

export function readBaseline(path = BASELINE_PATH) {
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  if (!baseline || baseline.reportVersion !== 1 || baseline.schemaVersion !== 9 || !baseline.fixture || !baseline.limitsMs || !baseline.rowOperations) {
    throw new Error("Storage performance baseline is invalid.");
  }
  for (const name of REQUIRED_OPERATIONS) {
    if (!Number.isFinite(baseline.limitsMs[name]) || baseline.limitsMs[name] <= 0 || !Number.isInteger(baseline.rowOperations[name]) || baseline.rowOperations[name] < 1) {
      throw new Error(`Storage performance baseline operation is invalid: ${name}`);
    }
  }
  return baseline;
}

export function evaluateReport(report, baseline) {
  const failures = [];
  if (!report || report.reportVersion !== 1) failures.push("reportVersion");
  if (report?.schemaVersion !== baseline.schemaVersion) failures.push("schemaVersion");
  for (const key of ["features", "cells"]) {
    if (report?.fixture?.[key] !== baseline.fixture[key]) failures.push(`fixture.${key}`);
  }
  for (const key of ["warmup", "repetitions"]) {
    if (report?.samples?.[key] !== baseline.samples[key]) failures.push(`samples.${key}`);
  }
  for (const name of REQUIRED_OPERATIONS) {
    const limit = baseline.limitsMs[name];
    const operation = report?.operations?.[name];
    if (!operation || operation.status !== "measured" || !Number.isFinite(operation.medianMs)) failures.push(`operations.${name}`);
    else if (operation.medianMs > limit) failures.push(`operations.${name}.medianMs>${limit}`);
    if (operation && operation.rowOperations !== baseline.rowOperations[name]) failures.push(`operations.${name}.rowOperations`);
  }
  if (report?.cleanup?.directoryRemoved !== true || (report?.cleanup?.remainingEntries ?? null) !== 0) failures.push("cleanup");
  return { passed: failures.length === 0, failures };
}

function runVitest(reportPath) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const vitest = join(appRoot, "node_modules/vitest/vitest.mjs");
  const result = spawnSync(process.execPath, [vitest, "run", PERFORMANCE_TEST_PATH, "--config", "vitest.config.ts", "--reporter=dot"], {
    cwd: appRoot,
    env: { ...process.env, REALM_PERFORMANCE_GATE: "1", REALM_PERFORMANCE_REPORT: reportPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function main() {
  const baseline = readBaseline();
  const reportDirectory = mkdtempSync(join(tmpdir(), "realm-storage-performance-report-"));
  const reportPath = join(reportDirectory, "report.json");
  let report;
  let runner;
  try {
    runner = runVitest(reportPath);
    if (existsSync(reportPath)) report = JSON.parse(readFileSync(reportPath, "utf8"));
    const evaluation = runner.status === 0 && report ? evaluateReport(report, baseline) : { passed: false, failures: ["performance-test"] };
    const output = { ...(report ?? { reportVersion: 1, status: "failed" }), status: evaluation.passed ? "passed" : "failed", gate: evaluation, runner: { exitCode: runner.status } };
    console.log(JSON.stringify(output));
    if (!evaluation.passed) {
      if (runner.stderr) console.error(runner.stderr.trim());
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
