import type { RealmBackend, RealmSnapshot, SaveProjectInput } from "./types";

const makeSnapshot = (path: string, name: string, currentYear = 0): RealmSnapshot => ({
  formatVersion: 1,
  path,
  world: { id: crypto.randomUUID(), name, currentYear },
  eras: [],
  featureCount: 0,
});

/** A deterministic local backend for browser previews and UI tests. */
export class MemoryRealmBackend implements RealmBackend {
  private readonly projects = new Map<string, RealmSnapshot>();
  private openPath: string | null = null;

  constructor(initialProjects: RealmSnapshot[] = []) {
    for (const project of initialProjects) {
      this.projects.set(project.path, structuredClone(project));
    }
  }

  async createProject(input: { path: string; name: string }): Promise<RealmSnapshot> {
    if (this.projects.has(input.path)) throw new Error("同じ場所に世界がすでにあります。");
    const snapshot = makeSnapshot(input.path, input.name);
    this.projects.set(input.path, snapshot);
    this.openPath = input.path;
    return structuredClone(snapshot);
  }

  async openProject(input: { path: string }): Promise<RealmSnapshot> {
    const snapshot = this.projects.get(input.path);
    if (!snapshot) throw new Error("指定した世界が見つかりません。");
    this.openPath = input.path;
    return structuredClone(snapshot);
  }

  async saveProject(input: SaveProjectInput): Promise<RealmSnapshot> {
    if (!this.openPath) throw new Error("保存する世界が開かれていません。");
    const snapshot = this.projects.get(this.openPath);
    if (!snapshot) throw new Error("保存する世界が見つかりません。");
    snapshot.world.name = input.name.trim();
    snapshot.world.currentYear = input.currentYear;
    snapshot.eras = input.eras.map((era) => ({
      ...era,
      id: era.id ?? crypto.randomUUID(),
      name: era.name.trim(),
    }));
    return structuredClone(snapshot);
  }

  async closeProject(): Promise<void> {
    this.openPath = null;
  }

  async getOpenProject(): Promise<RealmSnapshot | null> {
    if (!this.openPath) return null;
    const snapshot = this.projects.get(this.openPath);
    return snapshot ? structuredClone(snapshot) : null;
  }
}
