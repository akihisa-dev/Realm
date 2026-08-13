// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { appLibraryDirectory, canonicalLibraryId, libraryIdFromFilename, libraryProjectPath, newLibraryProjectPath } from "./library";
import { RealmCommands } from "../commands/realmCommands";

describe("managed project library paths", () => {
  it("creates the projects directory and generates safe project names", async () => {
    const base = mkdtempSync(join(tmpdir(), "realm-library-"));
    const directory = appLibraryDirectory(base);
    expect(directory).toBe(join(base, "projects"));
    expect(basename(newLibraryProjectPath(directory))).toMatch(/^[0-9a-f-]{36}\.realmmap$/);
    const id = basename(newLibraryProjectPath(directory), ".realmmap");
    const commands = new RealmCommands({ libraryDirectory: directory });
    const snapshot = await commands.createProject({ name: "World" }); await commands.closeProject();
    const path = snapshot.path;
    const reopened = new DatabaseSync(path, { readOnly: true });
    expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(reopened.prepare("SELECT name FROM world").get()).toEqual({ name: "World" });
    reopened.close();
    const createdId = basename(path, ".realmmap");
    expect(libraryProjectPath(directory, createdId)).toBe(path);
    expect(canonicalLibraryId(id.toUpperCase())).toBe(id);
    expect(libraryIdFromFilename(id + ".realmmap")).toBe(id);
    expect(libraryIdFromFilename("world.realmmap")).toBeNull();
    expect(() => libraryProjectPath(directory, "world.realmmap")).toThrow("identifier");
    expect(() => libraryProjectPath(directory, "/etc/passwd")).toThrow("identifier");
    expect(() => libraryProjectPath(directory, createdId)).not.toThrow();
    expect(id).not.toBe(createdId);
  });
});
