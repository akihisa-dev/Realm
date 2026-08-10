use crate::contract::{
    CreateFeatureInput, DeleteFeatureInput, FeatureType, ProjectSnapshot, ReviseFeatureInput,
};
use crate::domain::geometry::{validate_geometry, validate_name};
use crate::edit::{feature_state, upsert_feature_state};
use crate::error::AppError;
use crate::read_model::project_snapshot;
use crate::state::{AppState, EditOperation, FeatureState, lock_project};
use rusqlite::{Error as SqlError, params};
use uuid::Uuid;

pub(crate) fn create_feature_in_state(
    state: &AppState,
    input: CreateFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let geometry_json = validate_geometry(input.feature_type, &input.geometry)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let feature_id = Uuid::new_v4().to_string();
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    upsert_feature_state(&transaction, &feature_id, input.feature_type, &after)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type: input.feature_type,
        before: None,
        after: Some(after),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn create_feature(
    state: tauri::State<'_, AppState>,
    input: CreateFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    create_feature_in_state(state.inner(), input)
}

pub(crate) fn revise_feature_in_state(
    state: &AppState,
    input: ReviseFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let feature_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("A feature identifier is invalid."))?
        .to_string();
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let feature_type = project
        .connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [&feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => {
                AppError::new("not_found", "The feature was not found.")
            }
            other => other.into(),
        })
        .and_then(|value| FeatureType::from_storage(&value))?;
    let before = feature_state(&project.connection, &feature_id)?
        .ok_or_else(|| AppError::new("not_found", "The feature was not found."))?;
    let geometry_json = validate_geometry(feature_type, &input.geometry)?;
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    transaction
        .execute(
            "UPDATE features SET name = ?1, geometry_json = ?2 WHERE id = ?3",
            params![after.name, after.geometry_json, feature_id],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type,
        before: Some(before),
        after: Some(after),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn revise_feature(
    state: tauri::State<'_, AppState>,
    input: ReviseFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    revise_feature_in_state(state.inner(), input)
}

pub(crate) fn delete_feature_in_state(
    state: &AppState,
    input: DeleteFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    let feature_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("A feature identifier is invalid."))?
        .to_string();
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before = feature_state(&project.connection, &feature_id)?
        .ok_or_else(|| AppError::new("not_found", "The feature was not found."))?;
    let feature_type = project
        .connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [&feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(AppError::from)
        .and_then(|value| FeatureType::from_storage(&value))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    if transaction
        .execute("DELETE FROM features WHERE id = ?1", [&feature_id])
        .map_err(AppError::from)?
        != 1
    {
        return Err(AppError::new("not_found", "The feature was not found."));
    }
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type,
        before: Some(before),
        after: None,
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn delete_feature(
    state: tauri::State<'_, AppState>,
    input: DeleteFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    delete_feature_in_state(state.inner(), input)
}
