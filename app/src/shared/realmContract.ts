/** Renderer/native contract. The persisted model is deliberately split into
 * terrain, regions, and objects. Cell IDs and GridShape are renderer/editor
 * projections only and never cross the storage boundary. */

export type LayerId = "terrain" | "region" | "object";
/** Renderer-only object classes. They are not a persisted generic feature table. */
export type FeatureType = "terrain" | "forest" | "river" | "coastline" | "country" | "region" | "boundary" | "city" | "text" | "town"
  | "road" | "lake" | "mountain" | "tree" | "symbol" | "label" | "overlay" | "frame" | "scale";
export type FeatureProperties = Record<string, unknown>;
export type Position = [number, number];
export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };
export type MapShapeGeometry = Extract<GeoJsonGeometry, { type: "Polygon" }>;

/** A transient projection used by the hex-grid editor only. */
export type GridShape = {
  id: string;
  layer: "terrain" | "region";
  regionId?: string;
  value: string;
  geometry: MapShapeGeometry;
};

/** @deprecated Use GridShape inside the editor and the layer records at the API boundary. */
export type MapShapeLayer = "terrain" | "region";
/** @deprecated This is a renderer projection, never a storage row. */
export type MapShape = GridShape & { geometryVersion: number; snapGridVersion: number };
/** @deprecated Renderer-only edit preview. */
export type MapShapeEdit = { shapes: MapShape[] };

export type TerrainShape = {
  id: string;
  geometry: MapShapeGeometry;
};
export type RegionShape = {
  id: string;
  geometry: MapShapeGeometry;
};
export type Region = {
  id: string;
  name: string;
  color: string;
  shapes: RegionShape[];
};

export const OBJECT_KINDS = ["city", "text", "mountain", "forest"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];
export type MapObject = {
  id: string;
  kind: ObjectKind;
  label: string;
  geometry: GeoJsonGeometry;
  properties: FeatureProperties;
  zIndex: number;
  locked: boolean;
  assetId?: string;
};

/** @deprecated Renderer compatibility projection for an object. */
export type RealmFeature = { id: string; featureType: FeatureType; name: string; geometry: GeoJsonGeometry; properties?: FeatureProperties };

export type RealmLayers = {
  terrain: TerrainShape[];
  regions: Region[];
  objects: MapObject[];
};

/** Renderer-only cell projection. These values are never persisted. */
export type CellAttributeSnapshot = {
  cellId: string;
  layer?: "terrain" | "region";
  /** @deprecated Use layer. */
  attribute?: "terrain" | "region";
  value: string;
  regionId?: string;
};
export const cellAttributeLayer = (attribute: Pick<CellAttributeSnapshot, "layer" | "attribute">): "terrain" | "region" | undefined => attribute.layer ?? attribute.attribute;

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
export type World = { id: string; name: string };
export type RealmSnapshot = {
  formatVersion: number;
  path: string;
  world: World;
  layers: RealmLayers;
  assets: AssetManifest[];
  settings: ProjectSettings;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Temporary renderer projections retained while the OpenLayers editor is
   * being moved to the layer-native contract. They are derived from layers
   * and are never read from SQLite.
   */
  features: RealmFeature[];
  mapShapes: MapShape[];
  featureCount: number;
};

export type SaveProjectInput = { name: string };
export type ReplaceTerrainLayerInput = { shapes: TerrainShape[] };
export type ReplaceRegionLayerInput = { regions: Region[] };
export type ReplaceObjectLayerInput = { objects: MapObject[] };

/** Deprecated command shapes kept as renderer adapters during the cutover. */
export type CreateFeatureInput = { featureType: FeatureType; name: string; geometry: GeoJsonGeometry; properties?: FeatureProperties };
export type ReviseFeatureInput = Omit<CreateFeatureInput, "featureType"> & { id: string };
export type CreateFeaturesBatchInput = { features: CreateFeatureInput[] };
export type ReviseFeaturesBatchInput = { features: ReviseFeatureInput[] };
export type DeleteFeaturesBatchInput = { ids: string[] };
export type SetFeaturesLockedInput = { ids: string[]; locked: boolean };
export type CreateMapShapesInput = { shapes: MapShape[] };
export type UpdateMapShapesInput = { shapes: MapShape[] };
export type DeleteMapShapesInput = { ids: string[] };

export interface RealmBackend {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: { name: string; path?: string }): Promise<RealmSnapshot>;
  openProject(input: { libraryId: string }): Promise<RealmSnapshot>;
  importProject(input: { path: string }): Promise<RealmSnapshot>;
  exportProject(input: { path: string }): Promise<void>;
  writeArtifact(input: { path: string; bytes: number[] }): Promise<void>;
  saveProject(input: SaveProjectInput): Promise<RealmSnapshot>;
  updateProjectSettings(input: { settings: ProjectSettings }): Promise<RealmSnapshot>;
  importAsset(input: ImportAssetInput): Promise<RealmSnapshot>;
  importAssetsBatch(input: ImportAssetsBatchInput): Promise<RealmSnapshot>;
  readAsset(input: { id: string }): Promise<AssetRead>;
  deleteAsset(input: { id: string }): Promise<RealmSnapshot>;
  deleteAssetsBatch(input: DeleteAssetsBatchInput): Promise<RealmSnapshot>;
  replaceTerrainLayer(input: ReplaceTerrainLayerInput): Promise<RealmSnapshot>;
  replaceRegionLayer(input: ReplaceRegionLayerInput): Promise<RealmSnapshot>;
  replaceObjectLayer(input: ReplaceObjectLayerInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  createFeature(input: CreateFeatureInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  createFeaturesBatch(input: CreateFeaturesBatchInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  reviseFeature(input: ReviseFeatureInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  reviseFeaturesBatch(input: ReviseFeaturesBatchInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  deleteFeature(input: { id: string }): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  deleteFeaturesBatch(input: DeleteFeaturesBatchInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceObjectLayer. */
  setFeaturesLocked(input: SetFeaturesLockedInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceTerrainLayer or replaceRegionLayer. */
  createMapShapes(input: CreateMapShapesInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceTerrainLayer or replaceRegionLayer. */
  updateMapShapes(input: UpdateMapShapesInput): Promise<RealmSnapshot>;
  /** @deprecated Use replaceTerrainLayer or replaceRegionLayer. */
  deleteMapShapes(input: DeleteMapShapesInput): Promise<RealmSnapshot>;
  undoProject(): Promise<RealmSnapshot>;
  redoProject(): Promise<RealmSnapshot>;
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
