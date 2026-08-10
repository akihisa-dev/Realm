use crate::contract::{CellLayer, FeatureType};
use crate::error::AppError;
use rusqlite::Connection;
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

#[derive(Debug, Clone)]
pub(crate) struct CellState {
    pub(crate) value: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CellEditChange {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) layer: CellLayer,
    pub(crate) before: Option<CellState>,
    pub(crate) after: Option<CellState>,
}

#[derive(Debug, Clone)]
pub(crate) struct FeatureState {
    pub(crate) name: String,
    pub(crate) geometry_json: String,
    pub(crate) properties_json: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AssetState {
    pub(crate) sha256: String,
    pub(crate) mime: String,
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) metadata_json: String,
}

#[derive(Debug, Clone)]
pub(crate) struct FeatureEdit {
    pub(crate) feature_id: String,
    pub(crate) feature_type: FeatureType,
    pub(crate) before: Option<FeatureState>,
    pub(crate) after: Option<FeatureState>,
}

#[derive(Debug, Clone)]
pub(crate) struct AssetEdit {
    pub(crate) asset_id: String,
    pub(crate) before: Option<AssetState>,
    pub(crate) after: Option<AssetState>,
}

#[derive(Debug, Clone)]
pub(crate) enum EditOperation {
    ProjectName {
        before: String,
        after: String,
    },
    Settings {
        before: String,
        after: String,
    },
    Feature {
        feature_id: String,
        feature_type: FeatureType,
        before: Option<FeatureState>,
        after: Option<FeatureState>,
    },
    FeatureBatch {
        changes: Vec<FeatureEdit>,
    },
    Asset {
        asset_id: String,
        before: Option<AssetState>,
        after: Option<AssetState>,
    },
    AssetBatch {
        changes: Vec<AssetEdit>,
    },
    CellAttributes {
        changes: Vec<CellEditChange>,
    },
}

pub(crate) struct OpenProject {
    pub(crate) path: PathBuf,
    pub(crate) connection: Connection,
    pub(crate) undo_stack: Vec<EditOperation>,
    pub(crate) redo_stack: Vec<EditOperation>,
}

pub struct AppState {
    pub(crate) project: Mutex<Option<OpenProject>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(None),
        }
    }
}

pub(crate) fn lock_project(
    state: &AppState,
) -> Result<MutexGuard<'_, Option<OpenProject>>, AppError> {
    state.project.lock().map_err(AppError::from)
}
