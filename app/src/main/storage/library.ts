import { lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { invalid, RealmError } from "../domain/errors";
import { PROJECT_EXTENSION, validateProjectPath } from "./path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export type LibraryDirectoryIdentity = { path: string; dev: number; ino: number };

/** Create/validate the managed library directory without accepting a symlink. */
export function validateLibraryDirectory(rawDirectory: string): LibraryDirectoryIdentity {
  const directory = resolve(rawDirectory);
  try { mkdirSync(directory, { recursive: true }); } catch { throw new RealmError("invalid_path", "The Realm library folder could not be created."); }
  let metadata;
  try { metadata = lstatSync(directory); } catch { throw new RealmError("invalid_path", "The Realm library folder could not be accessed."); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new RealmError("invalid_path", "The Realm library folder is not a directory.");
  return { path: directory, dev: metadata.dev, ino: metadata.ino };
}

export function assertLibraryDirectory(identity: LibraryDirectoryIdentity): void {
  let metadata;
  try { metadata = lstatSync(identity.path); } catch { throw new RealmError("invalid_path", "The Realm library folder changed while it was in use."); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) throw new RealmError("invalid_path", "The Realm library folder changed while it was in use.");
}

export function appLibraryDirectory(baseDirectory: string): string { return validateLibraryDirectory(join(baseDirectory, "projects")).path; }
/** Canonicalize the opaque identifier exposed to the renderer into a managed filename. */
export function canonicalLibraryId(raw: string): string {
  if (typeof raw !== "string") throw invalid("The library project identifier is invalid.");
  const value = raw.trim();
  if (!UUID_PATTERN.test(value)) throw invalid("The library project identifier is invalid.");
  return value.toLowerCase();
}

export function libraryProjectPath(directory: string, libraryId: string): string {
  const id = canonicalLibraryId(libraryId);
  return validateProjectPath(join(directory, id + PROJECT_EXTENSION), true);
}

export function libraryIdFromFilename(filename: string): string | null {
  if (!filename.toLowerCase().endsWith(PROJECT_EXTENSION)) return null;
  const stem = filename.slice(0, -PROJECT_EXTENSION.length);
  return UUID_PATTERN.test(stem) ? stem.toLowerCase() : null;
}

export function newLibraryProjectPath(directory: string): string { return join(directory, randomUUID() + PROJECT_EXTENSION); }
