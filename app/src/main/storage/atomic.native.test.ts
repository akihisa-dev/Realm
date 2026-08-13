// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

type Result = { status: string; exitCode: number };
const appRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../../");
const helper = resolve(appRoot, "native/build/realm_atomic_publish");
const buildScript = resolve(appRoot, "scripts/build-native-storage-tools.mjs");
const sleep = promisify(setTimeout);

function identities(path: string): [number, number] {
  const metadata = statSync(path);
  return [metadata.dev, metadata.ino];
}

function args(parent: string, staging: string, destination: string): string[] {
  const [parentDev, parentIno] = identities(parent);
  const [stagingDev, stagingIno] = identities(staging);
  return [parent, staging.slice(parent.length + 1), destination.slice(parent.length + 1), String(parentDev), String(parentIno), String(stagingDev), String(stagingIno)];
}

function parse(output: string, exitCode: number): Result {
  const line = output.trim().split(/\r?\n/u).reverse().find(Boolean) ?? "";
  return { status: (JSON.parse(line) as { status: string }).status, exitCode };
}

function run(parent: string, staging: string, destination: string, environment: Record<string, string> = {}): Result {
  try {
    const output = execFileSync(helper, args(parent, staging, destination), { encoding: "utf8", shell: false, env: { ...process.env, ...environment } });
    return parse(output, 0);
  } catch (error) {
    const failure = error as { stdout?: Buffer | string; status?: number };
    return parse(Buffer.isBuffer(failure.stdout) ? failure.stdout.toString("utf8") : String(failure.stdout ?? ""), failure.status ?? -1);
  }
}

function runDuringPause(parent: string, staging: string, destination: string, environment: Record<string, string>, replace: () => void): Promise<Result> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helper, args(parent, staging, destination), { env: { ...process.env, ...environment }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    void sleep(100).then(replace);
    child.once("close", (code) => {
      try { resolvePromise(parse(Buffer.concat(chunks).toString("utf8"), code ?? -1)); }
      catch (error) { reject(error); }
    });
  });
}

describe("native atomic publication helper", () => {
  beforeAll(() => {
    if (!existsSync(helper)) execFileSync(process.execPath, [buildScript], { cwd: appRoot, shell: false, stdio: "inherit" });
  });

  it("publishes successfully and refuses an existing destination", () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    try {
      const staging = join(directory, ".stage");
      const destination = join(directory, "destination.realmmap");
      writeFileSync(staging, "published");
      expect(run(directory, staging, destination)).toEqual({ status: "published", exitCode: 0 });
      expect(readFileSync(destination, "utf8")).toBe("published");

      const secondStaging = join(directory, ".stage-second");
      writeFileSync(secondStaging, "replacement");
      expect(run(directory, secondStaging, destination)).toEqual({ status: "already_exists", exitCode: 10 });
      expect(readFileSync(secondStaging, "utf8")).toBe("replacement");
      expect(readFileSync(destination, "utf8")).toBe("published");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects slash-bearing staging and destination arguments", () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    try {
      const staging = join(directory, ".stage");
      writeFileSync(staging, "bytes");
      const [parentDev, parentIno] = identities(directory);
      const [stagingDev, stagingIno] = identities(staging);
      let failure: { stdout?: Buffer | string; status?: number } | null = null;
      try {
        execFileSync(helper, [directory, "nested/.stage", "destination.realmmap", String(parentDev), String(parentIno), String(stagingDev), String(stagingIno)], { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { failure = error as { stdout?: Buffer | string; status?: number }; }
      expect(failure?.status).toBe(11);
      expect(parse(Buffer.isBuffer(failure?.stdout) ? failure.stdout.toString("utf8") : String(failure?.stdout ?? ""), failure?.status ?? -1).status).toBe("invalid_path");
      expect(existsSync(join(directory, "destination.realmmap"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("retains the destination when parent fsync durability is uncertain", () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    try {
      const staging = join(directory, ".stage");
      const destination = join(directory, "destination.realmmap");
      writeFileSync(staging, "durability");
      expect(run(directory, staging, destination, { REALM_ATOMIC_TEST_FAIL_PARENT_FSYNC: "1" })).toEqual({ status: "published_durability_uncertain", exitCode: 13 });
      expect(readFileSync(destination, "utf8")).toBe("durability");
      expect(existsSync(staging)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects a foreign staging replacement without deleting it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    try {
      const staging = join(directory, ".stage");
      const destination = join(directory, "destination.realmmap");
      const moved = join(directory, ".stage.original");
      writeFileSync(staging, "owned");
      const result = await runDuringPause(directory, staging, destination, { REALM_ATOMIC_TEST_PAUSE_AFTER_STAGING_OPEN_MS: "1000" }, () => {
        renameSync(staging, moved);
        writeFileSync(staging, "foreign");
      });
      expect(result).toEqual({ status: "invalid_path", exitCode: 11 });
      expect(readFileSync(staging, "utf8")).toBe("foreign");
      expect(existsSync(destination)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("retains a foreign cleanup replacement when the parent directory is replaced", () => {
    const root = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    const parent = join(root, "parent");
    const movedParent = join(root, "parent.moved");
    mkdirSync(parent);
    try {
      const staging = join(parent, ".stage");
      writeFileSync(staging, "owned");
      const [parentDev, parentIno] = identities(parent);
      const [stagingDev, stagingIno] = identities(staging);
      renameSync(parent, movedParent);
      mkdirSync(parent);
      const replacement = join(parent, ".stage");
      writeFileSync(replacement, "foreign");
      const sidecars = ["0", "0", "0", "0", "0", "0"];
      let failure: { stdout?: Buffer | string; status?: number } | null = null;
      try {
        execFileSync(helper, ["cleanup", parent, ".stage", String(parentDev), String(parentIno), String(stagingDev), String(stagingIno), ...sidecars], { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { failure = error as { stdout?: Buffer | string; status?: number }; }
      expect(failure).toBeNull();
      expect(readFileSync(replacement, "utf8")).toBe("foreign");
      expect(readFileSync(join(movedParent, ".stage"), "utf8")).toBe("owned");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a parent replacement before publication", async () => {
    const root = mkdtempSync(join(tmpdir(), "realm-atomic-native-"));
    const parent = join(root, "parent");
    const movedParent = join(root, "parent.moved");
    mkdirSync(parent);
    try {
      const staging = join(parent, ".stage");
      const destination = join(parent, "destination.realmmap");
      writeFileSync(staging, "held-parent");
      const result = await runDuringPause(parent, staging, destination, { REALM_ATOMIC_TEST_PAUSE_AFTER_PARENT_OPEN_MS: "1000" }, () => {
        renameSync(parent, movedParent);
        mkdirSync(parent);
      });
      expect(result).toEqual({ status: "invalid_path", exitCode: 11 });
      expect(existsSync(join(parent, "destination.realmmap"))).toBe(false);
      expect(existsSync(join(movedParent, "destination.realmmap"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
