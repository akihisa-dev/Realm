// @vitest-environment node
import { describe, expect, it } from "vitest";
import { evaluateReport, readBaseline, REQUIRED_OPERATIONS } from "../../scripts/storage-performance-report.mjs";

function passingReport() {
  const baseline = readBaseline();
  return {
    reportVersion: 1,
    schemaVersion: 9,
    fixture: baseline.fixture,
    samples: baseline.samples,
    operations: Object.fromEntries(REQUIRED_OPERATIONS.map((name) => [name, { status: "measured", medianMs: 0, rowOperations: baseline.rowOperations[name] }])),
    cleanup: { directoryRemoved: true, remainingEntries: 0 }
  };
}

describe("storage performance report gate", () => {
  it("accepts a complete report within the fixed synthetic budget", () => {
    expect(evaluateReport(passingReport(), readBaseline())).toEqual({ passed: true, failures: [] });
  });

  it("fails closed on missing operations, row count drift, and uncleared temporary data", () => {
    const report = passingReport();
    delete report.operations.backup;
    report.operations.create!.rowOperations! += 1;
    report.cleanup = { directoryRemoved: false, remainingEntries: 1 };
    const result = evaluateReport(report, readBaseline());
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(["operations.backup", "operations.create.rowOperations", "cleanup"]));
  });
});
