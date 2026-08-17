import type {
  AssetRead, DeleteAssetsBatchInput, ImportAssetInput, ImportAssetsBatchInput, LayerTree, ProjectSummary, RealmBackend, RealmLayers, RealmSnapshot, SaveProjectInput,
} from "./types";
import { validateMapShapes } from "../shared/mapShapeGeometry";
import { mapShapesFromLayers } from "../shared/layerProjection";
import { validateName, validateObjectGeometry, validateProperties } from "../main/domain/geometry";
import { firstEditableLeaf, validateLayerTree } from "../shared/layerTree";

type MemoryProject = { snapshot: RealmSnapshot; assetBytes: Record<string, number[]> };
const clone = <T>(value: T): T => structuredClone(value);
const normalizeName = (name: string): string => { const value = name.trim(); if (!value) throw new Error("世界の名前を入力してください。"); if ([...value].length > 200) throw new Error("世界の名前は200文字以内にしてください。"); return value; };
const emptySettings: RealmSnapshot["settings"] = { themeId: "ink", showGrid: true, exportScale: 1, exportExtent: "world", canvasWidth: 2048, canvasHeight: 1024, gridKind: "graticule", gridColor: "#687784", gridWidth: 1, gridSpacing: 10, themeOverrides: {} };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const emptyLayers = (): RealmLayers => ({ terrain: [], regions: [], objects: [] });
const defaultLayerTree = (): LayerTree => ({ nodes: [{ id: crypto.randomUUID(), parentId: null, kind: "leaf", name: "レイヤー 1", order: 0, visible: true, locked: false }] });
const makeSnapshot = (path: string, name: string): RealmSnapshot => ({ formatVersion: 13, path, world: { id: crypto.randomUUID(), name: normalizeName(name) }, layerTree: defaultLayerTree(), layers: emptyLayers(), assets: [], settings: clone(emptySettings), canUndo: false, canRedo: false });
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};

function normalizeContent(layers: RealmLayers, tree: LayerTree): RealmLayers {
  const fallback = firstEditableLeaf(tree).id;
  return {
    terrain: layers.terrain.map((shape) => ({ ...shape, layerId: shape.layerId ?? fallback })),
    regions: layers.regions.map((region) => { const layerId = region.layerId ?? fallback; return { ...region, layerId, shapes: region.shapes.map((shape) => ({ ...shape, layerId })) }; }),
    objects: layers.objects.map((object) => ({ ...object, layerId: object.layerId ?? fallback })),
  };
}
function validateLayers(layers: RealmLayers, tree: LayerTree, assets: readonly { id: string }[] = []): void {
  const normalized = normalizeContent(layers, tree); const leaves = new Set(validateLayerTree(tree).nodes.filter((node) => node.kind === "leaf").map((node) => node.id));
  for (const shape of normalized.terrain) if (!shape.layerId || !leaves.has(shape.layerId)) throw new Error("地形の所属layerが不正です。");
  for (const region of normalized.regions) {
    if (!region.layerId || !leaves.has(region.layerId) || region.shapes.some((shape) => shape.layerId !== region.layerId) || !UUID_PATTERN.test(region.id) || !/^#[\da-f]{6}$/iu.test(region.color)) throw new Error("領域の識別子、所属layer、または色が不正です。");
    validateName(region.name);
  }
  try { validateMapShapes(mapShapesFromLayers(normalized)); } catch { throw new Error("地形または領域の形状が不正です。同じレイヤー内の重なりも許可されません。"); }
  for (const object of normalized.objects) {
    if (!object.layerId || !leaves.has(object.layerId) || !UUID_PATTERN.test(object.id) || !["city", "text", "mountain", "forest"].includes(object.kind) || !Number.isSafeInteger(object.zIndex) || object.zIndex < -1000000 || object.zIndex > 1000000 || typeof object.locked !== "boolean") throw new Error("オブジェクトの識別子、所属layer、種別、順序、またはロック状態が不正です。");
    try { validateName(object.label); validateObjectGeometry(object.kind, object.geometry); validateProperties(object.properties); } catch { throw new Error("オブジェクトの形状またはプロパティが不正です。"); }
    if (object.assetId !== undefined && (!UUID_PATTERN.test(object.assetId) || !assets.some((asset) => asset.id === object.assetId))) throw new Error("オブジェクトの素材参照が不正です。");
  }
}

const assetBytesMatchMime = (mime: string, bytes: readonly number[]): boolean => mime === "image/png"
  ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  : mime === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/webp" && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
async function prepareAsset(input: ImportAssetInput): Promise<{ mime: string; bytes: number[]; width: number; height: number; metadata: Record<string, unknown>; digest: string }> {
  const mime = input.mime.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !Array.isArray(input.bytes) || input.bytes.length === 0 || input.bytes.length > 8 * 1024 * 1024 || input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) || !assetBytesMatchMime(mime, input.bytes)) throw new Error("素材の形式または内容が不正です。");
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width < 1 || input.width > 32768 || input.height < 1 || input.height > 32768) throw new Error("素材の画像寸法が不正です。");
  const metadata = validateProperties(input.metadata ?? {});
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(input.bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (input.sha256 && input.sha256.toLowerCase() !== digest) throw new Error("素材のハッシュが一致しません。");
  return { mime, bytes: [...input.bytes], width: input.width, height: input.height, metadata: clone(metadata), digest };
}

export class MemoryRealmBackend implements RealmBackend {
  private readonly projects = new Map<string, MemoryProject>(); private readonly undo = new Map<string, MemoryProject[]>(); private readonly redo = new Map<string, MemoryProject[]>(); private openPath: string | null = null;
  constructor(initialProjects: RealmSnapshot[] = []) { for (const incoming of initialProjects) { const snapshot = clone(incoming); snapshot.layerTree ??= defaultLayerTree(); snapshot.layers ??= emptyLayers(); snapshot.formatVersion = 13; snapshot.layers = normalizeContent(snapshot.layers, snapshot.layerTree); this.projects.set(snapshot.path, { snapshot, assetBytes: {} }); } }
  private current(): MemoryProject { if (!this.openPath) throw new Error("世界が開かれていません。"); const project = this.projects.get(this.openPath); if (!project) throw new Error("世界が見つかりません。"); return project; }
  private result(project: MemoryProject): RealmSnapshot { const snapshot = clone(project.snapshot); snapshot.canUndo = (this.undo.get(snapshot.path)?.length ?? 0) > 0; snapshot.canRedo = (this.redo.get(snapshot.path)?.length ?? 0) > 0; return snapshot; }
  private checkpoint(project: MemoryProject): void { const stack = this.undo.get(project.snapshot.path) ?? []; stack.push(clone(project)); this.undo.set(project.snapshot.path, stack); this.redo.set(project.snapshot.path, []); }
  private replaceLayers(layers: RealmLayers): RealmSnapshot { const project = this.current(); const tree = project.snapshot.layerTree ?? defaultLayerTree(); const normalized = normalizeContent(layers, tree); validateLayers(normalized, tree, project.snapshot.assets); this.checkpoint(project); project.snapshot.layerTree = tree; project.snapshot.layers = clone(normalized); return this.result(project); }
  async listProjects(): Promise<ProjectSummary[]> { return [...this.projects.values()].map(({ snapshot }) => ({ libraryId: snapshot.path, name: snapshot.world.name })).sort((a, b) => a.name.localeCompare(b.name)); }
  async createProject(input: { name: string; path?: string }): Promise<RealmSnapshot> { const path = input.path ?? `browser://${crypto.randomUUID()}.realmmap`; if (this.projects.has(path)) throw new Error("同じ場所に世界がすでにあります。"); const project = { snapshot: makeSnapshot(path, input.name), assetBytes: {} }; this.projects.set(path, project); this.openPath = path; return this.result(project); }
  async openProject(input: { libraryId: string }): Promise<RealmSnapshot> { const project = this.projects.get(input.libraryId); if (!project) throw new Error("指定した世界が見つかりません。"); this.openPath = input.libraryId; this.undo.set(input.libraryId, []); this.redo.set(input.libraryId, []); return this.result(project); }
  async importProject(input: { path: string }): Promise<RealmSnapshot> { const source = this.projects.get(input.path); if (!source) throw new Error("プロジェクトを読み込めません。"); const path = `browser://${crypto.randomUUID()}.realmmap`; const project = clone(source); project.snapshot.path = path; this.projects.set(path, project); this.openPath = path; return this.result(project); }
  async exportProject(_input: { path: string }): Promise<void> {}
  async writeArtifact(_input: { path: string; bytes: number[] }): Promise<void> {}
  async saveProject(input: SaveProjectInput): Promise<RealmSnapshot> { const project = this.current(); const name = normalizeName(input.name); if (project.snapshot.world.name !== name) { this.checkpoint(project); project.snapshot.world.name = name; } return this.result(project); }
  async updateProjectSettings(input: { settings: RealmSnapshot["settings"] }): Promise<RealmSnapshot> { if (!input?.settings) throw new Error("プロジェクト設定が不正です。"); const project = this.current(); if (JSON.stringify(project.snapshot.settings) !== JSON.stringify(input.settings)) { this.checkpoint(project); project.snapshot.settings = clone(input.settings); } return this.result(project); }
  async replaceTerrainLayer(input: { shapes: RealmLayers["terrain"] }): Promise<RealmSnapshot> { return this.replaceLayers({ ...clone(this.current().snapshot.layers), terrain: clone(input.shapes) }); }
  async replaceRegionLayer(input: { regions: RealmLayers["regions"] }): Promise<RealmSnapshot> { return this.replaceLayers({ ...clone(this.current().snapshot.layers), regions: clone(input.regions) }); }
  async replaceObjectLayer(input: { objects: RealmLayers["objects"] }): Promise<RealmSnapshot> {
    const project = this.current();
    const tree = project.snapshot.layerTree ?? defaultLayerTree();
    const current = normalizeContent(project.snapshot.layers, tree).objects;
    const next = normalizeContent({ ...project.snapshot.layers, objects: input.objects }, tree).objects;
    const nextById = new Map(next.map((object) => [object.id, object]));
    for (const locked of current.filter((object) => object.locked)) {
      const replacement = nextById.get(locked.id);
      if (!replacement || stableJson(locked) !== stableJson(replacement)) throw new Error("ロックされたオブジェクトは変更または削除できません。");
    }
    return this.replaceLayers({ ...clone(project.snapshot.layers), objects: clone(next) });
  }
  async replaceLayerTree(input: { tree: LayerTree }): Promise<RealmSnapshot> { const project = this.current(); const tree = validateLayerTree(input.tree); const currentTree = project.snapshot.layerTree ?? defaultLayerTree(); const contentIds = new Set([...project.snapshot.layers.terrain.map((shape) => shape.layerId), ...project.snapshot.layers.regions.map((region) => region.layerId), ...project.snapshot.layers.objects.map((object) => object.layerId)]); if ([...contentIds].some((id) => !tree.nodes.some((node) => node.id === id && node.kind === "leaf"))) throw new Error("地物を含むlayerはgroupに変更または削除できません。"); validateLayers(project.snapshot.layers, tree, project.snapshot.assets); this.checkpoint(project); project.snapshot.layerTree = clone(tree); project.snapshot.layers = normalizeContent(project.snapshot.layers, tree); if (!project.snapshot.layerTree) project.snapshot.layerTree = currentTree; return this.result(project); }
  async replaceMapContent(input: { layers: RealmLayers }): Promise<RealmSnapshot> { return this.replaceLayers(input.layers); }
  async importAsset(input: ImportAssetInput): Promise<RealmSnapshot> { const prepared = await prepareAsset(input); const project = this.current(); if (project.snapshot.assets.some((asset) => asset.sha256 === prepared.digest)) return this.result(project); this.checkpoint(project); const id = crypto.randomUUID(); project.snapshot.assets.push({ id, sha256: prepared.digest, mime: prepared.mime, byteLength: prepared.bytes.length, width: prepared.width, height: prepared.height, metadata: prepared.metadata }); project.assetBytes[id] = prepared.bytes; return this.result(project); }
  async importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot> { if (!input || !Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 256) throw new Error("素材パックの件数が不正です。"); const prepared = await Promise.all(input.assets.map(prepareAsset)); const project = this.current(); const known = new Set(project.snapshot.assets.map((asset) => asset.sha256)); const additions = prepared.filter((asset) => !known.has(asset.digest)); if (!additions.length) return this.result(project); this.checkpoint(project); for (const asset of additions) { const id = crypto.randomUUID(); known.add(asset.digest); project.snapshot.assets.push({ id, sha256: asset.digest, mime: asset.mime, byteLength: asset.bytes.length, width: asset.width, height: asset.height, metadata: asset.metadata }); project.assetBytes[id] = asset.bytes; } return this.result(project); }
  async readAsset(input: { id: string }): Promise<AssetRead> { const project = this.current(); const manifest = project.snapshot.assets.find((asset) => asset.id === input.id); const bytes = project.assetBytes[input.id]; if (!manifest || !bytes) throw new Error("素材が見つかりません。"); return { manifest: clone(manifest), bytes: [...bytes] }; }
  async deleteAsset(input: { id: string }): Promise<RealmSnapshot> { return this.deleteAssetsBatch({ ids: [input.id] }); }
  async deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot> { const project = this.current(); const ids = new Set(input.ids); if (!input.ids.length || ids.size !== input.ids.length || input.ids.some((id) => !project.snapshot.assets.some((asset) => asset.id === id))) throw new Error("素材の指定が不正です。"); if (project.snapshot.layers.objects.some((object) => object.assetId && ids.has(object.assetId))) throw new Error("使用中の素材は削除できません。"); this.checkpoint(project); project.snapshot.assets = project.snapshot.assets.filter((asset) => !ids.has(asset.id)); for (const id of ids) delete project.assetBytes[id]; return this.result(project); }
  async undoProject(): Promise<RealmSnapshot> { const project = this.current(); const stack = this.undo.get(project.snapshot.path) ?? []; const previous = stack.pop(); if (!previous) throw new Error("元に戻す操作がありません。"); const redo = this.redo.get(project.snapshot.path) ?? []; redo.push(clone(project)); this.redo.set(project.snapshot.path, redo); this.projects.set(project.snapshot.path, previous); return this.result(previous); }
  async redoProject(): Promise<RealmSnapshot> { const project = this.current(); const stack = this.redo.get(project.snapshot.path) ?? []; const next = stack.pop(); if (!next) throw new Error("やり直す操作がありません。"); const undo = this.undo.get(project.snapshot.path) ?? []; undo.push(clone(project)); this.undo.set(project.snapshot.path, undo); this.projects.set(project.snapshot.path, next); return this.result(next); }
  async closeProject(): Promise<void> { this.openPath = null; }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.openPath ? this.result(this.current()) : null; }
}
