import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RealmBackend, RealmSnapshot, ProjectSummary, CreateFeatureInput, CreateFeaturesBatchInput, ReviseFeaturesBatchInput, ReviseFeatureInput, DeleteFeaturesBatchInput, SetFeaturesLockedInput, ProjectSettings, ImportAssetInput, ImportAssetsBatchInput, AssetRead, FeatureProperties, CreateMapShapesInput, UpdateMapShapesInput, DeleteMapShapesInput, DeleteAssetsBatchInput } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateName, validateGeometry, validateProperties } from "../domain/geometry";
import { canonicalUuid } from "../domain/identifiers";
import { validateSettings } from "../domain/settings";
import { projectSnapshot } from "../read-model/snapshot";
import { captureState } from "../edit/operations";
import { transaction } from "../storage/schema";
import { copyBytesAtomic, copySqliteSnapshot } from "../storage/atomic";
import { canonicalParentPath, preflightExistingProject, validateProjectPath } from "../storage/path";
import { assertLibraryDirectory, libraryIdFromFilename, libraryProjectPath, newLibraryProjectPath, validateLibraryDirectory, type LibraryDirectoryIdentity } from "../storage/library";
import { createProject, openProject } from "../storage/project";
import type { OpenProjectSession } from "../state/session";
import { deleteAssetsBatch as deleteAssetsBatchCommand, importAsset as importAssetCommand, importAssetsBatch as importAssetsBatchCommand, readAsset as readAssetCommand } from "./assetCommands";
import { createMapShapes as createMapShapesCommand, deleteMapShapes as deleteMapShapesCommand, updateMapShapes as updateMapShapesCommand } from "./mapShapeCommands";

const PROJECT_EXTENSION = ".realmmap";
const MAX_FEATURE_BATCH = 2048;
const fileExtension = (path: string): string => extname(path).toLowerCase();
const canonicalFeatureId = (raw: string): string => canonicalUuid(raw, "feature");
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
  async saveProject(input: { name: string }): Promise<RealmSnapshot> { assertRecord(input); const name = validateName(input.name); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { if (session.database.prepare("UPDATE world SET name=?").run(name).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record."); }); session.checkpoint(before, "project-name"); return projectSnapshot(session); }
  async updateProjectSettings(input: { settings: ProjectSettings }): Promise<RealmSnapshot> { assertRecord(input); const settings = validateSettings(input.settings); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { if (session.database.prepare("UPDATE world SET settings_json=?").run(JSON.stringify(settings)).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record."); }); session.checkpoint(before, "settings"); return projectSnapshot(session); }
  private ensureBatch(count: number, message: string): void { if (!Number.isSafeInteger(count) || count < 1 || count > MAX_FEATURE_BATCH) throw invalid(message); }
  async createFeature(input: CreateFeatureInput): Promise<RealmSnapshot> { return this.createFeaturesBatch({ features: [input] }); }
  async createFeaturesBatch(input: CreateFeaturesBatchInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.features)) throw invalid("The feature batch size is invalid."); this.ensureBatch(input.features.length, "The feature batch size is invalid."); input.features.forEach(assertRecord); const prepared = input.features.map((feature) => ({ ...feature, name: validateName(feature.name), geometryJson: validateGeometry(feature.featureType, feature.geometry), propertiesJson: JSON.stringify(validateProperties(feature.properties === undefined ? {} : feature.properties)) })); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { const statement = session.database.prepare("INSERT INTO features(id,feature_type,name,geometry_json,properties_json) VALUES (?,?,?,?,?)"); for (const feature of prepared) statement.run(randomUUID(), feature.featureType, feature.name, feature.geometryJson, feature.propertiesJson); }); session.checkpoint(before, "create-features"); return projectSnapshot(session); }
  async reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot> { return this.reviseFeaturesBatch({ features: [input] }); }
  async reviseFeaturesBatch(input: ReviseFeaturesBatchInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.features)) throw invalid("The feature batch size is invalid."); this.ensureBatch(input.features.length, "The feature batch size is invalid."); input.features.forEach(assertRecord); const preparedIds = input.features.map((item) => canonicalFeatureId(item.id)); if (new Set(preparedIds).size !== input.features.length) throw invalid("Feature identifiers must be unique."); const session = this.current(); const prepared = input.features.map((feature, index) => { const id = preparedIds[index]!; const current = session.database.prepare("SELECT feature_type AS featureType,properties_json AS propertiesJson FROM features WHERE id=?").get(id) as { featureType: string; propertiesJson: string } | undefined; if (!current) throw new RealmError("not_found", "The feature was not found."); const props = JSON.parse(current.propertiesJson) as FeatureProperties; if (props.locked === true) throw new RealmError("feature_locked", "The feature is locked and cannot be changed."); return { ...feature, id, name: validateName(feature.name), geometryJson: validateGeometry(current.featureType as CreateFeatureInput["featureType"], feature.geometry), propertiesJson: JSON.stringify(validateProperties(feature.properties === undefined ? {} : feature.properties)) }; }); const before = captureState(session.database); transaction(session.database, () => { const statement = session.database.prepare("UPDATE features SET name=?,geometry_json=?,properties_json=? WHERE id=?"); for (const feature of prepared) if (statement.run(feature.name, feature.geometryJson, feature.propertiesJson, feature.id).changes !== 1) throw new RealmError("not_found", "The feature was not found."); }); session.checkpoint(before, "revise-features"); return projectSnapshot(session); }
  async deleteFeature(input: { id: string }): Promise<RealmSnapshot> { return this.deleteFeaturesBatch({ ids: [input.id] }); }
  async deleteFeaturesBatch(input: DeleteFeaturesBatchInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.ids)) throw invalid("The feature batch size is invalid."); this.ensureBatch(input.ids.length, "The feature batch size is invalid."); const ids = input.ids.map(canonicalFeatureId); if (new Set(ids).size !== ids.length) throw invalid("Feature identifiers must be unique."); const session = this.current(); const rows = ids.map((id) => session.database.prepare("SELECT properties_json AS propertiesJson FROM features WHERE id=?").get(id) as { propertiesJson: string } | undefined); if (rows.some((row) => !row)) throw new RealmError("not_found", "The feature was not found."); let locked = false; try { locked = rows.some((row) => JSON.parse(row!.propertiesJson).locked === true); } catch { throw new RealmError("corrupt_project", "A feature contains invalid properties."); } if (locked) throw new RealmError("feature_locked", "The feature is locked and cannot be changed."); const before = captureState(session.database); transaction(session.database, () => { const statement = session.database.prepare("DELETE FROM features WHERE id=?"); for (const id of ids) statement.run(id); }); session.checkpoint(before, "delete-features"); return projectSnapshot(session); }
  async setFeaturesLocked(input: SetFeaturesLockedInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.ids)) throw invalid("The feature batch size is invalid."); this.ensureBatch(input.ids.length, "The feature batch size is invalid."); const ids = input.ids.map(canonicalFeatureId); if (new Set(ids).size !== ids.length) throw invalid("Feature identifiers must be unique."); if (typeof input.locked !== "boolean") throw invalid("The feature lock value is invalid."); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { const statement = session.database.prepare("UPDATE features SET properties_json=json_set(properties_json,'$.locked',json(?)) WHERE id=?"); for (const id of ids) if (statement.run(input.locked ? "true" : "false", id).changes !== 1) throw new RealmError("not_found", "The feature was not found."); }); session.checkpoint(before, "lock-features"); return projectSnapshot(session); }
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> { return importAssetCommand(this.current(), input); }
  async importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot> { return importAssetsBatchCommand(this.current(), input); }
  async readAsset(input: { id: string }): Promise<AssetRead> { return readAssetCommand(this.current(), input); }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(this.current(), { ids: [input.id] }); }
  async deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(this.current(), input); }
  async createMapShapes(input: CreateMapShapesInput): Promise<RealmSnapshot> { return createMapShapesCommand(this.current(), input); }
  async updateMapShapes(input: UpdateMapShapesInput): Promise<RealmSnapshot> { return updateMapShapesCommand(this.current(), input); }
  async deleteMapShapes(input: DeleteMapShapesInput): Promise<RealmSnapshot> { return deleteMapShapesCommand(this.current(), input); }
  async undoProject(): Promise<RealmSnapshot> { const session = this.current(); session.undo(); return projectSnapshot(session); }
  async redoProject(): Promise<RealmSnapshot> { const session = this.current(); session.redo(); return projectSnapshot(session); }
  async closeProject(): Promise<void> {
    this.session?.close();
    this.session = null;
  }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.session ? projectSnapshot(this.session) : null; }
}

export function createRealmCommands(options: RealmCommandsOptions): RealmCommands { return new RealmCommands(options); }
