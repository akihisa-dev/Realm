import type { DatabaseSync } from "node:sqlite";
import type { EditOperation, PersistentState } from "../storage/projectStore";
import { ProjectStore, equalState } from "../storage/projectStore";
import { sameIdentity, sourceIdentity, type SourceIdentity } from "../storage/path";
import { readTransaction, transaction } from "../storage/schema";
import { RealmError } from "../domain/errors";

export type MutationOptions = { assetBytesFor?: readonly string[]; beforeTransaction?: () => void };

export class OpenProjectSession {
  readonly path: string; readonly database: DatabaseSync; readonly store: ProjectStore; private identity: SourceIdentity; private undoStack: EditOperation[] = []; private redoStack: EditOperation[] = []; private assetIntegrityVerified = false;
  constructor(path: string, database: DatabaseSync) { this.path = path; this.database = database; this.store = new ProjectStore(database); this.identity = sourceIdentity(path); }
  /** Guard every normal read or update against an external path/content change. */
  ensureCurrent(): void { if (!sameIdentity(this.identity, sourceIdentity(this.path))) throw new RealmError("invalid_path", "The project file changed while it was open."); }
  ensurePathIdentity(): void { this.ensureCurrent(); }
  refreshPathIdentity(): void { this.identity = sourceIdentity(this.path); }
  checkpoint(before: PersistentState, label: string, capturedAfter?: PersistentState): void {
    const after = capturedAfter ?? this.store.readState();
    this.store.captureAssetBytes(after, this.store.changedAssetIds(before, after));
    this.refreshPathIdentity();
    if (!equalState(before, after)) { this.undoStack.push({ before, after, label }); this.redoStack = []; }
  }
  /** Run one guarded SQLite mutation and record exactly one history checkpoint. */
  mutate(label: string, operation: (store: ProjectStore) => void, options: MutationOptions = {}): void {
    this.ensureCurrent();
    options.beforeTransaction?.();
    let before: PersistentState | undefined;
    let after: PersistentState | undefined;
    transaction(this.database, () => {
      // BEGIN IMMEDIATE closes the race between the caller's reads and the write.
      // The identity check is deliberately repeated after the write lock is held.
      this.ensureCurrent();
      const captureOptions = options.assetBytesFor === undefined ? {} : { assetBytesFor: options.assetBytesFor };
      const capturedBefore = this.store.readState(captureOptions);
      before = capturedBefore;
      operation(this.store);
      const capturedAfter = this.store.readState();
      after = capturedAfter;
      this.store.captureAssetBytes(capturedAfter, this.store.changedAssetIds(capturedBefore, capturedAfter));
    });
    this.checkpoint(before!, label, after!);
  }
  readConsistent<T>(operation: () => T): T {
    this.ensureCurrent();
    const result = readTransaction(this.database, () => {
      this.ensureCurrent();
      const value = operation();
      this.ensureCurrent();
      return value;
    });
    this.ensureCurrent();
    return result;
  }
  get isAssetIntegrityVerified(): boolean { return this.assetIntegrityVerified; }
  markAssetIntegrityVerified(): void { this.assetIntegrityVerified = true; }
  undo(): void { this.ensureCurrent(); const operation = this.undoStack.pop(); if (!operation) throw new RealmError("nothing_to_undo", "There is nothing to undo."); try { this.store.restoreState(operation.before); this.refreshPathIdentity(); this.redoStack.push(operation); } catch (error) { this.undoStack.push(operation); throw error; } }
  redo(): void { this.ensureCurrent(); const operation = this.redoStack.pop(); if (!operation) throw new RealmError("nothing_to_redo", "There is nothing to redo."); try { this.store.restoreState(operation.after); this.refreshPathIdentity(); this.undoStack.push(operation); } catch (error) { this.redoStack.push(operation); throw error; } }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  clearHistory(): void { this.undoStack = []; this.redoStack = []; }
  close(): void { if (this.database.isOpen) this.database.close(); }
}
