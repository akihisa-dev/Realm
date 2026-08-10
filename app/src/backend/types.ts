export type FeatureType = "terrain" | "forest" | "river" | "coastline" | "country" | "region" | "boundary" | "city" | "town";
export type CellAttribute = "forest" | "country" | "region";

export type Position = [number, number];
export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export type RealmFeature = {
  id: string;
  featureType: FeatureType;
  name: string;
  geometry: GeoJsonGeometry;
};

export type World = {
  id: string;
  name: string;
};

export type RealmSnapshot = {
  formatVersion: number;
  path: string;
  world: World;
  features: RealmFeature[];
  featureCount: number;
  canUndo: boolean;
  canRedo: boolean;
};

export type ProjectSummary = {
  libraryId: string;
  name: string;
};

export type CellAttributeSnapshot = {
  cellId: string;
  attribute: CellAttribute;
  value: string;
};

export type ApplyCellAttributesInput = {
  cellIds: string[];
  attribute: CellAttribute;
  value: string | null;
};

export type CellViewportInput = {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
};

export type SaveProjectInput = {
  name: string;
};

export type CreateFeatureInput = {
  featureType: FeatureType;
  name: string;
  geometry: GeoJsonGeometry;
};

export type ReviseFeatureInput = Omit<CreateFeatureInput, "featureType"> & { id: string };

export interface RealmBackend {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: { name: string; path?: string }): Promise<RealmSnapshot>;
  openProject(input: { libraryId?: string; path?: string }): Promise<RealmSnapshot>;
  importProject(input: { path: string }): Promise<RealmSnapshot>;
  exportProject(input: { path: string }): Promise<void>;
  writeArtifact(input: { path: string; bytes: number[] }): Promise<void>;
  saveProject(input: SaveProjectInput): Promise<RealmSnapshot>;
  createFeature(input: CreateFeatureInput): Promise<RealmSnapshot>;
  reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot>;
  deleteFeature(input: { id: string }): Promise<RealmSnapshot>;
  undoProject(): Promise<RealmSnapshot>;
  redoProject(): Promise<RealmSnapshot>;
  applyCellAttributes(input: ApplyCellAttributesInput): Promise<RealmSnapshot>;
  viewCellAttributes(input: CellViewportInput): Promise<CellAttributeSnapshot[]>;
  closeProject(): Promise<void>;
  getOpenProject(): Promise<RealmSnapshot | null>;
}
