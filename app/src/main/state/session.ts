import type { DatabaseSync } from "node:sqlite";
import type { EditOperation, PersistentState } from "../edit/operations";
import { captureAssetBytes, captureState, equalState, restoreState } from "../edit/operations";
import { sameIdentity, sourceIdentity, type SourceIdentity } from "../storage/path";
import { RealmError } from "../domain/errors";

export class OpenProjectSession {
  readonly path: string; readonly database: DatabaseSync; private identity: SourceIdentity; private undoStack: EditOperation[] = []; private redoStack: EditOperation[] = []; private assetIntegrityVerified = false;
  constructor(path: string, database: DatabaseSync) { this.path = path; this.database = database; this.identity = sourceIdentity(path); }
  /** Guard every normal read or update against an external path/content change. */
  ensureCurrent(): void { if (!sameIdentity(this.identity, sourceIdentity(this.path))) throw new RealmError("invalid_path", "The project file changed while it was open."); }
  ensurePathIdentity(): void { this.ensureCurrent(); }
  refreshPathIdentity(): void { this.identity = sourceIdentity(this.path); }
  checkpoint(before: PersistentState, label: string): void {
    const after = captureState(this.database);
    const beforeAssets = new Map(before.assets.map((asset) => [asset.id, asset]));
    const changedAssetIds = after.assets.filter((asset) => {
      const previous = beforeAssets.get(asset.id);
      return !previous || previous.sha256 !== asset.sha256 || previous.mime !== asset.mime || previous.width !== asset.width || previous.height !== asset.height || previous.metadataJson !== asset.metadataJson;
    }).map((asset) => asset.id);
    captureAssetBytes(this.database, after, changedAssetIds);
    this.refreshPathIdentity();
    if (!equalState(before, after)) { this.undoStack.push({ before, after, label }); this.redoStack = []; }
  }
  get isAssetIntegrityVerified(): boolean { return this.assetIntegrityVerified; }
  markAssetIntegrityVerified(): void { this.assetIntegrityVerified = true; }
  undo(): void { this.ensureCurrent(); const operation = this.undoStack.pop(); if (!operation) throw new RealmError("nothing_to_undo", "There is nothing to undo."); try { restoreState(this.database, operation.before); this.refreshPathIdentity(); this.redoStack.push(operation); } catch (error) { this.undoStack.push(operation); throw error; } }
  redo(): void { this.ensureCurrent(); const operation = this.redoStack.pop(); if (!operation) throw new RealmError("nothing_to_redo", "There is nothing to redo."); try { restoreState(this.database, operation.after); this.refreshPathIdentity(); this.undoStack.push(operation); } catch (error) { this.redoStack.push(operation); throw error; } }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  clearHistory(): void { this.undoStack = []; this.redoStack = []; }
  close(): void { if (this.database.isOpen) this.database.close(); }
}
