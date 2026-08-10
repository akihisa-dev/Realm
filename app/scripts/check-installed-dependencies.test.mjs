import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertInstalledDependencies } from "./check-installed-dependencies.mjs";

function withSyntheticApp(test) {
  const directory = mkdtempSync(join(tmpdir(), "realm-dependencies-"));
  try {
    return test(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("installed dependency check", () => {
  it("accepts an installation made from the current lockfile", () => withSyntheticApp((directory) => {
    mkdirSync(join(directory, "node_modules/.pnpm"), { recursive: true });
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(directory, "node_modules/.pnpm/lock.yaml"), "lockfileVersion: '9.0'\n");
    expect(assertInstalledDependencies(directory)).toBe(true);
  }));

  it("does not invalidate dependencies after an application-version-only change", () => withSyntheticApp((directory) => {
    mkdirSync(join(directory, "node_modules/.pnpm"), { recursive: true });
    writeFileSync(join(directory, "package.json"), '{"name":"realm","version":"0.7.1"}\n');
    writeFileSync(join(directory, "pnpm-lock.yaml"), "current\n");
    writeFileSync(join(directory, "node_modules/.pnpm/lock.yaml"), "current\n");
    expect(assertInstalledDependencies(directory)).toBe(true);
  }));

  it("rejects a stale installation", () => withSyntheticApp((directory) => {
    mkdirSync(join(directory, "node_modules/.pnpm"), { recursive: true });
    writeFileSync(join(directory, "pnpm-lock.yaml"), "current\n");
    writeFileSync(join(directory, "node_modules/.pnpm/lock.yaml"), "old\n");
    expect(() => assertInstalledDependencies(directory)).toThrow("stale");
  }));

  it("rejects a missing installation", () => withSyntheticApp((directory) => {
    writeFileSync(join(directory, "pnpm-lock.yaml"), "current\n");
    expect(() => assertInstalledDependencies(directory)).toThrow("not installed");
  }));
});
