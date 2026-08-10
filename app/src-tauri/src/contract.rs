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
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CellLayer {
    Forest,
    Country,
    Region,
}

impl CellLayer {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Forest => "forest",
            Self::Country => "country",
            Self::Region => "region",
        }
    }
    pub(crate) fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
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
            _ => Err(corrupt_schema()),
        }
    }
    pub(crate) fn geometry_type(self) -> &'static str {
        match self {
            Self::City | Self::Town => "Point",
            Self::River | Self::Coastline | Self::Boundary => "LineString",
            Self::Terrain | Self::Forest | Self::Country | Self::Region => "Polygon",
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
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub format_version: i32,
    pub path: String,
    pub world: WorldSnapshot,
    pub features: Vec<FeatureSnapshot>,
    pub feature_count: i64,
    pub can_undo: bool,
    pub can_redo: bool,
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
pub struct CreateFeatureInput {
    pub feature_type: FeatureType,
    pub name: String,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseFeatureInput {
    pub id: String,
    pub name: String,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFeatureInput {
    pub id: String,
}
