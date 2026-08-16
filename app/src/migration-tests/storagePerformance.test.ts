// @vitest-environment node
import { describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { RealmCommands } from "../main/commands/realmCommands";
import { CURRENT_SCHEMA_VERSION } from "../main/storage/schema";
import { cellIdsToPolygonGeometries } from "../shared/mapShapeGeometry";
import type { MapObject } from "../shared/realmContract";

const fixture = { objects: 96, shapes: 1 } as const;
const samples = { warmup: 1, repetitions: 5 } as const;
const coveredCellCount = 192;
const cells = Array.from({ length: coveredCellCount }, (_, index) => `${index % 64}:${Math.floor(index / 64)}`);
const terrainShape = () => ({ id: "11111111-1111-4111-8111-111111111111", geometry: cellIdsToPolygonGeometries(cells)[0]! });
const objects: MapObject[] = Array.from({ length: fixture.objects }, (_, index) => ({
  id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  kind: "city" as const,
  label: `Synthetic city ${index}`,
  geometry: { type: "Point" as const, coordinates: [index % 32, Math.floor(index / 32)] as [number, number] },
  properties: {}, zIndex: index, locked: false
}));

type OperationName = "create" | "open" | "read" | "terrainBatch" | "save" | "backup";
type OperationResult = { status: "measured"; samplesMs: number[]; medianMs: number; rowOperations: number };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function elapsed(start: number): number { return Number((performance.now() - start).toFixed(3)); }

async function createFixture(directory: string): Promise<string> {
  const commands = new RealmCommands({ libraryDirectory: directory });
  const snapshot = await commands.createProject({ name: "Synthetic performance fixture" });
  await commands.replaceObjectLayer({ objects });
  await commands.replaceTerrainLayer({ shapes: [terrainShape()] });
  await commands.closeProject();
  return snapshot.path;
}

async function withCopy(directory: string, seed: string, _name: string, callback: (path: string) => Promise<number>): Promise<number> {
  const path = join(directory, `${randomUUID()}.realmmap`);
  copyFileSync(seed, path);
  return callback(path);
}

async function measure(_name: OperationName, repetitions: number, operation: (sample: number) => Promise<number>, rowOperations: number): Promise<OperationResult> {
  for (let sample = 0; sample < samples.warmup; sample += 1) await operation(-sample - 1);
  const values: number[] = [];
  for (let sample = 0; sample < repetitions; sample += 1) values.push(await operation(sample));
  return { status: "measured", samplesMs: values, medianMs: median(values), rowOperations };
}

async function benchmark(directory: string, seed: string): Promise<Record<OperationName, OperationResult>> {
  const results = {} as Record<OperationName, OperationResult>;
  results.create = await measure("create", samples.repetitions, async () => {
    const commands = new RealmCommands({ libraryDirectory: directory });
    const start = performance.now(); const snapshot = await commands.createProject({ name: "Synthetic performance fixture" }); await commands.replaceObjectLayer({ objects }); await commands.replaceTerrainLayer({ shapes: [terrainShape()] }); const value = elapsed(start); await commands.closeProject(); rmSync(snapshot.path, { force: true }); return value;
  }, fixture.objects + fixture.shapes);
  results.open = await measure("open", samples.repetitions, (sample) => withCopy(directory, seed, `open-${sample}.realmmap`, async (path) => {
    const commands = new RealmCommands({ libraryDirectory: directory }); const start = performance.now(); await commands.openProject({ libraryId: basename(path, ".realmmap") }); const value = elapsed(start); await commands.closeProject(); return value;
  }), fixture.objects + fixture.shapes);
  results.read = await measure("read", samples.repetitions, (sample) => withCopy(directory, seed, `read-${sample}.realmmap`, async (path) => {
    const commands = new RealmCommands({ libraryDirectory: directory }); await commands.openProject({ libraryId: basename(path, ".realmmap") }); const start = performance.now(); const snapshot = await commands.getOpenProject(); const value = elapsed(start); if (snapshot?.layers.objects.length !== fixture.objects || snapshot.layers.terrain.length !== fixture.shapes) throw new Error("Synthetic fixture read count changed."); await commands.closeProject(); return value;
  }), fixture.objects + fixture.shapes);
  results.terrainBatch = await measure("terrainBatch", samples.repetitions, (sample) => withCopy(directory, seed, `terrain-${sample}.realmmap`, async (path) => {
    const commands = new RealmCommands({ libraryDirectory: directory }); await commands.openProject({ libraryId: basename(path, ".realmmap") }); const start = performance.now(); await commands.replaceTerrainLayer({ shapes: [terrainShape()] }); const value = elapsed(start); await commands.closeProject(); return value;
  }), fixture.shapes);
  results.save = await measure("save", samples.repetitions, (sample) => withCopy(directory, seed, `save-${sample}.realmmap`, async (path) => {
    const commands = new RealmCommands({ libraryDirectory: directory }); await commands.openProject({ libraryId: basename(path, ".realmmap") }); const start = performance.now(); await commands.saveProject({ name: `Saved synthetic ${sample}` }); const value = elapsed(start); await commands.closeProject(); return value;
  }), 1);
  results.backup = await measure("backup", samples.repetitions, (sample) => withCopy(directory, seed, `backup-source-${sample}.realmmap`, async (path) => {
    const destination = join(directory, `backup-${sample}.realmmap`); const commands = new RealmCommands({ libraryDirectory: directory }); await commands.openProject({ libraryId: basename(path, ".realmmap") }); const start = performance.now(); await commands.exportProject({ path: destination }); const value = elapsed(start); await commands.closeProject(); rmSync(destination, { force: true }); return value;
  }), fixture.objects + fixture.shapes);
  return results;
}

describe("Electron storage performance gate", () => {
  it.skipIf(process.env.REALM_PERFORMANCE_GATE !== "1")("reports fixed synthetic schema-12 storage timings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-storage-performance-"));
    let seed = "";
    let cleanup = { directoryRemoved: false, remainingEntries: null as number | null };
    try {
      seed = await createFixture(directory);
      const report = { reportVersion: 1, schemaVersion: CURRENT_SCHEMA_VERSION, fixture, samples, operations: await benchmark(directory, seed), cleanup };
      rmSync(directory, { recursive: true, force: true });
      cleanup = { directoryRemoved: !existsSync(directory), remainingEntries: existsSync(directory) ? readdirSync(directory).length : 0 };
      const finalReport = { ...report, cleanup };
      const reportPath = process.env.REALM_PERFORMANCE_REPORT;
      if (!reportPath) throw new Error("REALM_PERFORMANCE_REPORT is required.");
      requireReportDirectory(reportPath);
      writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
      expect(finalReport.cleanup.directoryRemoved).toBe(true);
    } finally {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

function requireReportDirectory(path: string): void {
  if (!path || !existsSync(join(path, ".."))) throw new Error("The performance report directory is unavailable.");
}
