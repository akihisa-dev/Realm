use crate::error::AppError;
use crate::storage::schema::corrupt_schema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldSnapshot {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FeatureType {
    Terrain,
    Forest,
    River,
    Coastline,
    Country,
    Region,
    Boundary,
    City,
    Town,
    Road,
    Lake,
    Mountain,
    Tree,
    Symbol,
    Label,
    Overlay,
    Frame,
    Scale,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CellLayer {
    Terrain,
    Forest,
    Country,
    Region,
}

impl CellLayer {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Terrain => "terrain",
            Self::Forest => "forest",
            Self::Country => "country",
            Self::Region => "region",
        }
    }
    pub(crate) fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
            "terrain" => Ok(Self::Terrain),
            "forest" => Ok(Self::Forest),
            "country" => Ok(Self::Country),
            "region" => Ok(Self::Region),
            _ => Err(corrupt_schema()),
        }
    }
}

impl FeatureType {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Terrain => "terrain",
            Self::Forest => "forest",
            Self::River => "river",
            Self::Coastline => "coastline",
            Self::Country => "country",
            Self::Region => "region",
            Self::Boundary => "boundary",
            Self::City => "city",
            Self::Town => "town",
            Self::Road => "road",
            Self::Lake => "lake",
            Self::Mountain => "mountain",
            Self::Tree => "tree",
            Self::Symbol => "symbol",
            Self::Label => "label",
            Self::Overlay => "overlay",
            Self::Frame => "frame",
            Self::Scale => "scale",
        }
    }
    pub(crate) fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
            "terrain" => Ok(Self::Terrain),
            "forest" => Ok(Self::Forest),
            "river" => Ok(Self::River),
            "coastline" => Ok(Self::Coastline),
            "country" => Ok(Self::Country),
            "region" => Ok(Self::Region),
            "boundary" => Ok(Self::Boundary),
            "city" => Ok(Self::City),
            "town" => Ok(Self::Town),
            "road" => Ok(Self::Road),
            "lake" => Ok(Self::Lake),
            "mountain" => Ok(Self::Mountain),
            "tree" => Ok(Self::Tree),
            "symbol" => Ok(Self::Symbol),
            "label" => Ok(Self::Label),
            "overlay" => Ok(Self::Overlay),
            "frame" => Ok(Self::Frame),
            "scale" => Ok(Self::Scale),
            _ => Err(corrupt_schema()),
        }
    }
    pub(crate) fn geometry_type(self) -> &'static str {
        match self {
            Self::City
            | Self::Town
            | Self::Mountain
            | Self::Tree
            | Self::Symbol
            | Self::Label
            | Self::Scale => "Point",
            Self::River | Self::Coastline | Self::Boundary | Self::Road => "LineString",
            Self::Terrain
            | Self::Forest
            | Self::Country
            | Self::Region
            | Self::Lake
            | Self::Overlay
            | Self::Frame => "Polygon",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSnapshot {
    pub id: String,
    pub feature_type: FeatureType,
    pub name: String,
    pub geometry: Value,
    pub properties: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub format_version: i32,
    pub path: String,
    pub world: WorldSnapshot,
    pub settings: Value,
    pub features: Vec<FeatureSnapshot>,
    pub assets: Vec<AssetManifest>,
    pub feature_count: i64,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetManifest {
    pub id: String,
    pub sha256: String,
    pub mime: String,
    pub byte_length: i64,
    pub width: u32,
    pub height: u32,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetRead {
    pub manifest: AssetManifest,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub library_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellAttributeSnapshot {
    pub cell_id: String,
    pub attribute: CellLayer,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCellAttributesInput {
    pub cell_ids: Vec<String>,
    pub attribute: CellLayer,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellViewportInput {
    pub min_x: Option<i32>,
    pub max_x: Option<i32>,
    pub min_y: Option<i32>,
    pub max_y: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectInput {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectSettingsInput {
    pub settings: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeatureInput {
    pub feature_type: FeatureType,
    pub name: String,
    pub geometry: Value,
    #[serde(default = "empty_properties")]
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeaturesBatchInput {
    pub features: Vec<CreateFeatureInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseFeaturesBatchInput {
    pub features: Vec<ReviseFeatureInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFeaturesBatchInput {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFeaturesLockedInput {
    pub ids: Vec<String>,
    pub locked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetInput {
    pub sha256: Option<String>,
    pub mime: String,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    #[serde(default = "empty_properties")]
    pub metadata: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetsBatchInput {
    pub pack_name: String,
    pub assets: Vec<ImportAssetInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIdInput {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAssetsBatchInput {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseFeatureInput {
    pub id: String,
    pub name: String,
    pub geometry: Value,
    #[serde(default = "empty_properties")]
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFeatureInput {
    pub id: String,
}

fn empty_properties() -> Value {
    Value::Object(serde_json::Map::new())
}
