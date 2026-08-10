import type {
  CreateFeatureInput,
  FeatureType,
  GeoJsonGeometry,
  RealmBackend,
  CellAttribute,
  CellAttributeSnapshot,
  CellViewportInput,
  RealmFeature,
  RealmSnapshot,
  ReviseFeatureInput,
  SaveProjectInput,
} from "./types";

type MemoryRevision = {
  year: number;
  sequence: number;
  name: string;
  geometry: GeoJsonGeometry | null;
  deleted: boolean;
};

type MemoryCellRevision = {
  cellId: string;
  attribute: CellAttribute;
  year: number;
  sequence: number;
  value: string | null;
  deleted: boolean;
};

type MemoryFeature = { id: string; featureType: FeatureType; revisions: MemoryRevision[] };
type MemoryProject = { snapshot: RealmSnapshot; features: Map<string, MemoryFeature>; cells: MemoryCellRevision[] };

const makeSnapshot = (path: string, name: string, currentYear = 0): RealmSnapshot => ({
  formatVersion: 2,
  path,
  world: { id: crypto.randomUUID(), name, currentYear },
  eras: [],
  features: [],
  timelineEvents: [],
  featureCount: 0,
  canUndo: false,
  canRedo: false,
});

const cloneProject = (project: MemoryProject): MemoryProject => ({
  snapshot: structuredClone(project.snapshot),
  features: new Map([...project.features].map(([id, feature]) => [id, structuredClone(feature)])),
  cells: structuredClone(project.cells),
});

const storedProject = (snapshot: RealmSnapshot): MemoryProject => ({
  snapshot: structuredClone(snapshot),
  features: new Map(snapshot.features.map((feature) => [feature.id, {
    id: feature.id,
    featureType: feature.featureType,
    revisions: [{
      year: feature.validFromYear,
      sequence: 0,
      name: feature.name,
      geometry: structuredClone(feature.geometry),
      deleted: false,
    }],
  }])),
  cells: [],
});

const snapshotAt = (project: MemoryProject, year: number): RealmSnapshot => {
  const features: RealmFeature[] = [];
  for (const feature of project.features.values()) {
    const revision = feature.revisions
      .filter((candidate) => candidate.year <= year)
      .sort((left, right) => right.year - left.year || right.sequence - left.sequence)[0];
    if (!revision || revision.deleted || !revision.geometry) continue;
    features.push({
      id: feature.id,
      featureType: feature.featureType,
      name: revision.name,
      geometry: structuredClone(revision.geometry),
      validFromYear: revision.year,
    });
  }
  features.sort((left, right) => left.featureType.localeCompare(right.featureType) || left.name.localeCompare(right.name));
  return {
    ...structuredClone(project.snapshot),
    world: { ...project.snapshot.world, currentYear: year },
    features,
    featureCount: features.length,
  };
};

/** A deterministic local backend for browser previews and UI tests. */
export class MemoryRealmBackend implements RealmBackend {
  private readonly projects = new Map<string, MemoryProject>();
  private readonly undo = new Map<string, MemoryProject[]>();
  private readonly redo = new Map<string, MemoryProject[]>();
  private openPath: string | null = null;

  constructor(initialProjects: RealmSnapshot[] = []) {
    for (const project of initialProjects) this.projects.set(project.path, storedProject(project));
  }

  private openProjectState(): MemoryProject {
    if (!this.openPath) throw new Error("世界が開かれていません。");
    const project = this.projects.get(this.openPath);
    if (!project) throw new Error("世界が見つかりません。");
    return project;
  }

  private checkpoint(project: MemoryProject): void {
    const path = project.snapshot.path;
    const undo = this.undo.get(path) ?? [];
    undo.push(cloneProject(project));
    this.undo.set(path, undo);
    this.redo.set(path, []);
  }

  private result(project: MemoryProject, year = project.snapshot.world.currentYear): RealmSnapshot {
    const snapshot = snapshotAt(project, year);
    snapshot.canUndo = (this.undo.get(project.snapshot.path)?.length ?? 0) > 0;
    snapshot.canRedo = (this.redo.get(project.snapshot.path)?.length ?? 0) > 0;
    return snapshot;
  }

  async createProject(input: { path: string; name: string }): Promise<RealmSnapshot> {
    if (this.projects.has(input.path)) throw new Error("同じ場所に世界がすでにあります。");
    const project = storedProject(makeSnapshot(input.path, input.name));
    this.projects.set(input.path, project);
    this.openPath = input.path;
    return this.result(project);
  }

  async openProject(input: { path: string }): Promise<RealmSnapshot> {
    const project = this.projects.get(input.path);
    if (!project) throw new Error("指定した世界が見つかりません。");
    this.openPath = input.path;
    this.undo.set(input.path, []);
    this.redo.set(input.path, []);
    return this.result(project);
  }

  async saveProject(input: SaveProjectInput): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    this.checkpoint(project);
    project.snapshot.world.name = input.name.trim();
    project.snapshot.world.currentYear = input.currentYear;
    project.snapshot.eras = input.eras.map((era) => ({
      ...era,
      id: era.id ?? crypto.randomUUID(),
      name: era.name.trim(),
    }));
    project.snapshot.timelineEvents = input.timelineEvents.map((event) => ({
      ...event,
      id: event.id ?? crypto.randomUUID(),
      title: event.title.trim(),
      description: event.description.trim(),
    })).sort((left, right) => left.startYear - right.startYear);
    return this.result(project);
  }

  async viewProjectYear(year: number): Promise<RealmSnapshot> {
    return this.result(this.openProjectState(), year);
  }

  async applyCellAttributes(input: {
    year: number;
    cellIds: string[];
    attribute: CellAttribute;
    value: string | null;
  }): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    const cellIds = [...new Set(input.cellIds)];
    if (cellIds.length === 0) throw new Error("セルを選択してください。");
    if (cellIds.some((cellId) => {
      const match = /^(\d+):(\d+)$/u.exec(cellId);
      if (!match) return true;
      const x = Number(match[1]);
      const y = Number(match[2]);
      return !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 512 || y < 0 || y >= 256;
    })) throw new Error("セルの指定が不正です。");
    if (input.value !== null && input.value.trim().length === 0) throw new Error("属性値を入力してください。");
    this.checkpoint(project);
    const sequence = Math.max(-1, ...project.cells.filter((cell) => cell.year === input.year).map((cell) => cell.sequence)) + 1;
    for (const cellId of cellIds) {
      project.cells.push({
        cellId,
        attribute: input.attribute,
        year: input.year,
        sequence,
        value: input.value?.trim() ?? null,
        deleted: input.value === null,
      });
    }
    project.snapshot.world.currentYear = input.year;
    return this.result(project, input.year);
  }

  async viewCellAttributes(input: CellViewportInput): Promise<CellAttributeSnapshot[]> {
    const project = this.openProjectState();
    const minX = Math.max(0, input.minX ?? 0);
    const maxX = Math.min(511, input.maxX ?? 511);
    const minY = Math.max(0, input.minY ?? 0);
    const maxY = Math.min(255, input.maxY ?? 255);
    const latest = new Map<string, MemoryCellRevision>();
    for (const revision of project.cells) {
      const [xText, yText] = revision.cellId.split(":");
      const x = Number(xText);
      const y = Number(yText);
      if (revision.year > input.year || x < minX || x > maxX || y < minY || y > maxY) continue;
      const key = `${revision.cellId}:${revision.attribute}`;
      const previous = latest.get(key);
      if (!previous || revision.year > previous.year || (revision.year === previous.year && revision.sequence > previous.sequence)) latest.set(key, revision);
    }
    return [...latest.values()]
      .filter((revision) => !revision.deleted && revision.value !== null)
      .sort((left, right) => left.cellId.localeCompare(right.cellId) || left.attribute.localeCompare(right.attribute))
      .map((revision) => ({ cellId: revision.cellId, attribute: revision.attribute, value: revision.value ?? "", validFromYear: revision.year }));
  }

  async createFeature(input: CreateFeatureInput): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    this.checkpoint(project);
    const id = crypto.randomUUID();
    project.features.set(id, {
      id,
      featureType: input.featureType,
      revisions: [{
        year: input.validFromYear,
        sequence: 0,
        name: input.name.trim(),
        geometry: structuredClone(input.geometry),
        deleted: false,
      }],
    });
    project.snapshot.world.currentYear = input.validFromYear;
    return this.result(project, input.validFromYear);
  }

  async reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    const feature = project.features.get(input.id);
    if (!feature) throw new Error("地物が見つかりません。");
    this.checkpoint(project);
    const sequence = feature.revisions.filter((revision) => revision.year === input.validFromYear).length;
    feature.revisions.push({
      year: input.validFromYear,
      sequence,
      name: input.name.trim(),
      geometry: structuredClone(input.geometry),
      deleted: false,
    });
    project.snapshot.world.currentYear = input.validFromYear;
    return this.result(project, input.validFromYear);
  }

  async deleteFeature(input: { id: string; validFromYear: number }): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    const feature = project.features.get(input.id);
    if (!feature) throw new Error("地物が見つかりません。");
    const visible = snapshotAt(project, input.validFromYear).features.find((candidate) => candidate.id === input.id);
    if (!visible) throw new Error("この年には地物がありません。");
    this.checkpoint(project);
    const sequence = feature.revisions.filter((revision) => revision.year === input.validFromYear).length;
    feature.revisions.push({
      year: input.validFromYear,
      sequence,
      name: visible.name,
      geometry: null,
      deleted: true,
    });
    project.snapshot.world.currentYear = input.validFromYear;
    return this.result(project, input.validFromYear);
  }

  async undoProject(): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    const stack = this.undo.get(project.snapshot.path) ?? [];
    const previous = stack.pop();
    if (!previous) throw new Error("元に戻す操作がありません。");
    const redo = this.redo.get(project.snapshot.path) ?? [];
    redo.push(cloneProject(project));
    this.redo.set(project.snapshot.path, redo);
    this.projects.set(project.snapshot.path, previous);
    return this.result(previous);
  }

  async redoProject(): Promise<RealmSnapshot> {
    const project = this.openProjectState();
    const stack = this.redo.get(project.snapshot.path) ?? [];
    const next = stack.pop();
    if (!next) throw new Error("やり直す操作がありません。");
    const undo = this.undo.get(project.snapshot.path) ?? [];
    undo.push(cloneProject(project));
    this.undo.set(project.snapshot.path, undo);
    this.projects.set(project.snapshot.path, next);
    return this.result(next);
  }

  async closeProject(): Promise<void> {
    this.openPath = null;
  }

  async getOpenProject(): Promise<RealmSnapshot | null> {
    if (!this.openPath) return null;
    const project = this.projects.get(this.openPath);
    return project ? this.result(project) : null;
  }
}
