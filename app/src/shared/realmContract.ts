/** Renderer/native contract.  The renderer only ever sees these plain values; it does not
 * receive a SQLite handle or a filesystem object. */

export type FeatureType = "terrain" | "forest" | "river" | "coastline" | "country" | "region" | "boundary" | "city" | "town"
  | "road" | "lake" | "mountain" | "tree" | "symbol" | "label" | "overlay" | "frame" | "scale";
export type CellAttribute = "terrain" | "forest" | "country" | "region";
export type FeatureProperties = Record<string, unknown>;
export type Position = [number, number];
export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };
export type RealmFeature = { id: string; featureType: FeatureType; name: string; geometry: GeoJsonGeometry; properties: FeatureProperties };
export type World = { id: string; name: string };

export type ProjectSettings = {
  themeId: "ink" | "atlas" | "midnight";
  showGrid: boolean;
  exportScale: 1 | 2 | 4;
  exportExtent: "viewport" | "world";
  canvasWidth: number;
  canvasHeight: number;
  gridKind: "graticule" | "square" | "hex";
  gridColor: string;
  gridWidth: number;
  gridSpacing: number;
  themeOverrides: Partial<Record<"canvas" | "land" | "landInk" | "coastGlow" | "river" | "forest" | "country" | "region" | "boundary" | "settlement" | "label" | "labelHalo" | "grid", string>>;
};

export type AssetManifest = { id: string; sha256: string; mime: string; byteLength: number; width: number; height: number; metadata: FeatureProperties };
export type AssetRead = { manifest: AssetManifest; bytes: number[] };
export type ImportAssetInput = { sha256?: string; mime: string; bytes: number[]; width: number; height: number; metadata?: FeatureProperties };
export type ImportAssetsBatchInput = { packName: string; assets: ImportAssetInput[] };
export type DeleteAssetsBatchInput = { ids: string[] };
export type ProjectSummary = { libraryId: string; name: string };
export type CellAttributeSnapshot = { cellId: string; attribute: CellAttribute; value: string; regionId?: string };
export type ApplyCellAttributesInput = { cellIds: string[]; attribute: CellAttribute; value: string | null; regionId?: string; clearRegion?: boolean };
export type MoveRegionCellsInput = { sourceCellIds: string[]; targetCellIds: string[] };
export type CellViewportInput = { minX?: number; maxX?: number; minY?: number; maxY?: number };
export type RealmSnapshot = { formatVersion: number; path: string; world: World; features: RealmFeature[]; assets: AssetManifest[]; settings: ProjectSettings; featureCount: number; canUndo: boolean; canRedo: boolean };
export type SaveProjectInput = { name: string };
export type CreateFeatureInput = { featureType: FeatureType; name: string; geometry: GeoJsonGeometry; properties?: FeatureProperties };
export type ReviseFeatureInput = Omit<CreateFeatureInput, "featureType"> & { id: string };
export type CreateFeaturesBatchInput = { features: CreateFeatureInput[] };
export type ReviseFeaturesBatchInput = { features: ReviseFeatureInput[] };
export type DeleteFeaturesBatchInput = { ids: string[] };
export type SetFeaturesLockedInput = { ids: string[]; locked: boolean };

export interface RealmBackend {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: { name: string; path?: string }): Promise<RealmSnapshot>;
  openProject(input: { libraryId: string }): Promise<RealmSnapshot>;
  importProject(input: { path: string }): Promise<RealmSnapshot>;
  exportProject(input: { path: string }): Promise<void>;
  writeArtifact(input: { path: string; bytes: number[] }): Promise<void>;
  saveProject(input: SaveProjectInput): Promise<RealmSnapshot>;
  updateProjectSettings(input: { settings: ProjectSettings }): Promise<RealmSnapshot>;
  createFeature(input: CreateFeatureInput): Promise<RealmSnapshot>;
  createFeaturesBatch(input: CreateFeaturesBatchInput): Promise<RealmSnapshot>;
  reviseFeaturesBatch(input: ReviseFeaturesBatchInput): Promise<RealmSnapshot>;
  deleteFeaturesBatch(input: DeleteFeaturesBatchInput): Promise<RealmSnapshot>;
  setFeaturesLocked(input: SetFeaturesLockedInput): Promise<RealmSnapshot>;
  importAsset(input: ImportAssetInput): Promise<RealmSnapshot>;
  importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot>;
  readAsset(input: { id: string }): Promise<AssetRead>;
  deleteAsset(input: { id: string }): Promise<RealmSnapshot>;
  deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot>;
  reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot>;
  deleteFeature(input: { id: string }): Promise<RealmSnapshot>;
  undoProject(): Promise<RealmSnapshot>;
  redoProject(): Promise<RealmSnapshot>;
  applyCellAttributes(input: ApplyCellAttributesInput): Promise<RealmSnapshot>;
  moveRegionCells(input: MoveRegionCellsInput): Promise<RealmSnapshot>;
  viewCellAttributes(input: CellViewportInput): Promise<CellAttributeSnapshot[]>;
  closeProject(): Promise<void>;
  getOpenProject(): Promise<RealmSnapshot | null>;
}

export type RealmErrorShape = { code: string; message: string };
export type TransferPathMode = "import" | "export";
export type ArtifactFormat = "png" | "jpg" | "pdf";
export type RealmPathDialogs = {
  chooseTransferPath(input: { mode: TransferPathMode; suggestedName?: string }): Promise<string | null>;
  chooseArtifactPath(input: { format: ArtifactFormat; suggestedName: string }): Promise<string | null>;
};
export type ElectronRealmApi = RealmBackend & RealmPathDialogs;
