import type {
  CellAttribute, CellAttributeSnapshot, CellViewportInput, CreateFeatureInput,
  ProjectSummary, RealmBackend, RealmFeature, RealmSnapshot,
  ReviseFeatureInput, SaveProjectInput,
} from "./types";

type MemoryProject = {
  snapshot: RealmSnapshot;
  cells: CellAttributeSnapshot[];
};

const makeSnapshot = (path: string, name: string): RealmSnapshot => ({
  formatVersion: 3, path, world: { id: crypto.randomUUID(), name }, features: [], featureCount: 0,
  canUndo: false, canRedo: false,
});

const clone = <T>(value: T): T => structuredClone(value);
const validCell = (id: string): boolean => {
  const match = /^(\d+):(\d+)$/u.exec(id);
  if (!match) return false;
  const x = Number(match[1]); const y = Number(match[2]);
  return x >= 0 && x < 512 && y >= 0 && y < 256;
};

export class MemoryRealmBackend implements RealmBackend {
  private readonly projects = new Map<string, MemoryProject>();
  private readonly undo = new Map<string, MemoryProject[]>();
  private readonly redo = new Map<string, MemoryProject[]>();
  private openPath: string | null = null;

  constructor(initialProjects: RealmSnapshot[] = []) {
    for (const snapshot of initialProjects) this.projects.set(snapshot.path, { snapshot: clone(snapshot), cells: [] });
  }

  private current(): MemoryProject {
    if (!this.openPath) throw new Error("世界が開かれていません。");
    const project = this.projects.get(this.openPath);
    if (!project) throw new Error("世界が見つかりません。");
    return project;
  }

  private result(project: MemoryProject): RealmSnapshot {
    const snapshot = clone(project.snapshot);
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
    const project = { snapshot: makeSnapshot(path, input.name), cells: [] };
    this.projects.set(path, project); this.openPath = path; return this.result(project);
  }
  async openProject(input: { libraryId?: string; path?: string }): Promise<RealmSnapshot> {
    const path = input.libraryId ?? input.path ?? ""; const project = this.projects.get(path);
    if (!project) throw new Error("指定した世界が見つかりません。");
    this.openPath = path; this.undo.set(path, []); this.redo.set(path, []); return this.result(project);
  }
  async importProject(input: { path: string }): Promise<RealmSnapshot> {
    const source = this.projects.get(input.path); if (!source) throw new Error("移行データを読み込めません。");
    const path = `browser://${crypto.randomUUID()}.realmmap`; const project = clone(source); project.snapshot.path = path;
    this.projects.set(path, project); this.openPath = path; return this.result(project);
  }
  async exportProject(_input: { path: string }): Promise<void> {}
  async writeArtifact(_input: { path: string; bytes: number[] }): Promise<void> {}
  async saveProject(input: SaveProjectInput): Promise<RealmSnapshot> {
    const project = this.current(); this.checkpoint(project); project.snapshot.world.name = input.name.trim(); return this.result(project);
  }
  async createFeature(input: CreateFeatureInput): Promise<RealmSnapshot> {
    const project = this.current(); this.checkpoint(project);
    const feature: RealmFeature = { id: crypto.randomUUID(), featureType: input.featureType, name: input.name.trim(), geometry: clone(input.geometry) };
    project.snapshot.features.push(feature); return this.result(project);
  }
  async reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot> {
    const project = this.current(); const feature = project.snapshot.features.find((item) => item.id === input.id);
    if (!feature) throw new Error("地物が見つかりません。"); this.checkpoint(project);
    feature.name = input.name.trim(); feature.geometry = clone(input.geometry); return this.result(project);
  }
  async deleteFeature(input: { id: string }): Promise<RealmSnapshot> {
    const project = this.current(); const index = project.snapshot.features.findIndex((item) => item.id === input.id);
    if (index < 0) throw new Error("地物が見つかりません。"); this.checkpoint(project); project.snapshot.features.splice(index, 1); return this.result(project);
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
  async applyCellAttributes(input: { cellIds: string[]; attribute: CellAttribute; value: string | null }): Promise<RealmSnapshot> {
    const project = this.current(); const ids = [...new Set(input.cellIds)];
    if (!ids.length) throw new Error("セルを選択してください。"); if (ids.some((id) => !validCell(id))) throw new Error("セルの指定が不正です。");
    if (input.value !== null && !input.value.trim()) throw new Error("属性値を入力してください。"); this.checkpoint(project);
    project.cells = project.cells.filter((cell) => !(ids.includes(cell.cellId) && cell.attribute === input.attribute));
    if (input.value !== null) for (const cellId of ids) project.cells.push({ cellId, attribute: input.attribute, value: input.value.trim() });
    return this.result(project);
  }
  async viewCellAttributes(input: CellViewportInput): Promise<CellAttributeSnapshot[]> {
    const project = this.current(); const minX = Math.max(0, input.minX ?? 0); const maxX = Math.min(511, input.maxX ?? 511);
    const minY = Math.max(0, input.minY ?? 0); const maxY = Math.min(255, input.maxY ?? 255);
    return project.cells.filter((cell) => { const [x = -1, y = -1] = cell.cellId.split(":").map(Number); return x >= minX && x <= maxX && y >= minY && y <= maxY; }).map(clone);
  }
  async closeProject(): Promise<void> { this.openPath = null; }
  async getOpenProject(): Promise<RealmSnapshot | null> { return this.openPath ? this.result(this.current()) : null; }
}
