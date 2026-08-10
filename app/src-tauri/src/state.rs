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
}

#[derive(Debug, Clone)]
pub(crate) enum EditOperation {
    ProjectName {
        before: String,
        after: String,
    },
    Feature {
        feature_id: String,
        feature_type: FeatureType,
        before: Option<FeatureState>,
        after: Option<FeatureState>,
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
