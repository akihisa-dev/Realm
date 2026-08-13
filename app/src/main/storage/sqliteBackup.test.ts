// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensionPath = resolve(process.cwd(), "native/build/realm_has_moved.dylib");

describe("host SQLite online backup extension", () => {
  it("backs up a committed WAL view to rollback-format bytes without opening a destination path", () => {
    const directory = mkdtempSync(join(tmpdir(), "realm-sqlite-backup-"));
    let source: DatabaseSync | undefined;
    let destination: DatabaseSync | undefined;
    try {
      source = new DatabaseSync(join(directory, "source.realmmap"), { allowExtension: true });
      source.exec("PRAGMA journal_mode=WAL; CREATE TABLE marker(value TEXT); INSERT INTO marker(value) VALUES ('committed');");
      source.loadExtension(extensionPath);
      const row = source.prepare("SELECT realm_backup_bytes() AS bytes").get() as { bytes?: unknown };
      expect(row.bytes).toBeInstanceOf(Uint8Array);
      const bytes = row.bytes as Uint8Array;
      expect(bytes[18]).toBe(1);
      expect(bytes[19]).toBe(1);
      const destinationPath = join(directory, "destination.realmmap");
      writeFileSync(destinationPath, bytes, { flag: "wx", mode: 0o600 });
      destination = new DatabaseSync(destinationPath, { readOnly: true });
      expect(destination.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(destination.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
      expect(destination.prepare("SELECT value FROM marker").get()).toEqual({ value: "committed" });
    } finally {
      try { destination?.close(); } catch { /* preserve assertion */ }
      try { source?.close(); } catch { /* preserve assertion */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
