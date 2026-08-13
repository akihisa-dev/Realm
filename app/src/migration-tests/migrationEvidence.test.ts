import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import syntheticSnapshot from "./fixtures/v8.synthetic.snapshot.json";
import { migrationInventory, migrationRequirementIds } from "./migrationInventory";
import {
  canonicalSnapshot,
  compareMigrationSnapshots,
  compareSourceIdentity,
  type MigrationSnapshot,
} from "./migrationSnapshot";

const baselineSnapshot: MigrationSnapshot = syntheticSnapshot;
const baselineIdentity = { sourceHash: "synthetic-source-hash", sidecars: ["world.realmmap-shm", "world.realmmap-wal"] };
const migrationDirectory = dirname(fileURLToPath(import.meta.url));

function electronSuiteEvidence(suite: string): { path: string; title: string | null } {
  const [relativePath = "", title = null] = suite.split(" :: ", 2);
  const path = relativePath.startsWith("migration-tests/")
    ? join(migrationDirectory, relativePath.slice("migration-tests/".length))
    : join(migrationDirectory, relativePath);
  return { path, title };
}

describe("Electron migration characterization evidence", () => {
  it("keeps every required behavior mapped to baseline evidence and a future Electron suite", () => {
    expect(new Set(migrationRequirementIds).size).toBe(migrationInventory.length);
    for (const requirement of migrationInventory) {
      expect(requirement.baselineEvidence.length, requirement.id).toBeGreaterThan(0);
      expect(requirement.electronSuite, requirement.id).toMatch(/^migration-tests\//);
      if (requirement.area === "storage") {
        const evidence = electronSuiteEvidence(requirement.electronSuite);
        expect(existsSync(evidence.path), requirement.id).toBe(true);
        expect(evidence.title, requirement.id).not.toBeNull();
        expect(readFileSync(evidence.path, "utf8"), requirement.id).toContain(evidence.title!);
      }
    }
  });

  it("canonicalizes row order for legacy-vs-Electron golden comparisons", () => {
    const reordered = { ...baselineSnapshot, features: [...baselineSnapshot.features].reverse() };
    expect(canonicalSnapshot(baselineSnapshot)).toBe(canonicalSnapshot(reordered));
    expect(compareMigrationSnapshots(baselineSnapshot, reordered)).toEqual({ equal: true, differences: [] });
  });

  it("reports persisted data differences without treating source metadata as map data", () => {
    const changed = { ...baselineSnapshot, cells: [{ cellId: "1:0", layer: "terrain", value: "water" }] };
    expect(compareMigrationSnapshots(baselineSnapshot, changed)).toEqual({ equal: false, differences: ["cells"] });
    expect(compareSourceIdentity(baselineIdentity, baselineIdentity)).toEqual({ equal: true, differences: [] });
  });

  it("detects source hash and sidecar mutations independently", () => {
    expect(compareSourceIdentity(baselineIdentity, { ...baselineIdentity, sourceHash: "changed" }))
      .toEqual({ equal: false, differences: ["sourceHash"] });
    expect(compareSourceIdentity(baselineIdentity, { ...baselineIdentity, sidecars: ["world.realmmap-wal"] }))
      .toEqual({ equal: false, differences: ["sidecars"] });
  });
});
