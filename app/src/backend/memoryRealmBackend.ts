import type {
  CreateFeatureInput,
  AssetRead, ImportAssetInput, ProjectSummary, RealmBackend, RealmFeature, RealmSnapshot,
  ReviseFeatureInput, ReviseFeaturesBatchInput, SaveProjectInput, CreateMapShapesInput, UpdateMapShapesInput, DeleteMapShapesInput,
} from "./types";
import { validateMapShapes } from "../shared/mapShapeGeometry";

type MemoryProject = {
  snapshot: RealmSnapshot;
  assetBytes: Record<string, number[]>;
};

const makeSnapshot = (path: string, name: string): RealmSnapshot => ({
  formatVersion: 11, path, world: { id: crypto.randomUUID(), name: normalizeName(name) }, features: [], mapShapes: [], assets: [],
  settings: { themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} }, featureCount: 0,
  canUndo: false, canRedo: false,
});

const clone = <T>(value: T): T => structuredClone(value);
const normalizeName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) throw new Error("世界の名前を入力してください。");
  if ([...normalized].length > 200) throw new Error("世界の名前は200文字以内にしてください。");
  return normalized;
};

const validPosition = (position: readonly number[]): position is [number, number] =>
  position.length === 2 && position.every((value, index) => Number.isFinite(value) && (index === 0 ? value >= -180 && value <= 180 : value >= -90 && value <= 90));

const MAX_GEOMETRY_BYTES = 512 * 1024;
const MAX_GEOMETRY_COORDINATES = 4096;
const MIN_POLYGON_AREA = 1e-8;
const SEGMENT_EPSILON = 1e-12;

const validateProperties = (properties: unknown): Record<string, unknown> => {
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) throw new Error("地物のプロパティが不正です。");
  if (new TextEncoder().encode(JSON.stringify(properties)).length > 32 * 1024) throw new Error("地物のプロパティが大きすぎます。");
  return properties as Record<string, unknown>;
};

const featureIsLocked = (feature: RealmFeature): boolean => feature.properties?.locked === true;

const assetReferenceKeys = new Set(["assetId", "assetIds", "asset_id", "asset_ids", "asset"]);
const valueContainsAsset = (value: unknown, assetId: string, key?: string): boolean => {
  if (typeof value === "string") return Boolean(key && assetReferenceKeys.has(key) && value === assetId);
  if (Array.isArray(value)) return value.some((item) => typeof item === "string"
    ? Boolean(key && assetReferenceKeys.has(key) && item === assetId)
    : valueContainsAsset(item, assetId));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([nestedKey, nestedValue]) => valueContainsAsset(nestedValue, assetId, nestedKey));
};

const assetBytesMatchMime = (mime: string, bytes: readonly number[]): boolean => {
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return mime === "image/webp" && bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
};

const prepareAsset = async (input: ImportAssetInput): Promise<{ mime: string; bytes: number[]; width: number; height: number; metadata: Record<string, unknown>; digest: string }> => {
  const mime = input.mime.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || input.bytes.length === 0 || input.bytes.length > 8 * 1024 * 1024 || input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("素材の形式またはサイズが不正です。");
  if (!assetBytesMatchMime(mime, input.bytes)) throw new Error("素材の内容がMIME形式と一致しません。");
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 32768 || input.height > 32768) throw new Error("素材の画像寸法が不正です。");
  const metadata = validateProperties(input.metadata ?? {});
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(input.bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (input.sha256 && input.sha256.toLowerCase() !== digest) throw new Error("素材のハッシュが一致しません。");
  return { mime, bytes: [...input.bytes], width: input.width, height: input.height, metadata: clone(metadata), digest };
};

const geometryPositions = (geometry: CreateFeatureInput["geometry"]): number => geometry.type === "Point"
  ? 1
  : geometry.type === "LineString" ? geometry.coordinates.length : geometry.coordinates.reduce((total, ring) => total + ring.length, 0);

const orientation = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);

const onSegment = (a: readonly number[], b: readonly number[], point: readonly number[]): boolean =>
  point[0]! >= Math.min(a[0]!, b[0]!) && point[0]! <= Math.max(a[0]!, b[0]!)
  && point[1]! >= Math.min(a[1]!, b[1]!) && point[1]! <= Math.max(a[1]!, b[1]!);

const segmentsIntersect = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (((first > SEGMENT_EPSILON && second < -SEGMENT_EPSILON) || (first < -SEGMENT_EPSILON && second > SEGMENT_EPSILON))
    && ((third > SEGMENT_EPSILON && fourth < -SEGMENT_EPSILON) || (third < -SEGMENT_EPSILON && fourth > SEGMENT_EPSILON))) return true;
  return (Math.abs(first) <= SEGMENT_EPSILON && onSegment(a, b, c))
    || (Math.abs(second) <= SEGMENT_EPSILON && onSegment(a, b, d))
    || (Math.abs(third) <= SEGMENT_EPSILON && onSegment(c, d, a))
    || (Math.abs(fourth) <= SEGMENT_EPSILON && onSegment(c, d, b));
};

const pointInRing = (point: readonly number[], ring: readonly (readonly number[])[]): boolean => {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1]!; const b = ring[index]!;
    if ((a[1]! > point[1]!) !== (b[1]! > point[1]!)
      && point[0]! < (b[0]! - a[0]!) * (point[1]! - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
};

const ringsIntersect = (first: readonly (readonly number[])[], second: readonly (readonly number[])[]): boolean => {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      if (segmentsIntersect(first[firstIndex - 1]!, first[firstIndex]!, second[secondIndex - 1]!, second[secondIndex]!)) return true;
    }
  }
  return false;
};

const validatePolygonRelationships = (rings: readonly (readonly (readonly number[])[])[]): void => {
  const shell = rings[0]!;
  for (let index = 1; index < rings.length; index += 1) {
    const hole = rings[index]!;
    if (ringsIntersect(shell, hole) || !pointInRing(hole[0]!, shell)) throw new Error("地物の穴は外周の内側に置いてください。");
    for (let otherIndex = 1; otherIndex < index; otherIndex += 1) {
      const other = rings[otherIndex]!;
      if (ringsIntersect(other, hole) || pointInRing(hole[0]!, other) || pointInRing(other[0]!, hole)) {
        throw new Error("地物の穴同士を交差または包含させることはできません。");
      }
    }
  }
};

const validateLineCoordinates = (coordinates: readonly (readonly number[])[], minimum: number, rejectClosed: boolean): void => {
  if (coordinates.length < minimum || coordinates.length > MAX_GEOMETRY_COORDINATES || coordinates.some((position) => !validPosition(position))) {
    throw new Error("地物の線が不正です。");
  }
  for (let index = 1; index < coordinates.length; index += 1) {
    if (coordinates[index - 1]![0] === coordinates[index]![0] && coordinates[index - 1]![1] === coordinates[index]![1]
      && !(index === coordinates.length - 1 && !rejectClosed)) throw new Error("地物の線に隣接する重複座標があります。");
  }
  if (rejectClosed && coordinates[0]![0] === coordinates.at(-1)![0] && coordinates[0]![1] === coordinates.at(-1)![1]) {
    throw new Error("地物の線の終点は始点と異なる必要があります。");
  }
};

const validatePolygonRing = (ring: readonly (readonly number[])[]): void => {
  validateLineCoordinates(ring, 4, false);
  const first = ring[0]!; const last = ring.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("地物の領域のリングは閉じている必要があります。");
  const segmentCount = ring.length - 1;
  for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segmentCount; secondIndex += 1) {
      if (secondIndex === firstIndex + 1 || (firstIndex === 0 && secondIndex === segmentCount - 1)) continue;
      if (segmentsIntersect(ring[firstIndex]!, ring[firstIndex + 1]!, ring[secondIndex]!, ring[secondIndex + 1]!)) {
        throw new Error("地物の領域のリングが自己交差しています。");
      }
    }
  }
  let area = 0;
  for (let index = 0; index < segmentCount; index += 1) area += ring[index]![0]! * ring[index + 1]![1]! - ring[index + 1]![0]! * ring[index]![1]!;
  if (Math.abs(area / 2) < MIN_POLYGON_AREA) throw new Error("地物の領域の面積が小さすぎます。");
};

const validateGeometry = (input: CreateFeatureInput): void => {
  const expected = input.featureType === "city" || input.featureType === "town" || input.featureType === "mountain" || input.featureType === "tree" || input.featureType === "symbol" || input.featureType === "label" || input.featureType === "scale" ? "Point"
    : input.featureType === "river" || input.featureType === "coastline" || input.featureType === "boundary" || input.featureType === "road" ? "LineString" : "Polygon";
  if (input.geometry.type !== expected) throw new Error("地物の形状が種類と一致しません。");
  if (new TextEncoder().encode(JSON.stringify(input.geometry)).length > MAX_GEOMETRY_BYTES) throw new Error("地物の形状が大きすぎます。");
  if (input.geometry.type === "Point") {
    if (!validPosition(input.geometry.coordinates)) throw new Error("地物の座標が不正です。");
    return;
  }
  if (input.geometry.type === "LineString") {
    validateLineCoordinates(input.geometry.coordinates, 2, true);
    return;
  }
  if (input.geometry.coordinates.length === 0 || geometryPositions(input.geometry) > MAX_GEOMETRY_COORDINATES) throw new Error("地物の領域が不正です。");
  input.geometry.coordinates.forEach(validatePolygonRing);
  validatePolygonRelationships(input.geometry.coordinates);
};

export class MemoryRealmBackend implements RealmBackend {
  private readonly projects = new Map<string, MemoryProject>();
  private readonly undo = new Map<string, MemoryProject[]>();
  private readonly redo = new Map<string, MemoryProject[]>();
  private openPath: string | null = null;

  constructor(initialProjects: RealmSnapshot[] = []) {
    for (const snapshot of initialProjects) {
      const normalized = clone({ ...snapshot, mapShapes: snapshot.mapShapes ?? [], formatVersion: 11 });
      this.projects.set(snapshot.path, { snapshot: normalized, assetBytes: {} });
    }
  }

  private current(): MemoryProject {
    if (!this.openPath) throw new Error("世界が開かれていません。");
    const project = this.projects.get(this.openPath);
    if (!project) throw new Error("世界が見つかりません。");
    return project;
  }

  private result(project: MemoryProject): RealmSnapshot {
    const snapshot = clone(project.snapshot);
    snapshot.mapShapes ??= [];
    snapshot.featureCount = snapshot.features.length;
    snapshot.canUndo = (this.undo.get(snapshot.path)?.length ?? 0) > 0;
    snapshot.canRedo = (this.redo.get(snapshot.path)?.length ?? 0) > 0;
    return snapshot;
  }

  private checkpoint(project: MemoryProject): void {
    const stack = this.undo.get(project.snapshot.path) ?? [];
    stack.push(clone(project)); this.undo.set(project.snapshot.path, stack); this.redo.set(project.snapshot.path, []);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects.values()].map(({ snapshot }) => ({ libraryId: snapshot.path, name: snapshot.world.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async createProject(input: { name: string; path?: string }): Promise<RealmSnapshot> {
    const path = input.path ?? `browser://${crypto.randomUUID()}.realmmap`;
    if (this.projects.has(path)) throw new Error("同じ場所に世界がすでにあります。");
    const project = { snapshot: makeSnapshot(path, input.name), assetBytes: {} };
    this.projects.set(path, project); this.openPath = path; return this.result(project);
  }
  async openProject(input: { libraryId: string }): Promise<RealmSnapshot> {
    const project = this.projects.get(input.libraryId);
    if (!project) throw new Error("指定した世界が見つかりません。");
    this.openPath = input.libraryId; this.undo.set(input.libraryId, []); this.redo.set(input.libraryId, []); return this.result(project);
  }
  async importProject(input: { path: string }): Promise<RealmSnapshot> {
    const source = this.projects.get(input.path); if (!source) throw new Error("移行データを読み込めません。");
    const path = `browser://${crypto.randomUUID()}.realmmap`; const project = clone(source); project.snapshot.path = path;
    this.projects.set(path, project); this.openPath = path; return this.result(project);
  }
  async exportProject(_input: { path: string }): Promise<void> {}
  async writeArtifact(_input: { path: string; bytes: number[] }): Promise<void> {}
  async saveProject(input: SaveProjectInput): Promise<RealmSnapshot> {
    const project = this.current(); const name = normalizeName(input.name);
    if (project.snapshot.world.name !== name) { this.checkpoint(project); project.snapshot.world.name = name; }
    return this.result(project);
  }
  async updateProjectSettings(input: { settings: RealmSnapshot["settings"] }): Promise<RealmSnapshot> {
    const keys = Object.keys(input.settings);
    if (keys.length !== 11 || keys.some((key) => !["themeId", "showGrid", "exportScale", "exportExtent", "canvasWidth", "canvasHeight", "gridKind", "gridColor", "gridWidth", "gridSpacing", "themeOverrides"].includes(key))) throw new Error("プロジェクト設定が不正です。");
    if (!input.settings.themeId || !["ink", "atlas", "midnight"].includes(input.settings.themeId)) throw new Error("描画テーマが不正です。");
    if (typeof input.settings.showGrid !== "boolean") throw new Error("グリッド表示設定が不正です。");
    if (!input.settings.exportScale || ![1, 2, 4].includes(input.settings.exportScale)) throw new Error("書き出し倍率が不正です。");
    if (!input.settings.exportExtent || !["viewport", "world"].includes(input.settings.exportExtent)) throw new Error("書き出し範囲が不正です。");
    if (!Number.isInteger(input.settings.canvasWidth) || input.settings.canvasWidth < 512 || input.settings.canvasWidth > 8192) throw new Error("キャンバス幅が不正です。");
    if (!Number.isInteger(input.settings.canvasHeight) || input.settings.canvasHeight < 512 || input.settings.canvasHeight > 8192) throw new Error("キャンバス高さが不正です。");
    if (!["graticule", "square", "hex"].includes(input.settings.gridKind)) throw new Error("グリッド種類が不正です。");
    if (!/^#[\da-f]{6}$/iu.test(input.settings.gridColor)) throw new Error("グリッド色が不正です。");
    if (!Number.isFinite(input.settings.gridWidth) || input.settings.gridWidth < 0.25 || input.settings.gridWidth > 4) throw new Error("グリッド線幅が不正です。");
    if (!Number.isFinite(input.settings.gridSpacing) || input.settings.gridSpacing < 2 || input.settings.gridSpacing > 45) throw new Error("グリッド間隔が不正です。");
    const themeOverrides = input.settings.themeOverrides;
    const themeKeys = new Set(["canvas", "land", "landInk", "coastGlow", "river", "forest", "country", "region", "boundary", "settlement", "label", "labelHalo", "grid"]);
    if (typeof themeOverrides !== "object" || themeOverrides === null || Array.isArray(themeOverrides) || Object.keys(themeOverrides).some((key) => !themeKeys.has(key) || !/^#[\da-f]{6}$/iu.test(themeOverrides[key as keyof typeof themeOverrides] ?? ""))) throw new Error("テーマ上書き設定が不正です。");
    const project = this.current();
    if (JSON.stringify(project.snapshot.settings) !== JSON.stringify(input.settings)) { this.checkpoint(project); project.snapshot.settings = clone(input.settings); }
    return this.result(project);
  }
  async createFeature(input: CreateFeatureInput): Promise<RealmSnapshot> {
    const project = this.current(); const name = normalizeName(input.name); validateGeometry(input); const properties = validateProperties(input.properties ?? {}); this.checkpoint(project);
    const feature: RealmFeature = { id: crypto.randomUUID(), featureType: input.featureType, name, geometry: clone(input.geometry), properties: clone(properties) };
    project.snapshot.features.push(feature); return this.result(project);
  }
  async createFeaturesBatch(input: { features: CreateFeatureInput[] }): Promise<RealmSnapshot> {
    if (input.features.length === 0 || input.features.length > 2048) throw new Error("一度に作成できる地物数が不正です。");
    const prepared = input.features.map((feature) => {
      const name = normalizeName(feature.name);
      validateGeometry(feature);
      const properties = validateProperties(feature.properties ?? {});
      return { id: crypto.randomUUID(), featureType: feature.featureType, name, geometry: clone(feature.geometry), properties: clone(properties) } satisfies RealmFeature;
    });
    const project = this.current();
    this.checkpoint(project);
    project.snapshot.features.push(...prepared);
    return this.result(project);
  }
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> {
    const prepared = await prepareAsset(input);
    const project = this.current();
    if (project.snapshot.assets.some((asset) => asset.sha256 === prepared.digest)) return this.result(project);
    this.checkpoint(project);
    const id = crypto.randomUUID();
    project.snapshot.assets.push({ id, sha256: prepared.digest, mime: prepared.mime, byteLength: prepared.bytes.length, width: prepared.width, height: prepared.height, metadata: prepared.metadata });
    project.assetBytes[id] = prepared.bytes;
    return this.result(project);
  }
  async importAssetsBatch(input: { packName: string; assets: ImportAssetInput[] }): Promise<RealmSnapshot> {
    const packName = input.packName.trim();
    if (!packName || [...packName].length > 128) throw new Error("素材パック名は128文字以内で入力してください。");
    if (input.assets.length === 0 || input.assets.length > 256) throw new Error("素材パックの件数が不正です。");
    if (input.assets.reduce((total, asset) => total + asset.bytes.length, 0) > 64 * 1024 * 1024) throw new Error("素材パックが大きすぎます。");
    const prepared = await Promise.all(input.assets.map(prepareAsset));
    const reserved = new Set(["packId", "packName", "packOrdinal"]);
    if (prepared.some((asset) => Object.keys(asset.metadata).some((key) => reserved.has(key)))) throw new Error("素材メタデータに予約済みのパック項目があります。");
    const project = this.current();
    const known = new Set(project.snapshot.assets.map((asset) => asset.sha256));
    const packId = crypto.randomUUID();
    const additions = prepared.flatMap((asset, ordinal) => {
      if (known.has(asset.digest)) return [];
      known.add(asset.digest);
      const id = crypto.randomUUID();
      return [{ id, asset, metadata: { ...asset.metadata, packId, packName, packOrdinal: ordinal } }];
    });
    if (additions.length === 0) return this.result(project);
    this.checkpoint(project);
    for (const { id, asset, metadata } of additions) {
      project.snapshot.assets.push({ id, sha256: asset.digest, mime: asset.mime, byteLength: asset.bytes.length, width: asset.width, height: asset.height, metadata });
      project.assetBytes[id] = asset.bytes;
    }
    return this.result(project);
  }
  async readAsset(input: { id: string }): Promise<AssetRead> {
    const project = this.current();
    const manifest = project.snapshot.assets.find((asset) => asset.id === input.id);
    const bytes = project.assetBytes[input.id];
    if (!manifest || !bytes) throw new Error("素材が見つかりません。");
    return { manifest: clone(manifest), bytes: [...bytes] };
  }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> {
    const project = this.current();
    const index = project.snapshot.assets.findIndex((asset) => asset.id === input.id);
    if (index < 0) throw new Error("素材が見つかりません。");
    if (project.snapshot.features.some((feature) => valueContainsAsset(feature.properties, input.id))) throw new Error("使用中の素材は削除できません。");
    this.checkpoint(project);
    project.snapshot.assets.splice(index, 1);
    delete project.assetBytes[input.id];
    return this.result(project);
  }
  async deleteAssetsBatch(input: { ids: string[] }): Promise<RealmSnapshot> {
    if (input.ids.length === 0 || input.ids.length > 256) throw new Error("一度に削除できる素材数が不正です。");
    const ids = new Set(input.ids);
    if (ids.size !== input.ids.length) throw new Error("素材の指定が重複しています。");
    const project = this.current();
    if (input.ids.some((id) => !project.snapshot.assets.some((asset) => asset.id === id))) throw new Error("素材が見つかりません。");
    if (project.snapshot.features.some((feature) => input.ids.some((id) => valueContainsAsset(feature.properties, id)))) throw new Error("使用中の素材は削除できません。");
    this.checkpoint(project);
    project.snapshot.assets = project.snapshot.assets.filter((asset) => !ids.has(asset.id));
    for (const id of input.ids) delete project.assetBytes[id];
    return this.result(project);
  }
  async reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot> {
    const project = this.current(); const feature = project.snapshot.features.find((item) => item.id === input.id);
    if (!feature) throw new Error("地物が見つかりません。"); if (featureIsLocked(feature)) throw new Error("ロック中の地物は変更できません。"); const name = normalizeName(input.name);
    validateGeometry({ featureType: feature.featureType, name, geometry: input.geometry }); this.checkpoint(project);
    feature.name = name; feature.geometry = clone(input.geometry); feature.properties = clone(validateProperties(input.properties ?? {})); return this.result(project);
  }
  async reviseFeaturesBatch(input: ReviseFeaturesBatchInput): Promise<RealmSnapshot> {
    if (input.features.length === 0 || input.features.length > 2048) throw new Error("一度に変更できる地物数が不正です。");
    if (new Set(input.features.map(({ id }) => id)).size !== input.features.length) throw new Error("地物の指定が重複しています。");
    const project = this.current();
    const prepared = input.features.map((revision) => {
      const feature = project.snapshot.features.find((item) => item.id === revision.id);
      if (!feature) throw new Error("地物が見つかりません。");
      if (featureIsLocked(feature)) throw new Error("ロック中の地物は変更できません。");
      const name = normalizeName(revision.name);
      validateGeometry({ featureType: feature.featureType, name, geometry: revision.geometry });
      return { feature, name, geometry: clone(revision.geometry), properties: clone(validateProperties(revision.properties ?? {})) };
    });
    this.checkpoint(project);
    for (const revision of prepared) Object.assign(revision.feature, { name: revision.name, geometry: revision.geometry, properties: revision.properties });
    return this.result(project);
  }
  async deleteFeature(input: { id: string }): Promise<RealmSnapshot> {
    const project = this.current(); const index = project.snapshot.features.findIndex((item) => item.id === input.id);
    if (index < 0) throw new Error("地物が見つかりません。"); if (featureIsLocked(project.snapshot.features[index]!)) throw new Error("ロック中の地物は削除できません。"); this.checkpoint(project); project.snapshot.features.splice(index, 1); return this.result(project);
  }
  async deleteFeaturesBatch(input: { ids: string[] }): Promise<RealmSnapshot> {
    if (input.ids.length === 0 || input.ids.length > 2048) throw new Error("一度に削除できる地物数が不正です。");
    const ids = new Set(input.ids);
    if (ids.size !== input.ids.length) throw new Error("地物の指定が重複しています。");
    const project = this.current();
    const selected = input.ids.map((id) => project.snapshot.features.find((feature) => feature.id === id));
    if (selected.some((feature) => !feature)) throw new Error("地物が見つかりません。");
    if (selected.some((feature) => featureIsLocked(feature!))) throw new Error("ロック中の地物は削除できません。");
    this.checkpoint(project);
    project.snapshot.features = project.snapshot.features.filter((feature) => !ids.has(feature.id));
    return this.result(project);
  }
  async setFeaturesLocked(input: { ids: string[]; locked: boolean }): Promise<RealmSnapshot> {
    if (input.ids.length === 0 || input.ids.length > 2048) throw new Error("一度に変更できる地物数が不正です。");
    const ids = new Set(input.ids);
    if (ids.size !== input.ids.length) throw new Error("地物の指定が重複しています。");
    const project = this.current();
    const selected = input.ids.map((id) => project.snapshot.features.find((feature) => feature.id === id));
    if (selected.some((feature) => !feature)) throw new Error("地物が見つかりません。");
    const changes = selected.filter((feature) => featureIsLocked(feature!) !== input.locked);
    if (changes.length === 0) return this.result(project);
    this.checkpoint(project);
    for (const feature of changes) feature!.properties = { ...feature!.properties, locked: input.locked };
    return this.result(project);
  }
  async undoProject(): Promise<RealmSnapshot> {
    const project = this.current(); const stack = this.undo.get(project.snapshot.path) ?? []; const previous = stack.pop();
    if (!previous) throw new Error("元に戻す操作がありません。"); const redo = this.redo.get(project.snapshot.path) ?? [];
    redo.push(clone(project)); this.redo.set(project.snapshot.path, redo); this.projects.set(project.snapshot.path, previous); return this.result(previous);
  }
  async redoProject(): Promise<RealmSnapshot> {
    const project = this.current(); const stack = this.redo.get(project.snapshot.path) ?? []; const next = stack.pop();
    if (!next) throw new Error("やり直す操作がありません。"); const undo = this.undo.get(project.snapshot.path) ?? [];
    undo.push(clone(project)); this.undo.set(project.snapshot.path, undo); this.projects.set(project.snapshot.path, next); return this.result(next);
  }
  async createMapShapes(input: CreateMapShapesInput): Promise<RealmSnapshot> {
    const project = this.current();
    if (!input || !Array.isArray(input.shapes)) throw new Error("形状の指定が不正です。");
    const ids = new Set(project.snapshot.mapShapes.map((shape) => shape.id));
    if (input.shapes.some((shape) => ids.has(shape.id))) throw new Error("形状IDが重複しています。");
    return this.updateMapShapes({ shapes: [...project.snapshot.mapShapes, ...input.shapes] });
  }
  async updateMapShapes(input: UpdateMapShapesInput): Promise<RealmSnapshot> {
    if (!input || !Array.isArray(input.shapes)) throw new Error("形状の指定が不正です。");
    try { validateMapShapes(input.shapes); } catch { throw new Error("形状の形または重なりが不正です。"); }
    const project = this.current();
    this.checkpoint(project);
    project.snapshot.mapShapes = clone(input.shapes);
    return this.result(project);
  }
  async deleteMapShapes(input: DeleteMapShapesInput): Promise<RealmSnapshot> {
    if (!input || !Array.isArray(input.ids) || input.ids.length === 0) throw new Error("形状IDの指定が不正です。");
    const project = this.current();
    const ids = new Set(input.ids);
    if (ids.size !== input.ids.length || input.ids.some((id) => !project.snapshot.mapShapes.some((shape) => shape.id === id))) throw new Error("形状が見つかりません。");
    return this.updateMapShapes({ shapes: project.snapshot.mapShapes.filter((shape) => !ids.has(shape.id)) });
  }
  async closeProject(): Promise<void> { this.openPath = null; }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.openPath ? this.result(this.current()) : null; }
}
