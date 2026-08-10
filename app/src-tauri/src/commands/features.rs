use crate::contract::{
    CreateFeatureInput, DeleteFeatureInput, DeleteFeaturesBatchInput, FeatureType, ProjectSnapshot,
    ReviseFeatureInput, ReviseFeaturesBatchInput, SetFeaturesLockedInput,
};
use crate::domain::geometry::{validate_geometry_for_write, validate_name, validate_properties};
use crate::edit::{feature_state, upsert_feature_state};
use crate::error::AppError;
use crate::read_model::project_snapshot;
use crate::state::{AppState, EditOperation, FeatureEdit, FeatureState, lock_project};
use rusqlite::{Error as SqlError, params};
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

pub(crate) const MAX_FEATURE_BATCH: usize = 2_048;
const MAX_FEATURE_ID_BYTES: usize = 128;
const FEATURE_LOCKED_ERROR: &str = "The feature is locked and cannot be changed.";

fn canonical_feature_id(raw: &str) -> Result<String, AppError> {
    if raw.len() > MAX_FEATURE_ID_BYTES {
        return Err(AppError::invalid("A feature identifier is invalid."));
    }
    Uuid::parse_str(raw.trim())
        .map(|id| id.to_string())
        .map_err(|_| AppError::invalid("A feature identifier is invalid."))
}

fn ensure_feature_unlocked(state: &FeatureState) -> Result<(), AppError> {
    let properties: Value = serde_json::from_str(&state.properties_json)
        .map_err(|_| AppError::new("corrupt_project", "A feature contains invalid properties."))?;
    let object = properties.as_object().ok_or_else(|| {
        AppError::new("corrupt_project", "A feature contains invalid properties.")
    })?;
    if object.get("locked").and_then(Value::as_bool) == Some(true) {
        return Err(AppError::new("feature_locked", FEATURE_LOCKED_ERROR));
    }
    Ok(())
}

fn load_feature(
    connection: &rusqlite::Connection,
    feature_id: &str,
) -> Result<(FeatureType, FeatureState), AppError> {
    let feature_type = connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => {
                AppError::new("not_found", "The feature was not found.")
            }
            other => other.into(),
        })
        .and_then(|value| FeatureType::from_storage(&value))?;
    let state = feature_state(connection, feature_id)?
        .ok_or_else(|| AppError::new("not_found", "The feature was not found."))?;
    Ok((feature_type, state))
}

pub(crate) fn create_features_batch_in_state(
    state: &AppState,
    input: crate::contract::CreateFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    if input.features.is_empty() || input.features.len() > MAX_FEATURE_BATCH {
        return Err(AppError::invalid("The feature batch size is invalid."));
    }
    let validated = input
        .features
        .into_iter()
        .map(|feature| {
            validate_name(&feature.name)?;
            let geometry_json =
                validate_geometry_for_write(feature.feature_type, &feature.geometry)?;
            let properties_json = validate_properties(&feature.properties)?;
            Ok((
                feature.feature_type,
                FeatureState {
                    name: feature.name.trim().to_owned(),
                    geometry_json,
                    properties_json,
                },
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let changes = validated
        .into_iter()
        .map(|(feature_type, after)| FeatureEdit {
            feature_id: Uuid::new_v4().to_string(),
            feature_type,
            before: None,
            after: Some(after),
        })
        .collect::<Vec<_>>();
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        let Some(after) = change.after.as_ref() else {
            return Err(AppError::new(
                "storage_error",
                "The feature batch could not be prepared.",
            ));
        };
        crate::edit::upsert_feature_state(
            &transaction,
            &change.feature_id,
            change.feature_type,
            after,
        )?;
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::FeatureBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn create_features_batch(
    state: tauri::State<'_, AppState>,
    input: crate::contract::CreateFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    create_features_batch_in_state(state.inner(), input)
}

pub(crate) fn create_feature_in_state(
    state: &AppState,
    input: CreateFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let geometry_json = validate_geometry_for_write(input.feature_type, &input.geometry)?;
    let properties_json = validate_properties(&input.properties)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let feature_id = Uuid::new_v4().to_string();
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
        properties_json,
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
    let feature_id = canonical_feature_id(&input.id)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let (feature_type, before) = load_feature(&project.connection, &feature_id)?;
    ensure_feature_unlocked(&before)?;
    let geometry_json = validate_geometry_for_write(feature_type, &input.geometry)?;
    let properties_json = validate_properties(&input.properties)?;
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
        properties_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    transaction
        .execute(
            "UPDATE features SET name = ?1, geometry_json = ?2, properties_json = ?3 WHERE id = ?4",
            params![
                after.name,
                after.geometry_json,
                after.properties_json,
                feature_id
            ],
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

pub(crate) fn revise_features_batch_in_state(
    state: &AppState,
    input: ReviseFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    if input.features.is_empty() || input.features.len() > MAX_FEATURE_BATCH {
        return Err(AppError::invalid("The feature batch size is invalid."));
    }

    // Validate every request, including its canonical ID, before touching the open project.
    // This keeps malformed input from partially changing a later feature in the batch.
    let mut ids = HashSet::with_capacity(input.features.len());
    let mut prepared = Vec::with_capacity(input.features.len());
    for feature in input.features {
        let feature_id = canonical_feature_id(&feature.id)?;
        if !ids.insert(feature_id.clone()) {
            return Err(AppError::invalid(
                "A feature batch cannot contain duplicate identifiers.",
            ));
        }
        validate_name(&feature.name)?;
        let properties_json = validate_properties(&feature.properties)?;
        prepared.push((
            feature_id,
            feature.name.trim().to_owned(),
            feature.geometry,
            properties_json,
        ));
    }

    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let mut changes = Vec::with_capacity(prepared.len());
    for (feature_id, name, geometry, properties_json) in prepared {
        let (feature_type, before) = load_feature(&project.connection, &feature_id)?;
        ensure_feature_unlocked(&before)?;
        let geometry_json = validate_geometry_for_write(feature_type, &geometry)?;
        let after = FeatureState {
            name,
            geometry_json,
            properties_json,
        };
        changes.push(FeatureEdit {
            feature_id,
            feature_type,
            before: Some(before),
            after: Some(after),
        });
    }

    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        let Some(after) = change.after.as_ref() else {
            return Err(AppError::new(
                "storage_error",
                "The feature batch could not be prepared.",
            ));
        };
        if transaction
            .execute(
                "UPDATE features SET name = ?1, geometry_json = ?2, properties_json = ?3 WHERE id = ?4",
                params![
                    &after.name,
                    &after.geometry_json,
                    &after.properties_json,
                    &change.feature_id
                ],
            )
            .map_err(AppError::from)?
            != 1
        {
            return Err(AppError::new(
                "not_found",
                "The feature was not found.",
            ));
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::FeatureBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn revise_features_batch(
    state: tauri::State<'_, AppState>,
    input: ReviseFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    revise_features_batch_in_state(state.inner(), input)
}

pub(crate) fn delete_feature_in_state(
    state: &AppState,
    input: DeleteFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    let feature_id = canonical_feature_id(&input.id)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let (feature_type, before) = load_feature(&project.connection, &feature_id)?;
    ensure_feature_unlocked(&before)?;
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

pub(crate) fn delete_features_batch_in_state(
    state: &AppState,
    input: DeleteFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    if input.ids.is_empty() || input.ids.len() > MAX_FEATURE_BATCH {
        return Err(AppError::invalid("The feature batch size is invalid."));
    }

    let mut seen_ids = HashSet::with_capacity(input.ids.len());
    let mut ids = Vec::with_capacity(input.ids.len());
    for raw_id in input.ids {
        let feature_id = canonical_feature_id(&raw_id)?;
        if !seen_ids.insert(feature_id.clone()) {
            return Err(AppError::invalid(
                "A feature batch cannot contain duplicate identifiers.",
            ));
        }
        ids.push(feature_id);
    }

    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let mut changes = Vec::with_capacity(ids.len());
    for feature_id in ids {
        let (feature_type, before) = load_feature(&project.connection, &feature_id)?;
        ensure_feature_unlocked(&before)?;
        changes.push(FeatureEdit {
            feature_id,
            feature_type,
            before: Some(before),
            after: None,
        });
    }

    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        if transaction
            .execute("DELETE FROM features WHERE id = ?1", [&change.feature_id])
            .map_err(AppError::from)?
            != 1
        {
            return Err(AppError::new("not_found", "The feature was not found."));
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::FeatureBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn delete_features_batch(
    state: tauri::State<'_, AppState>,
    input: DeleteFeaturesBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    delete_features_batch_in_state(state.inner(), input)
}

pub(crate) fn set_features_locked_in_state(
    state: &AppState,
    input: SetFeaturesLockedInput,
) -> Result<ProjectSnapshot, AppError> {
    if input.ids.is_empty() || input.ids.len() > MAX_FEATURE_BATCH {
        return Err(AppError::invalid("The feature batch size is invalid."));
    }

    let mut seen_ids = HashSet::with_capacity(input.ids.len());
    let mut ids = Vec::with_capacity(input.ids.len());
    for raw_id in input.ids {
        let feature_id = canonical_feature_id(&raw_id)?;
        if !seen_ids.insert(feature_id.clone()) {
            return Err(AppError::invalid(
                "A feature batch cannot contain duplicate identifiers.",
            ));
        }
        ids.push(feature_id);
    }

    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let mut changes = Vec::with_capacity(ids.len());
    for feature_id in ids {
        let (feature_type, before) = load_feature(&project.connection, &feature_id)?;
        let mut properties: Value =
            serde_json::from_str(&before.properties_json).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid properties.")
            })?;
        let object = properties.as_object_mut().ok_or_else(|| {
            AppError::new("corrupt_project", "A feature contains invalid properties.")
        })?;
        let current_locked = object
            .get("locked")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if current_locked == input.locked {
            continue;
        }
        object.insert("locked".to_owned(), Value::Bool(input.locked));
        let properties_json = validate_properties(&properties)?;
        let after = FeatureState {
            name: before.name.clone(),
            geometry_json: before.geometry_json.clone(),
            properties_json,
        };
        changes.push(FeatureEdit {
            feature_id,
            feature_type,
            before: Some(before),
            after: Some(after),
        });
    }

    if changes.is_empty() {
        return project_snapshot(project);
    }

    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        let after = change
            .after
            .as_ref()
            .ok_or_else(|| AppError::new("storage_error", "The feature lock change is invalid."))?;
        if transaction
            .execute(
                "UPDATE features SET properties_json = ?1 WHERE id = ?2",
                params![&after.properties_json, &change.feature_id],
            )
            .map_err(AppError::from)?
            != 1
        {
            return Err(AppError::new("not_found", "The feature was not found."));
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::FeatureBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn set_features_locked(
    state: tauri::State<'_, AppState>,
    input: SetFeaturesLockedInput,
) -> Result<ProjectSnapshot, AppError> {
    set_features_locked_in_state(state.inner(), input)
}
