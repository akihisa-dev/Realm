import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, extname, basename, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { corrupt, RealmError } from "../domain/errors";
import { configureDatabase, preflightSchema } from "./schema";

export const PROJECT_EXTENSION = ".realmmap";
type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number; digest: string };
export type SourceIdentity = { main: FileIdentity; parent: { dev: number; ino: number }; sidecars: Record<string, FileIdentity | null> };

function digest(path: string): string {
  const hash = createHash("sha256"); const fd = openSync(path, "r"); const buffer = Buffer.allocUnsafe(64 * 1024);
  try { let read = 0; do { read = readSync(fd, buffer, 0, buffer.length, null); if (read) hash.update(buffer.subarray(0, read)); } while (read); } finally { closeSync(fd); }
  return hash.digest("hex");
}
function regular(path: string): FileIdentity {
  let metadata;
  try { metadata = lstatSync(path); } catch { throw new RealmError("invalid_path", "The project path is not a regular file."); }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new RealmError("invalid_path", "The project path is not a regular file.");
  try { return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeMs: metadata.mtimeMs, digest: digest(path) }; }
  catch { throw new RealmError("invalid_path", "The project file could not be read safely."); }
}
export function sourceIdentity(path: string): SourceIdentity {
  const main = regular(path); let parent; try { parent = lstatSync(dirname(path)); } catch { throw new RealmError("invalid_path", "The project folder is not a directory."); } if (!parent.isDirectory() || parent.isSymbolicLink()) throw new RealmError("invalid_path", "The project folder is not a directory.");
  const sidecars: Record<string, FileIdentity | null> = {};
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const sidecar = `${path}${suffix}`;
    try { lstatSync(sidecar); sidecars[suffix] = regular(sidecar); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") sidecars[suffix] = null; else throw error; }
  }
  return { main, parent: { dev: parent.dev, ino: parent.ino }, sidecars };
}
export function sameIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  const sameFile = (a: FileIdentity | null | undefined, b: FileIdentity | null | undefined): boolean => {
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.digest === b.digest;
  };
  if (!sameFile(left.main, right.main) || left.parent.dev !== right.parent.dev || left.parent.ino !== right.parent.ino) return false;
  return ["-journal", "-wal", "-shm"].every((suffix) => sameFile(left.sidecars[suffix] ?? null, right.sidecars[suffix] ?? null));
}
export function samePathIdentity(left: SourceIdentity, right: SourceIdentity): boolean { return left.main.dev === right.main.dev && left.main.ino === right.main.ino && left.parent.dev === right.parent.dev && left.parent.ino === right.parent.ino; }
function sameBundleContent(source: SourceIdentity, snapshot: SourceIdentity): boolean {
  if (source.main.size !== snapshot.main.size || source.main.digest !== snapshot.main.digest) return false;
  return ["-journal", "-wal", "-shm"].every((suffix) => {
    const left = source.sidecars[suffix] ?? null; const right = snapshot.sidecars[suffix] ?? null;
    return (left === null && right === null) || (left !== null && right !== null && left.size === right.size && left.digest === right.digest);
  });
}

export function canonicalParentPath(rawPath: string): string {
  const value = rawPath.trim(); if (!value) throw new RealmError("invalid_path", "A project path is required.");
  if (value.includes("\0")) throw new RealmError("invalid_path", "The project path is invalid.");
  const parent = resolve(dirname(value));
  let canonicalParent: string;
  try { canonicalParent = realpathSync.native(parent); } catch { throw new RealmError("invalid_path", "The project folder is not a directory."); }
  let metadata;
  try { metadata = lstatSync(canonicalParent); } catch { throw new RealmError("invalid_path", "The project folder is not a directory."); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new RealmError("invalid_path", "The project folder is not a directory.");
  return join(canonicalParent, basename(value));
}
export function validateProjectPath(rawPath: string, mustExist: boolean): string {
  const path = canonicalParentPath(rawPath); if (extname(path).toLowerCase() !== PROJECT_EXTENSION) throw new RealmError("invalid_path", "Project files must use the .realmmap extension.");
  try { const metadata = lstatSync(path); if (!metadata.isFile() || metadata.isSymbolicLink()) throw new RealmError("invalid_path", "The project path is not a regular file."); if (!mustExist) throw new RealmError("already_exists", "A project already exists at that path."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && mustExist) throw new RealmError("not_found", "The project file could not be found."); if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return path;
}
export function ensureSqliteHeader(path: string): void { const fd = openSync(path, "r"); const header = Buffer.alloc(16); try { if (readSync(fd, header, 0, 16, 0) !== 16 || header.toString("ascii") !== "SQLite format 3\0") throw corrupt("The project file is corrupt or not a Realm project."); } finally { closeSync(fd); } }

export class ValidatedProject {
  readonly path: string; readonly version: number; readonly identity: SourceIdentity; readonly database: DatabaseSync; private readonly privateSnapshotPath: string; private readonly privateSnapshotIdentity: SourceIdentity;
  constructor(path: string, version: number, identity: SourceIdentity, database: DatabaseSync, privateSnapshotPath: string, privateSnapshotIdentity: SourceIdentity) { this.path = path; this.version = version; this.identity = identity; this.database = database; this.privateSnapshotPath = privateSnapshotPath; this.privateSnapshotIdentity = privateSnapshotIdentity; }
  get snapshotPath(): string { return this.privateSnapshotPath; }
  get snapshotIdentity(): SourceIdentity { return this.privateSnapshotIdentity; }
  ensureCurrentIdentity(): void { if (!sameIdentity(this.identity, sourceIdentity(this.path))) throw new RealmError("invalid_path", "The project file changed while it was being copied."); }
  close(): void { if (this.database.isOpen) this.database.close(); removeOwnedPrivateSnapshot(this.privateSnapshotPath, this.privateSnapshotIdentity); }
}

function sameOwnedFile(path: string, expected: FileIdentity | null): boolean {
  if (!expected) return false;
  try { const metadata = lstatSync(path); return metadata.isFile() && !metadata.isSymbolicLink() && metadata.dev === expected.dev && metadata.ino === expected.ino; } catch { return false; }
}
function removeOwnedPrivateSnapshot(path: string, expected: SourceIdentity): void {
  try { const parent = lstatSync(dirname(path)); if (!parent.isDirectory() || parent.isSymbolicLink() || parent.dev !== expected.parent.dev || parent.ino !== expected.parent.ino) return; } catch { return; }
  /* Each private copy has an independent ownership check.  A foreign
     replacement of the main file or one sidecar must not prevent cleanup of
     the other files we still own, and must never be unlinked itself. */
  if (sameOwnedFile(path, expected.main)) {
    try { unlinkSync(path); } catch { /* best effort */ }
  }
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const owned = expected.sidecars[suffix] ?? null;
    if (owned && sameOwnedFile(path + suffix, owned)) {
      try { unlinkSync(path + suffix); } catch { /* best effort */ }
    }
  }
}

function copyStableFile(source: string, destination: string, expected: FileIdentity, onCreate: (identity: FileIdentity) => void): FileIdentity {
  let sourceFd = -1;
  let destinationFd = -1;
  try {
    sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceMetadata = fstatSync(sourceFd);
    if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.dev !== expected.dev || sourceMetadata.ino !== expected.ino) throw new RealmError("invalid_path", "The project file changed while it was being copied.");
    destinationFd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const destinationMetadata = fstatSync(destinationFd);
    const owned: FileIdentity = { dev: destinationMetadata.dev, ino: destinationMetadata.ino, size: 0, mtimeMs: destinationMetadata.mtimeMs, digest: "" };
    onCreate(owned);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let count = 0;
    while (true) {
      const bytes = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
      let written = 0;
      while (written < bytes) written += writeSync(destinationFd, buffer, written, bytes - written, null);
      count += bytes;
    }
    fsyncSync(destinationFd);
    const copiedDigest = hash.digest("hex");
    if (copiedDigest !== expected.digest) throw new RealmError("invalid_path", "The project file changed while it was being copied.");
    const finalMetadata = fstatSync(destinationFd);
    return { dev: finalMetadata.dev, ino: finalMetadata.ino, size: count, mtimeMs: finalMetadata.mtimeMs, digest: copiedDigest };
  } finally {
    if (destinationFd >= 0) closeSync(destinationFd);
    if (sourceFd >= 0) closeSync(sourceFd);
  }
}

type PrivateSnapshot = { path: string; identity: SourceIdentity };

function privateSnapshot(source: string, identity: SourceIdentity): PrivateSnapshot {
  const snapshot = join(dirname(source), ".realm-source-" + randomUUID() + ".staging");
  const ownership: { value: SourceIdentity | null } = { value: null };
  try {
    const sidecars: Record<string, FileIdentity | null> = { "-journal": null, "-wal": null, "-shm": null };
    const main = copyStableFile(source, snapshot, identity.main, (created) => {
      ownership.value = { main: created, parent: identity.parent, sidecars };
    });
    const snapshotOwnership = ownership.value;
    if (!snapshotOwnership) throw new RealmError("storage_error", "The private project snapshot could not be created.");
    snapshotOwnership.main = main;
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      if (!identity.sidecars[suffix]) continue;
      const sidecar = copyStableFile(source + suffix, snapshot + suffix, identity.sidecars[suffix], (created) => {
        snapshotOwnership.sidecars[suffix] = created;
      });
      snapshotOwnership.sidecars[suffix] = sidecar;
    }
    return { path: snapshot, identity: snapshotOwnership };
  } catch (error) { if (ownership.value) removeOwnedPrivateSnapshot(snapshot, ownership.value); throw error; }
}
export function preflightExistingProject(rawPath: string): ValidatedProject {
  const path = validateProjectPath(rawPath, true); ensureSqliteHeader(path); const identity = sourceIdentity(path); const snapshotGuard = privateSnapshot(path, identity); const snapshot = snapshotGuard.path; const snapshotIdentity = snapshotGuard.identity;
  if (!sameBundleContent(identity, snapshotIdentity)) { removeOwnedPrivateSnapshot(snapshot, snapshotIdentity); throw new RealmError("invalid_path", "The project snapshot changed while it was being copied."); }
  let db: DatabaseSync;
  try { db = new DatabaseSync(snapshot, { readOnly: true, timeout: 5000, allowExtension: true }); } catch { removeOwnedPrivateSnapshot(snapshot, snapshotIdentity); throw corrupt("The project file is corrupt or not a Realm project."); }
  try { configureDatabase(db); const version = preflightSchema(db); if (Number((db.prepare("SELECT COUNT(*) AS count FROM world").get() as { count: number }).count) !== 1) throw corrupt("The project must contain exactly one world record."); if (!sameIdentity(identity, sourceIdentity(path))) throw new RealmError("invalid_path", "The project file changed while it was being inspected."); return new ValidatedProject(path, version, identity, db, snapshot, snapshotIdentity); } catch (error) { db.close(); removeOwnedPrivateSnapshot(snapshot, snapshotIdentity); throw error; }
}
export function listDirectoryFiles(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.isSymbolicLink()).map((entry) => join(directory, entry.name)); }
