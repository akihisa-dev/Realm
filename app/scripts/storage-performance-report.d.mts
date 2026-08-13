export type StorageBaseline = {
  reportVersion: 1;
  schemaVersion: 8;
  fixture: { features: number; cells: number };
  samples: { warmup: number; repetitions: number };
  limitsMs: Record<string, number>;
  rowOperations: Record<string, number>;
};

export const BASELINE_PATH: string;
export const PERFORMANCE_TEST_PATH: string;
export const REQUIRED_OPERATIONS: readonly string[];
export function readBaseline(path?: string): StorageBaseline;
export function evaluateReport(report: unknown, baseline: StorageBaseline): { passed: boolean; failures: string[] };
