use crate::contract::{AssetIdInput, AssetManifest, AssetRead, ImportAssetInput, ProjectSnapshot};
use crate::domain::assets::{MAX_ASSET_BYTES, validate_asset};
use crate::edit::{asset_is_referenced, asset_state, upsert_asset_state};
use crate::error::AppError;
use crate::read_model::{asset_manifests, project_snapshot};
use crate::state::{AppState, AssetState, EditOperation, lock_project};
use rusqlite::OptionalExtension;
use uuid::Uuid;

pub(crate) fn import_asset_in_state(
    state: &AppState,
    input: ImportAssetInput,
) -> Result<ProjectSnapshot, AppError> {
    let (mime, metadata_json) = validate_asset(
        &input.mime,
        &input.bytes,
        input.width,
        input.height,
        &input.metadata,
        input.sha256.as_deref(),
    )?;
    let sha256 = crate::domain::assets::sha256_hex(&input.bytes);
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let existing: Option<String> = project
        .connection
        .query_row(
            "SELECT id FROM assets WHERE sha256 = ?1",
            [&sha256],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if existing.is_some() {
        return project_snapshot(project);
    }
    let asset_id = Uuid::new_v4().to_string();
    let after = AssetState {
        sha256,
        mime,
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        metadata_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    upsert_asset_state(&transaction, &asset_id, &after)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Asset {
        asset_id,
        before: None,
        after: Some(after),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn import_asset(
    state: tauri::State<'_, AppState>,
    input: ImportAssetInput,
) -> Result<ProjectSnapshot, AppError> {
    import_asset_in_state(state.inner(), input)
}

pub(crate) fn read_asset_in_state(
    state: &AppState,
    input: AssetIdInput,
) -> Result<AssetRead, AppError> {
    let asset_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("The asset identifier is invalid."))?
        .to_string();
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let state = asset_state(&project.connection, &asset_id)?
        .ok_or_else(|| AppError::new("not_found", "The asset was not found."))?;
    if state.bytes.is_empty() || state.bytes.len() > MAX_ASSET_BYTES {
        return Err(AppError::new(
            "corrupt_project",
            "The asset size is invalid.",
        ));
    }
    if crate::domain::assets::sha256_hex(&state.bytes) != state.sha256 {
        return Err(AppError::new(
            "corrupt_project",
            "The asset hash is invalid.",
        ));
    }
    let metadata: serde_json::Value = serde_json::from_str(&state.metadata_json)
        .map_err(|_| AppError::new("corrupt_project", "The asset metadata is invalid."))?;
    validate_asset(
        &state.mime,
        &state.bytes,
        state.width,
        state.height,
        &metadata,
        Some(&state.sha256),
    )
    .map_err(|_| AppError::new("corrupt_project", "The asset contents are invalid."))?;
    Ok(AssetRead {
        manifest: AssetManifest {
            id: asset_id,
            sha256: state.sha256,
            mime: state.mime,
            byte_length: i64::try_from(state.bytes.len())
                .map_err(|_| AppError::new("storage_error", "The asset size is unavailable."))?,
            width: state.width,
            height: state.height,
            metadata,
        },
        bytes: state.bytes,
    })
}

#[tauri::command]
pub(crate) fn read_asset(
    state: tauri::State<'_, AppState>,
    input: AssetIdInput,
) -> Result<AssetRead, AppError> {
    read_asset_in_state(state.inner(), input)
}

pub(crate) fn delete_asset_in_state(
    state: &AppState,
    input: AssetIdInput,
) -> Result<ProjectSnapshot, AppError> {
    let asset_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("The asset identifier is invalid."))?
        .to_string();
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before = asset_state(&project.connection, &asset_id)?
        .ok_or_else(|| AppError::new("not_found", "The asset was not found."))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    if asset_is_referenced(&transaction, &asset_id)? {
        return Err(AppError::new(
            "asset_in_use",
            "The asset is still referenced by a feature.",
        ));
    }
    if transaction
        .execute("DELETE FROM assets WHERE id = ?1", [&asset_id])
        .map_err(AppError::from)?
        != 1
    {
        return Err(AppError::new("not_found", "The asset was not found."));
    }
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Asset {
        asset_id,
        before: Some(before),
        after: None,
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn delete_asset(
    state: tauri::State<'_, AppState>,
    input: AssetIdInput,
) -> Result<ProjectSnapshot, AppError> {
    delete_asset_in_state(state.inner(), input)
}

#[allow(dead_code)]
pub(crate) fn asset_manifest_snapshot(state: &AppState) -> Result<Vec<AssetManifest>, AppError> {
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    asset_manifests(project)
}
