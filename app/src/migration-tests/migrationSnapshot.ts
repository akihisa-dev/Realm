export type SnapshotRow = Record<string, unknown>;

/** A serializable, implementation-neutral view used by legacy/Electron comparisons. */
export type MigrationSnapshot = {
  schemaVersion: number;
  world: SnapshotRow;
  features: readonly SnapshotRow[];
  cells: readonly SnapshotRow[];
  assets: readonly SnapshotRow[];
  sourceHash?: string;
  sidecars?: readonly string[];
};

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortObject(entry)]),
    );
  }
  return value;
};

const canonicalRows = (rows: readonly SnapshotRow[]): readonly unknown[] =>
  rows.map(sortObject).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

/** Stable JSON makes golden files independent of SQLite row order and object key order. */
export const canonicalSnapshot = (snapshot: MigrationSnapshot): string =>
  JSON.stringify(sortObject({
    schemaVersion: snapshot.schemaVersion,
    world: snapshot.world,
    features: canonicalRows(snapshot.features),
    cells: canonicalRows(snapshot.cells),
    assets: canonicalRows(snapshot.assets),
  }));

export type SnapshotComparison = {
  equal: boolean;
  differences: readonly string[];
};

export const compareMigrationSnapshots = (
  expected: MigrationSnapshot,
  actual: MigrationSnapshot,
): SnapshotComparison => {
  const differences: string[] = [];
  if (expected.schemaVersion !== actual.schemaVersion) differences.push("schemaVersion");
  if (JSON.stringify(sortObject(expected.world)) !== JSON.stringify(sortObject(actual.world))) differences.push("world");
  for (const key of ["features", "cells", "assets"] as const) {
    if (JSON.stringify(canonicalRows(expected[key])) !== JSON.stringify(canonicalRows(actual[key]))) differences.push(key);
  }
  return { equal: differences.length === 0, differences };
};

/** Import must never mutate the selected source or its SQLite sidecar set. */
export type SourceIdentity = {
  sourceHash: string;
  sidecars: readonly string[];
};

export const compareSourceIdentity = (
  before: SourceIdentity,
  after: SourceIdentity,
): SnapshotComparison => {
  const differences: string[] = [];
  if (before.sourceHash !== after.sourceHash) differences.push("sourceHash");
  if (JSON.stringify([...before.sidecars].sort()) !== JSON.stringify([...after.sidecars].sort())) {
    differences.push("sidecars");
  }
  return { equal: differences.length === 0, differences };
};
