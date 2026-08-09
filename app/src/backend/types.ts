export type Era = {
  id: string;
  name: string;
  startYear: number;
  endYear: number | null;
};

export type EraInput = Omit<Era, "id"> & { id: string | null };

export type World = {
  id: string;
  name: string;
  currentYear: number;
};

export type RealmSnapshot = {
  formatVersion: number;
  path: string;
  world: World;
  eras: Era[];
  featureCount: number;
};

export type SaveProjectInput = {
  name: string;
  currentYear: number;
  eras: EraInput[];
};

export interface RealmBackend {
  createProject(input: { path: string; name: string }): Promise<RealmSnapshot>;
  openProject(input: { path: string }): Promise<RealmSnapshot>;
  saveProject(input: SaveProjectInput): Promise<RealmSnapshot>;
  closeProject(): Promise<void>;
  getOpenProject(): Promise<RealmSnapshot | null>;
}
