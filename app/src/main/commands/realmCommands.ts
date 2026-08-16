import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RealmBackend, RealmSnapshot, ProjectSummary, CreateFeatureInput, CreateFeaturesBatchInput, ReviseFeaturesBatchInput, ReviseFeatureInput, DeleteFeaturesBatchInput, SetFeaturesLockedInput, ProjectSettings, ImportAssetInput, ImportAssetsBatchInput, AssetRead, FeatureProperties, MapShape, CreateMapShapesInput, UpdateMapShapesInput, DeleteMapShapesInput } from "../../shared/realmContract";
import { RealmError, invalid } from "../domain/errors";
import { validateName, validateGeometry, validateProperties } from "../domain/geometry";
import { validateSettings } from "../domain/settings";
import { MAX_ASSET_BYTES, sha256Hex, validateAsset } from "../domain/assets";
import { projectSnapshot } from "../read-model/snapshot";
import { validateMapShapes } from "../../shared/mapShapeGeometry";
import { captureState } from "../edit/operations";
import { transaction } from "../storage/schema";
import { copyBytesAtomic, copySqliteSnapshot } from "../storage/atomic";
import { canonicalParentPath, preflightExistingProject, validateProjectPath } from "../storage/path";
import { assertLibraryDirectory, libraryIdFromFilename, libraryProjectPath, newLibraryProjectPath, validateLibraryDirectory, type LibraryDirectoryIdentity } from "../storage/library";
import { createProject, openProject } from "../storage/project";
import type { OpenProjectSession } from "../state/session";

const PROJECT_EXTENSION = ".realmmap";
const MAX_FEATURE_BATCH = 2048;
const MAX_ASSET_BATCH = 256;
const assetKeys = new Set(["assetId", "assetIds", "asset_id", "asset_ids", "asset"]);
const containsAsset = (value: unknown, id: string, key?: string): boolean => typeof value === "string" ? Boolean(key && assetKeys.has(key) && value === id) : Array.isArray(value) ? value.some((item) => containsAsset(item, id, key)) : Boolean(value && typeof value === "object" && Object.entries(value as Record<string, unknown>).some(([nestedKey, nestedValue]) => containsAsset(nestedValue, id, nestedKey)));
const fileExtension = (path: string): string => extname(path).toLowerCase();
const canonicalUuid = (raw: string, label: string): string => {
  if (typeof raw !== "string") throw invalid(`The ${label} identifier is invalid.`);
  const value = raw.trim();
  if (value.length > 128 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw invalid(`The ${label} identifier is invalid.`);
  return value.toLowerCase();
};
const canonicalFeatureId = (raw: string): string => canonicalUuid(raw, "feature");
const canonicalAssetId = (raw: string): string => canonicalUuid(raw, "asset");
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
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> { const prepared = validateAsset(input); const session = this.current(); const existing = session.database.prepare("SELECT id FROM assets WHERE sha256=?").get(prepared.sha256); if (existing) return projectSnapshot(session); const before = captureState(session.database); transaction(session.database, () => { session.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), prepared.sha256, prepared.mime, prepared.bytes, prepared.width, prepared.height, JSON.stringify(prepared.metadata)); }); session.checkpoint(before, "import-asset"); return projectSnapshot(session); }
  async importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot> {
    assertRecord(input); if (typeof input.packName !== "string" || !Array.isArray(input.assets)) throw invalid("The asset pack is invalid.");
    const packName = validateName(input.packName); if ([...packName].length > 128 || input.assets.length < 1 || input.assets.length > MAX_ASSET_BATCH || input.assets.reduce((sum, asset) => sum + (Array.isArray(asset?.bytes) ? asset.bytes.length : Number.POSITIVE_INFINITY), 0) > 64 * 1024 * 1024) throw invalid("The asset pack is invalid.");
    const prepared = input.assets.map((asset, ordinal) => ({ ordinal, asset: validateAsset(asset) }));
    if (prepared.some(({ asset }) => Object.keys(asset.metadata).some((key) => ["packId", "packName", "packOrdinal"].includes(key)))) throw invalid("Asset metadata contains reserved pack fields.");
    const session = this.current(); const known = new Set((session.database.prepare("SELECT sha256 FROM assets").all() as Record<string, unknown>[]).map((row) => String(row.sha256)));
    const additions = prepared.filter(({ asset }) => { if (known.has(asset.sha256)) return false; known.add(asset.sha256); return true; }); if (!additions.length) return projectSnapshot(session);
    const before = captureState(session.database); const packId = randomUUID(); transaction(session.database, () => { const statement = session.database.prepare("INSERT INTO assets(id,sha256,mime,bytes,width,height,metadata_json) VALUES (?,?,?,?,?,?,?)"); additions.forEach(({ ordinal, asset }) => statement.run(randomUUID(), asset.sha256, asset.mime, asset.bytes, asset.width, asset.height, JSON.stringify({ ...asset.metadata, packId, packName, packOrdinal: ordinal }))); }); session.checkpoint(before, "import-assets"); return projectSnapshot(session);
  }
  async readAsset(input: { id: string }): Promise<AssetRead> {
    const id = canonicalAssetId(input.id); const session = this.current(); const row = session.database.prepare("SELECT id,sha256,mime,length(bytes) AS byteLength,bytes,width,height,metadata_json AS metadata FROM assets WHERE id=?").get(id) as Record<string, unknown> | undefined; if (!row) throw new RealmError("not_found", "The asset was not found.");
    const bytes = row.bytes instanceof Uint8Array ? [...row.bytes] : Array.isArray(row.bytes) ? row.bytes : [];
    const sha256 = String(row.sha256).toLowerCase(); if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) || !/^[0-9a-f]{64}$/u.test(sha256) || sha256Hex(Uint8Array.from(bytes)) !== sha256) throw new RealmError("corrupt_project", "The asset hash or size is invalid.");
    let metadata: FeatureProperties; try { metadata = JSON.parse(String(row.metadata)) as FeatureProperties; validateAsset({ sha256, mime: String(row.mime), bytes, width: Number(row.width), height: Number(row.height), metadata }); } catch { throw new RealmError("corrupt_project", "The asset contents are invalid."); }
    return { manifest: { id, sha256, mime: String(row.mime), byteLength: bytes.length, width: Number(row.width), height: Number(row.height), metadata }, bytes };
  }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> { return this.deleteAssetsBatch({ ids: [input.id] }); }
  async deleteAssetsBatch(input: { ids: string[] }): Promise<RealmSnapshot> { assertRecord(input); if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_ASSET_BATCH) throw invalid("The asset batch is invalid."); const ids = input.ids.map(canonicalAssetId); if (new Set(ids).size !== ids.length) throw invalid("An asset batch cannot contain duplicate identifiers."); const session = this.current(); const rows = ids.map((id) => session.database.prepare("SELECT id FROM assets WHERE id=?").get(id)); if (rows.some((row) => !row)) throw new RealmError("not_found", "The asset was not found."); const features = session.database.prepare("SELECT properties_json AS propertiesJson FROM features").all() as Record<string, unknown>[]; try { if (ids.some((id) => features.some((row) => containsAsset(JSON.parse(String(row.propertiesJson)), id)))) throw new RealmError("asset_in_use", "The asset is still referenced by a feature."); } catch (error) { if (error instanceof RealmError) throw error; throw new RealmError("corrupt_project", "A feature contains invalid properties."); } const before = captureState(session.database, { assetBytesFor: ids }); transaction(session.database, () => { const statement = session.database.prepare("DELETE FROM assets WHERE id=?"); for (const id of ids) statement.run(id); }); session.checkpoint(before, "delete-assets"); return projectSnapshot(session); }
  private persistMapShapes(shapes: readonly MapShape[], label: string): RealmSnapshot {
    try { validateMapShapes(shapes); } catch { throw invalid("The map shape geometry is invalid or overlaps another shape."); }
    const session = this.current();
    const before = captureState(session.database);
    transaction(session.database, () => {
      session.database.exec("DELETE FROM map_shapes");
      const statement = session.database.prepare("INSERT INTO map_shapes(id,layer,region_id,value,geometry_version,snap_grid_version,geometry_json) VALUES (?,?,?,?,?,?,?)");
      for (const shape of shapes) statement.run(shape.id, shape.layer, shape.regionId ?? null, shape.value, shape.geometryVersion, shape.snapGridVersion, JSON.stringify(shape.geometry));
    });
    session.checkpoint(before, label);
    return projectSnapshot(session);
  }

  async createMapShapes(input: CreateMapShapesInput): Promise<RealmSnapshot> {
    assertRecord(input);
    if (!Array.isArray(input.shapes)) throw invalid("The map shape batch is invalid.");
    const current = projectSnapshot(this.current()).mapShapes;
    const ids = new Set(current.map((shape) => shape.id));
    if (input.shapes.some((shape) => ids.has(shape.id))) throw invalid("A map shape identifier already exists.");
    return this.persistMapShapes([...current, ...input.shapes], "map-shapes-create");
  }

  async updateMapShapes(input: UpdateMapShapesInput): Promise<RealmSnapshot> {
    assertRecord(input);
    if (!Array.isArray(input.shapes)) throw invalid("The map shape batch is invalid.");
    return this.persistMapShapes(input.shapes, "map-shapes-update");
  }

  async deleteMapShapes(input: DeleteMapShapesInput): Promise<RealmSnapshot> {
    assertRecord(input);
    if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 4096 || input.ids.some((id) => typeof id !== "string")) throw invalid("The map shape identifier batch is invalid.");
    const ids = input.ids.map((id) => canonicalUuid(id, "map shape"));
    if (new Set(ids).size !== ids.length) throw invalid("The map shape identifiers must be unique.");
    const current = projectSnapshot(this.current()).mapShapes;
    if (ids.some((id) => !current.some((shape) => shape.id === id))) throw new RealmError("not_found", "The map shape was not found.");
    return this.persistMapShapes(current.filter((shape) => !ids.includes(shape.id)), "map-shapes-delete");
  }
  async undoProject(): Promise<RealmSnapshot> { const session = this.current(); session.undo(); return projectSnapshot(session); }
  async redoProject(): Promise<RealmSnapshot> { const session = this.current(); session.redo(); return projectSnapshot(session); }
  async closeProject(): Promise<void> {
    this.session?.close();
    this.session = null;
  }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.session ? projectSnapshot(this.session) : null; }
}

export function createRealmCommands(options: RealmCommandsOptions): RealmCommands { return new RealmCommands(options); }
