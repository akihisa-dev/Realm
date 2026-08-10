export type Era = {
  id: string;
  name: string;
  startYear: number;
  endYear: number | null;
};

export type EraInput = Omit<Era, "id"> & { id: string | null };

export type FeatureType = "terrain" | "forest" | "river" | "coastline" | "country" | "region" | "boundary" | "city" | "town";
export type CellAttribute = "terrain_kind" | "forest" | "country" | "region";

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
  validFromYear: number;
};

export type TimelineEvent = {
  id: string;
  title: string;
  description: string;
  startYear: number;
  endYear: number | null;
};

export type TimelineEventInput = Omit<TimelineEvent, "id"> & { id: string | null };

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
  features: RealmFeature[];
  timelineEvents: TimelineEvent[];
  featureCount: number;
  canUndo: boolean;
  canRedo: boolean;
};

export type ProjectSummary = {
  libraryId: string;
  name: string;
  currentYear: number;
};

export type CellAttributeSnapshot = {
  cellId: string;
  attribute: CellAttribute;
  value: string;
  validFromYear: number;
};

export type ApplyCellAttributesInput = {
  year: number;
  cellIds: string[];
  attribute: CellAttribute;
  value: string | null;
};

export type CellViewportInput = {
  year: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
};

export type SaveProjectInput = {
  name: string;
  currentYear: number;
  eras: EraInput[];
  timelineEvents: TimelineEventInput[];
};

export type CreateFeatureInput = {
  featureType: FeatureType;
  name: string;
  validFromYear: number;
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
  viewProjectYear(year: number): Promise<RealmSnapshot>;
  createFeature(input: CreateFeatureInput): Promise<RealmSnapshot>;
  reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot>;
  deleteFeature(input: { id: string; validFromYear: number }): Promise<RealmSnapshot>;
  undoProject(): Promise<RealmSnapshot>;
  redoProject(): Promise<RealmSnapshot>;
  applyCellAttributes(input: ApplyCellAttributesInput): Promise<RealmSnapshot>;
  viewCellAttributes(input: CellViewportInput): Promise<CellAttributeSnapshot[]>;
  closeProject(): Promise<void>;
  getOpenProject(): Promise<RealmSnapshot | null>;
}
