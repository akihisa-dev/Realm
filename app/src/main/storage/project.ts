import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenProjectSession } from "../state/session";
import { RealmError } from "../domain/errors";
import { canonicalParentPath, preflightExistingProject, sameIdentity, samePathIdentity, sourceIdentity } from "./path";
import { configureDatabase, initializeSchema, migrateToCurrent, preflightSchema } from "./schema";
import { createStagedDatabase, type ParentIdentity } from "./atomic";

function openProjectWithHook(path: string, beforeWritableOpen?: (validatedPath: string) => void, expectedParentIdentity?: ParentIdentity): OpenProjectSession {
  const validated = preflightExistingProject(path); const identity = validated.identity; const version = validated.version;
  let db: DatabaseSync | undefined;
  try {
    if (expectedParentIdentity && (identity.parent.dev !== expectedParentIdentity.dev || identity.parent.ino !== expectedParentIdentity.ino)) throw new RealmError("invalid_path", "The project folder changed while it was being opened.");
    if (!sameIdentity(identity, sourceIdentity(path))) throw new RealmError("invalid_path", "The project file changed while it was being opened.");
    beforeWritableOpen?.(path);
    /* SQLite's URI mode=rw is the node:sqlite equivalent of O_RDWR without
       O_CREAT: a missing path cannot be silently created during the race
       between read-only preflight and the writable open. */
    const rwUri = `${pathToFileURL(path).href}?mode=rw`;
    db = new DatabaseSync(rwUri, { timeout: 5000, allowExtension: true });
    if (!sameIdentity(identity, sourceIdentity(path))) throw new RealmError("invalid_path", "The project file changed while it was being opened.");
    configureDatabase(db);
    if (!samePathIdentity(identity, sourceIdentity(path))) throw new RealmError("invalid_path", "The project file changed while it was being opened.");
    migrateToCurrent(db, version);
    preflightSchema(db);
    if (!samePathIdentity(identity, sourceIdentity(path))) throw new RealmError("invalid_path", "The project file changed while it was being opened.");
    validated.close();
    return new OpenProjectSession(path, db);
  } catch (error) {
    try { if (db?.isOpen) db.close(); } catch { /* preserve the original failure */ }
    validated.close();
    if (error instanceof RealmError) throw error;
    throw new RealmError("storage_error", "The project could not be opened safely.");
  }
}
export function openProject(path: string, expectedParentIdentity?: ParentIdentity): OpenProjectSession { return openProjectWithHook(path, undefined, expectedParentIdentity); }

/** Narrow test seam for reproducing the preflight-to-writable-open race. */
export function openProjectAfterValidationForTest(path: string, beforeWritableOpen: (validatedPath: string) => void): OpenProjectSession {
  return openProjectWithHook(path, beforeWritableOpen);
}
export function createProject(path: string, name: string, expectedParentIdentity?: ParentIdentity): OpenProjectSession {
  const destination = canonicalParentPath(path); mkdirSync(dirname(destination), { recursive: true }); const { publisher } = createStagedDatabase(destination, "realm-create", expectedParentIdentity);
  try {
    /* Build the initial schema in Node's in-memory SQLite connection.  The
       publisher staging pathname is never opened by node:sqlite; its held
       O_EXCL fd receives only the serialized bytes after initialization. */
    const db = new DatabaseSync(":memory:", { timeout: 5000 });
    try { db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"); initializeSchema(db, randomUUID(), name); publisher.write((db as DatabaseSync & { serialize(): Uint8Array }).serialize()); }
    finally { db.close(); }
    publisher.validateStaging(); publisher.sync(); publisher.publish(); return openProject(destination, expectedParentIdentity);
  } catch (error) { publisher.dispose(); throw error; }
}
