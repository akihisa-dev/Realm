import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import type { RealmBackend, RealmSnapshot, ProjectSummary, ProjectSettings, ImportAssetInput, ImportAssetsBatchInput, AssetRead, DeleteAssetsBatchInput, ReplaceObjectLayerInput, ReplaceRegionLayerInput, ReplaceTerrainLayerInput, ReplaceLayerTreeInput, ReplaceMapContentInput } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateName } from "../domain/geometry";
import { validateSettings } from "../domain/settings";
import { projectSnapshot } from "../read-model/snapshot";
import { copyBytesAtomic, copySqliteSnapshot } from "../storage/atomic";
import { canonicalParentPath, preflightExistingProject, validateProjectPath } from "../storage/path";
import { assertLibraryDirectory, libraryIdFromFilename, libraryProjectPath, newLibraryProjectPath, validateLibraryDirectory, type LibraryDirectoryIdentity } from "../storage/library";
import { createProject, openProject } from "../storage/project";
import type { OpenProjectSession } from "../state/session";
import { deleteAssetsBatch as deleteAssetsBatchCommand, importAsset as importAssetCommand, importAssetsBatch as importAssetsBatchCommand, readAsset as readAssetCommand } from "./assetCommands";
import { replaceObjectLayer as replaceObjectLayerCommand } from "./objectCommands";
import { replaceRegionLayer as replaceRegionLayerCommand, replaceTerrainLayer as replaceTerrainLayerCommand } from "./layerCommands";
import { replaceLayerTree as replaceLayerTreeCommand } from "./layerTreeCommands";
import { replaceMapContent as replaceMapContentCommand } from "./mapContentCommands";

const PROJECT_EXTENSION = ".realmmap";
const fileExtension = (path: string): string => extname(path).toLowerCase();
function assertRecord(input: unknown): asserts input is Record<string, unknown> { if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid."); }

export type RealmCommandsOptions = { libraryDirectory: string };

export class RealmCommands implements RealmBackend {
  readonly libraryDirectory: string; private readonly libraryIdentity: LibraryDirectoryIdentity; private session: OpenProjectSession | null = null;
  constructor(options: RealmCommandsOptions) { this.libraryIdentity = validateLibraryDirectory(options.libraryDirectory); this.libraryDirectory = this.libraryIdentity.path; }
  private assertLibrary(): void { assertLibraryDirectory(this.libraryIdentity); }
  private current(): OpenProjectSession { this.assertLibrary(); if (!this.session) throw new RealmError("no_open_project", "No project is open."); this.session.ensureCurrent(); return this.session; }
  private setSession(session: OpenProjectSession): RealmSnapshot {
    this.session?.close();
    this.session = session;
    return projectSnapshot(session);
  }
  private defaultProjectPath(): string { return newLibraryProjectPath(this.libraryDirectory); }
  private managedProjectPath(libraryId: string): string {
    return libraryProjectPath(this.libraryDirectory, libraryId);
  }
  async listProjects(): Promise<ProjectSummary[]> {
    this.assertLibrary();
    const projects: ProjectSummary[] = [];
    for (const entry of readdirSync(this.libraryDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || fileExtension(entry.name) !== PROJECT_EXTENSION) continue;
      const libraryId = libraryIdFromFilename(entry.name);
      if (!libraryId) continue;
      const path = join(this.libraryDirectory, entry.name);
      let checked: ReturnType<typeof preflightExistingProject> | undefined;
      try {
        checked = preflightExistingProject(path);
        const world = checked.database.prepare("SELECT id,name FROM world LIMIT 1").get() as { id: string; name: string };
        projects.push({ libraryId, name: String(world.name) });
      } catch { /* corrupt managed files are ignored by the library listing */ }
      finally { checked?.close(); }
    }
    return projects.sort((left, right) => left.name.localeCompare(right.name) || left.libraryId.localeCompare(right.libraryId));
  }
  async createProject(input: { name: string; path?: string }): Promise<RealmSnapshot> {
    assertRecord(input);
    if (input.path !== undefined) throw invalid("Project creation paths are managed by Realm.");
    const name = validateName(input.name);
    this.assertLibrary();
    return this.setSession(createProject(this.defaultProjectPath(), name, this.libraryIdentity));
  }
  async openProject(input: { libraryId: string }): Promise<RealmSnapshot> {
    assertRecord(input);
    if (typeof input.libraryId !== "string") throw invalid("Opening a project requires a managed library identifier.");
    this.assertLibrary();
      return this.setSession(openProject(this.managedProjectPath(input.libraryId), this.libraryIdentity));
  }
  async importProject(input: { path: string }): Promise<RealmSnapshot> {
    assertRecord(input);
    const source = preflightExistingProject(input.path);
    const destination = this.defaultProjectPath();
    try {
      this.assertLibrary();
      await copySqliteSnapshot(source, destination, "realm-import", this.libraryIdentity);
    } finally { source.close(); }
    this.assertLibrary();
    return this.setSession(openProject(destination, this.libraryIdentity));
  }
  async exportProject(input: { path: string }): Promise<void> { assertRecord(input); const destination = validateProjectPath(input.path, false); const session = this.current(); const source = preflightExistingProject(session.path); try { await copySqliteSnapshot(source, destination, "realm-export"); } finally { source.close(); } }
  async writeArtifact(input: { path: string; bytes: number[] }): Promise<void> { assertRecord(input); const destination = canonicalParentPath(input.path); const extension = fileExtension(destination); if (![".png", ".jpg", ".jpeg", ".pdf"].includes(extension)) throw invalid("Artifacts must use the .png, .jpg, .jpeg, or .pdf extension."); if (!Array.isArray(input.bytes) || input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw invalid("The artifact bytes are invalid."); const bytes = Uint8Array.from(input.bytes); if (bytes.length > 50 * 1024 * 1024) throw invalid("The artifact is too large."); const valid = extension === ".png" ? bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137,80,78,71,13,10,26,10][index]) : extension === ".jpg" || extension === ".jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"; if (!valid) throw invalid("The artifact content does not match its file extension."); copyBytesAtomic(bytes, destination); }
  async saveProject(input: { name: string }): Promise<RealmSnapshot> { assertRecord(input); const name = validateName(input.name); const session = this.current(); session.mutate("project-name", (store) => store.updateProjectName(name)); return projectSnapshot(session); }
  async updateProjectSettings(input: { settings: ProjectSettings }): Promise<RealmSnapshot> { assertRecord(input); const settings = validateSettings(input.settings); const session = this.current(); session.mutate("settings", (store) => store.updateProjectSettings(JSON.stringify(settings))); return projectSnapshot(session); }
  async replaceTerrainLayer(input: ReplaceTerrainLayerInput): Promise<RealmSnapshot> { return replaceTerrainLayerCommand(() => this.current(), input); }
  async replaceRegionLayer(input: ReplaceRegionLayerInput): Promise<RealmSnapshot> { return replaceRegionLayerCommand(() => this.current(), input); }
  async replaceObjectLayer(input: ReplaceObjectLayerInput): Promise<RealmSnapshot> { return replaceObjectLayerCommand(() => this.current(), input); }
  async replaceLayerTree(input: ReplaceLayerTreeInput): Promise<RealmSnapshot> { return replaceLayerTreeCommand(() => this.current(), input); }
  async replaceMapContent(input: ReplaceMapContentInput): Promise<RealmSnapshot> { return replaceMapContentCommand(() => this.current(), input); }
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> { return importAssetCommand(() => this.current(), input); }
  async importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot> { return importAssetsBatchCommand(() => this.current(), input); }
  async readAsset(input: { id: string }): Promise<AssetRead> { return readAssetCommand(() => this.current(), input); }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(() => this.current(), { ids: [input.id] }); }
  async deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(() => this.current(), input); }
  async undoProject(): Promise<RealmSnapshot> { const session = this.current(); session.undo(); return projectSnapshot(session); }
  async redoProject(): Promise<RealmSnapshot> { const session = this.current(); session.redo(); return projectSnapshot(session); }
  async closeProject(): Promise<void> {
    this.session?.close();
    this.session = null;
  }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.session ? projectSnapshot(this.session) : null; }
}

export function createRealmCommands(options: RealmCommandsOptions): RealmCommands { return new RealmCommands(options); }
