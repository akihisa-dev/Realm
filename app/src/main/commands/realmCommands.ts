import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import type { RealmBackend, RealmSnapshot, ProjectSummary, CreateFeatureInput, CreateFeaturesBatchInput, ReviseFeaturesBatchInput, ReviseFeatureInput, DeleteFeaturesBatchInput, SetFeaturesLockedInput, ProjectSettings, ImportAssetInput, ImportAssetsBatchInput, AssetRead, CreateMapShapesInput, UpdateMapShapesInput, DeleteMapShapesInput, DeleteAssetsBatchInput, ReplaceObjectLayerInput, ReplaceRegionLayerInput, ReplaceTerrainLayerInput, ObjectKind } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateName } from "../domain/geometry";
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
import { replaceObjectLayer as replaceObjectLayerCommand } from "./objectCommands";
import { replaceRegionLayer as replaceRegionLayerCommand, replaceTerrainAndRegionLayers, replaceTerrainLayer as replaceTerrainLayerCommand } from "./layerCommands";

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
  async saveProject(input: { name: string }): Promise<RealmSnapshot> { assertRecord(input); const name = validateName(input.name); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { if (session.database.prepare("UPDATE world SET name=?").run(name).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record."); }); session.checkpoint(before, "project-name"); return projectSnapshot(session); }
  async updateProjectSettings(input: { settings: ProjectSettings }): Promise<RealmSnapshot> { assertRecord(input); const settings = validateSettings(input.settings); const session = this.current(); const before = captureState(session.database); transaction(session.database, () => { if (session.database.prepare("UPDATE world SET settings_json=?").run(JSON.stringify(settings)).changes !== 1) throw new RealmError("corrupt_project", "The project must contain exactly one world record."); }); session.checkpoint(before, "settings"); return projectSnapshot(session); }
  async replaceTerrainLayer(input: ReplaceTerrainLayerInput): Promise<RealmSnapshot> { return replaceTerrainLayerCommand(() => this.current(), input); }
  async replaceRegionLayer(input: ReplaceRegionLayerInput): Promise<RealmSnapshot> { return replaceRegionLayerCommand(() => this.current(), input); }
  async replaceObjectLayer(input: ReplaceObjectLayerInput): Promise<RealmSnapshot> { return replaceObjectLayerCommand(() => this.current(), input); }
  private objectKind(featureType: CreateFeatureInput["featureType"]): ObjectKind { if (featureType === "city" || featureType === "text" || featureType === "mountain" || featureType === "forest") return featureType; throw invalid("この地物種別はオブジェクトとして扱えません。"); }
  async createFeature(input: CreateFeatureInput): Promise<RealmSnapshot> { return this.createFeaturesBatch({ features: [input] }); }
  async createFeaturesBatch(input: CreateFeaturesBatchInput): Promise<RealmSnapshot> {
    assertRecord(input); const current = this.current(); const objects = [...projectSnapshot(current).layers.objects];
    for (const [index, feature] of input.features.entries()) objects.push({ id: crypto.randomUUID(), kind: this.objectKind(feature.featureType), label: feature.name, geometry: feature.geometry, properties: feature.properties ?? {}, zIndex: objects.length + index, locked: feature.properties?.locked === true, ...(typeof feature.properties?.assetId === "string" ? { assetId: feature.properties.assetId } : {}) });
    return this.replaceObjectLayer({ objects });
  }
  async reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot> { return this.reviseFeaturesBatch({ features: [input] }); }
  async reviseFeaturesBatch(input: ReviseFeaturesBatchInput): Promise<RealmSnapshot> {
    assertRecord(input); const current = this.current(); const objects = [...projectSnapshot(current).layers.objects];
    for (const feature of input.features) { const index = objects.findIndex((object) => object.id === feature.id); if (index < 0) throw new RealmError("not_found", "The object was not found."); const object = objects[index]!; if (object.locked) throw new RealmError("feature_locked", "The object is locked and cannot be changed."); objects[index] = { ...object, label: feature.name, geometry: feature.geometry, properties: feature.properties ?? {}, locked: feature.properties?.locked === true, ...(typeof feature.properties?.assetId === "string" ? { assetId: feature.properties.assetId } : {}) }; }
    return this.replaceObjectLayer({ objects });
  }
  async deleteFeature(input: { id: string }): Promise<RealmSnapshot> { return this.deleteFeaturesBatch({ ids: [input.id] }); }
  async deleteFeaturesBatch(input: DeleteFeaturesBatchInput): Promise<RealmSnapshot> { assertRecord(input); const current = this.current(); const ids = new Set(input.ids); const objects = projectSnapshot(current).layers.objects; const target = objects.filter((object) => ids.has(object.id)); if (target.length !== ids.size) throw new RealmError("not_found", "The object was not found."); if (target.some((object) => object.locked)) throw new RealmError("feature_locked", "The object is locked and cannot be changed."); return this.replaceObjectLayer({ objects: objects.filter((object) => !ids.has(object.id)) }); }
  async setFeaturesLocked(input: SetFeaturesLockedInput): Promise<RealmSnapshot> { assertRecord(input); const current = this.current(); const ids = new Set(input.ids); const objects = projectSnapshot(current).layers.objects.map((object) => ids.has(object.id) ? { ...object, locked: input.locked } : object); if (objects.filter((object) => ids.has(object.id)).length !== ids.size) throw new RealmError("not_found", "The object was not found."); return this.replaceObjectLayer({ objects }); }
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> { return importAssetCommand(() => this.current(), input); }
  async importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot> { return importAssetsBatchCommand(() => this.current(), input); }
  async readAsset(input: { id: string }): Promise<AssetRead> { return readAssetCommand(() => this.current(), input); }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(() => this.current(), { ids: [input.id] }); }
  async deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot> { return deleteAssetsBatchCommand(() => this.current(), input); }
  private mapShapesToLayers(shapes: RealmSnapshot["mapShapes"]): { terrain: RealmSnapshot["layers"]["terrain"]; regions: RealmSnapshot["layers"]["regions"] } { const terrain = shapes.filter((shape) => shape.layer === "terrain").map(({ id, geometry }) => ({ id, geometry })); const regionMap = new Map<string, { id: string; name: string; color: string; shapes: { id: string; geometry: typeof shapes[number]["geometry"] }[] }>(); for (const shape of shapes.filter((candidate) => candidate.layer === "region")) { const region = regionMap.get(shape.regionId!) ?? { id: shape.regionId!, name: "領域", color: shape.value, shapes: [] }; region.shapes.push({ id: shape.id, geometry: shape.geometry }); regionMap.set(region.id, region); } return { terrain, regions: [...regionMap.values()] }; }
  async createMapShapes(input: CreateMapShapesInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.shapes) || input.shapes.length < 1) throw invalid("The map shape batch is invalid."); const current = this.current(); const existingIds = new Set(projectSnapshot(current).mapShapes.map((shape) => shape.id)); if (input.shapes.some((shape) => existingIds.has(shape.id))) throw invalid("A map shape identifier already exists."); const shapes = [...projectSnapshot(current).mapShapes, ...input.shapes]; return replaceTerrainAndRegionLayers(() => this.current(), this.mapShapesToLayers(shapes)); }
  async updateMapShapes(input: UpdateMapShapesInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.shapes)) throw invalid("The map shape batch is invalid."); return replaceTerrainAndRegionLayers(() => this.current(), this.mapShapesToLayers(input.shapes)); }
  async deleteMapShapes(input: DeleteMapShapesInput): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.ids) || input.ids.length < 1) throw invalid("The map shape identifier batch is invalid."); const current = this.current(); const ids = new Set(input.ids); const shapes = projectSnapshot(current).mapShapes; if (input.ids.some((id) => !shapes.some((shape) => shape.id === id))) throw new RealmError("not_found", "The map shape was not found."); return this.updateMapShapes({ shapes: shapes.filter((shape) => !ids.has(shape.id)) }); }
  async undoProject(): Promise<RealmSnapshot> { const session = this.current(); session.undo(); return projectSnapshot(session); }
  async redoProject(): Promise<RealmSnapshot> { const session = this.current(); session.redo(); return projectSnapshot(session); }
  async closeProject(): Promise<void> {
    this.session?.close();
    this.session = null;
  }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.session ? projectSnapshot(this.session) : null; }
}

export function createRealmCommands(options: RealmCommandsOptions): RealmCommands { return new RealmCommands(options); }
