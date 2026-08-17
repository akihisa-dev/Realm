/** Renderer/native contract. The persisted model keeps typed content tables
 * separate from the user-facing layer tree. Cell IDs and GridShape are
 * renderer/editor projections only and never cross the storage boundary. */

/** Stable identity of a user-facing layer node. */
export type LayerId = string;
export type ContentKind = "terrain" | "region" | "object";
export type ActiveKind = "terrain" | "region" | ObjectKind;
export const contentKindOf = (kind: ActiveKind): ContentKind => kind === "terrain" || kind === "region" ? kind : "object";
export type LayerNodeKind = "group" | "leaf";
export type LayerNode = {
  id: LayerId;
  parentId: LayerId | null;
  kind: LayerNodeKind;
  name: string;
  order: number;
  visible: boolean;
  locked: boolean;
};
export type LayerTree = { nodes: LayerNode[] };
export type Properties = Record<string, unknown>;
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
  layerId?: LayerId;
  regionId?: string;
  value: string;
  geometry: MapShapeGeometry;
};

export type MapShapeLayer = "terrain" | "region";
/** Renderer-only edit preview. It never crosses the persistence boundary. */
export type MapShape = GridShape & { geometryVersion: number; snapGridVersion: number };
export type MapShapeEdit = { shapes: MapShape[] };

export type TerrainShape = {
  id: string;
  /** The leaf layer that owns this typed terrain record. */
  layerId?: LayerId;
  geometry: MapShapeGeometry;
};
export type RegionShape = {
  id: string;
  /** Must equal the owning logical region's layerId. */
  layerId?: LayerId;
  geometry: MapShapeGeometry;
};
export type Region = {
  id: string;
  layerId?: LayerId;
  name: string;
  color: string;
  shapes: RegionShape[];
};

export const OBJECT_KINDS = ["city", "text", "mountain", "forest"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];
export type MapObject = {
  id: string;
  layerId?: LayerId;
  kind: ObjectKind;
  label: string;
  geometry: GeoJsonGeometry;
  properties: Properties;
  zIndex: number;
  locked: boolean;
  assetId?: string;
};

export type RealmLayers = {
  terrain: TerrainShape[];
  regions: Region[];
  objects: MapObject[];
};
/** Alias used by new code to make clear these are typed map contents, not UI layers. */
export type MapContent = RealmLayers;

/** Renderer-only cell projection. These values are never persisted. */
export type CellAttributeSnapshot = {
  cellId: string;
  layerId?: LayerId;
  layer?: "terrain" | "region";
  /** @deprecated Accepted only for renderer fixture compatibility; new state uses layer. */
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

export type AssetManifest = { id: string; sha256: string; mime: string; byteLength: number; width: number; height: number; metadata: Properties };
export type AssetRead = { manifest: AssetManifest; bytes: number[] };
export type ImportAssetInput = { sha256?: string; mime: string; bytes: number[]; width: number; height: number; metadata?: Properties };
export type ImportAssetsBatchInput = { packName: string; assets: ImportAssetInput[] };
export type DeleteAssetsBatchInput = { ids: string[] };

export type ProjectSummary = { libraryId: string; name: string };
export type World = { id: string; name: string };
export type RealmSnapshot = {
  formatVersion: number;
  path: string;
  world: World;
  layers: RealmLayers;
  /** User-facing hierarchy; `layers` remains the typed content compatibility name. */
  layerTree?: LayerTree;
  assets: AssetManifest[];
  settings: ProjectSettings;
  canUndo: boolean;
  canRedo: boolean;
};

export type SaveProjectInput = { name: string };
export type ReplaceTerrainLayerInput = { shapes: TerrainShape[] };
export type ReplaceRegionLayerInput = { regions: Region[] };
export type ReplaceObjectLayerInput = { objects: MapObject[] };
export type ReplaceMapContentInput = { layers: RealmLayers };
export type ReplaceLayerTreeInput = { tree: LayerTree };

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
  replaceMapContent(input: ReplaceMapContentInput): Promise<RealmSnapshot>;
  replaceLayerTree(input: ReplaceLayerTreeInput): Promise<RealmSnapshot>;
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
