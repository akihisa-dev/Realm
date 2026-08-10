use crate::contract::{
    AssetIdInput, AssetManifest, AssetRead, DeleteAssetsBatchInput, ImportAssetInput,
    ImportAssetsBatchInput, ProjectSnapshot,
};
use crate::domain::assets::{MAX_ASSET_BYTES, validate_asset};
use crate::edit::{asset_is_referenced, asset_state, upsert_asset_state};
use crate::error::AppError;
use crate::read_model::{asset_manifests, project_snapshot};
use crate::state::{AppState, AssetEdit, AssetState, EditOperation, lock_project};
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

pub(crate) const MAX_ASSET_BATCH: usize = 256;
pub(crate) const MAX_ASSET_PACK_BYTES: usize = 64 * 1024 * 1024;
const MAX_PACK_NAME_CHARS: usize = 128;
const MAX_ASSET_ID_BYTES: usize = 128;

fn canonical_asset_id(raw: &str) -> Result<String, AppError> {
    if raw.len() > MAX_ASSET_ID_BYTES {
        return Err(AppError::invalid("The asset identifier is invalid."));
    }
    Uuid::parse_str(raw.trim())
        .map(|id| id.to_string())
        .map_err(|_| AppError::invalid("The asset identifier is invalid."))
}

fn validate_pack_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_PACK_NAME_CHARS {
        return Err(AppError::invalid("The asset pack name is invalid."));
    }
    Ok(name.to_owned())
}

fn enrich_pack_metadata(
    metadata_json: &str,
    pack_id: &str,
    pack_name: &str,
    ordinal: usize,
) -> Result<String, AppError> {
    let mut metadata: Value = serde_json::from_str(metadata_json)
        .map_err(|_| AppError::invalid("The asset metadata is invalid."))?;
    let object = metadata
        .as_object_mut()
        .ok_or_else(|| AppError::invalid("The asset metadata must be an object."))?;
    for reserved in ["packId", "packName", "packOrdinal"] {
        if object.contains_key(reserved) {
            return Err(AppError::invalid(
                "Asset metadata contains a reserved pack key.",
            ));
        }
    }
    object.insert("packId".to_owned(), Value::String(pack_id.to_owned()));
    object.insert("packName".to_owned(), Value::String(pack_name.to_owned()));
    object.insert(
        "packOrdinal".to_owned(),
        Value::Number(serde_json::Number::from(ordinal as u64)),
    );
    crate::domain::geometry::validate_properties(&metadata)
}

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
    let pack_id = Uuid::new_v4().to_string();
    let prepared = prepared
        .into_iter()
        .map(
            |(ordinal, sha256, mime, bytes, width, height, metadata_json)| {
                let metadata_json =
                    enrich_pack_metadata(&metadata_json, &pack_id, &pack_name, ordinal)?;
                Ok((ordinal, sha256, mime, bytes, width, height, metadata_json))
            },
        )
        .collect::<Result<Vec<_>, AppError>>()?;

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

pub(crate) fn import_assets_batch_in_state(
    state: &AppState,
    input: ImportAssetsBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    let pack_name = validate_pack_name(&input.pack_name)?;
    if input.assets.is_empty() || input.assets.len() > MAX_ASSET_BATCH {
        return Err(AppError::invalid("The asset batch size is invalid."));
    }
    let mut total_bytes = 0usize;
    let mut prepared = Vec::with_capacity(input.assets.len());
    let mut seen_sha = HashSet::with_capacity(input.assets.len());
    for (ordinal, asset) in input.assets.into_iter().enumerate() {
        total_bytes = total_bytes
            .checked_add(asset.bytes.len())
            .filter(|total| *total <= MAX_ASSET_PACK_BYTES)
            .ok_or_else(|| AppError::invalid("The asset pack is too large."))?;
        let (mime, metadata_json) = validate_asset(
            &asset.mime,
            &asset.bytes,
            asset.width,
            asset.height,
            &asset.metadata,
            asset.sha256.as_deref(),
        )?;
        let sha256 = crate::domain::assets::sha256_hex(&asset.bytes);
        // Validate reserved metadata keys before checking database deduplication;
        // malformed pack input must never be partially accepted.
        let metadata_value: Value = serde_json::from_str(&metadata_json)
            .map_err(|_| AppError::invalid("The asset metadata is invalid."))?;
        let object = metadata_value
            .as_object()
            .ok_or_else(|| AppError::invalid("The asset metadata must be an object."))?;
        if ["packId", "packName", "packOrdinal"]
            .iter()
            .any(|key| object.contains_key(*key))
        {
            return Err(AppError::invalid(
                "Asset metadata contains a reserved pack key.",
            ));
        }
        if !seen_sha.insert(sha256.clone()) {
            continue;
        }
        prepared.push((
            ordinal,
            sha256,
            mime,
            asset.bytes,
            asset.width,
            asset.height,
            metadata_json,
        ));
    }

    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    let mut changes = Vec::with_capacity(prepared.len());
    for (ordinal, sha256, mime, bytes, width, height, metadata_json) in prepared {
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM assets WHERE sha256 = ?1",
                [&sha256],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        if existing.is_some() {
            continue;
        }
        changes.push(AssetEdit {
            asset_id: Uuid::new_v4().to_string(),
            before: None,
            after: Some(AssetState {
                sha256,
                mime,
                bytes,
                width,
                height,
                metadata_json,
            }),
        });
    }
    if changes.is_empty() {
        transaction.rollback().map_err(AppError::from)?;
        return project_snapshot(project);
    }
    for change in &changes {
        let after = change.after.as_ref().ok_or_else(|| {
            AppError::new("storage_error", "The asset pack could not be prepared.")
        })?;
        upsert_asset_state(&transaction, &change.asset_id, after)?;
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::AssetBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn import_assets_batch(
    state: tauri::State<'_, AppState>,
    input: ImportAssetsBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    import_assets_batch_in_state(state.inner(), input)
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

pub(crate) fn delete_assets_batch_in_state(
    state: &AppState,
    input: DeleteAssetsBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    if input.ids.is_empty() || input.ids.len() > MAX_ASSET_BATCH {
        return Err(AppError::invalid("The asset batch size is invalid."));
    }
    let mut seen = HashSet::with_capacity(input.ids.len());
    let mut ids = Vec::with_capacity(input.ids.len());
    for raw_id in input.ids {
        let id = canonical_asset_id(&raw_id)?;
        if !seen.insert(id.clone()) {
            return Err(AppError::invalid(
                "An asset batch cannot contain duplicate identifiers.",
            ));
        }
        ids.push(id);
    }

    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    let mut changes = Vec::with_capacity(ids.len());
    for asset_id in ids {
        let before = asset_state(&transaction, &asset_id)?
            .ok_or_else(|| AppError::new("not_found", "The asset was not found."))?;
        if asset_is_referenced(&transaction, &asset_id)? {
            return Err(AppError::new(
                "asset_in_use",
                "The asset is still referenced by a feature.",
            ));
        }
        changes.push(AssetEdit {
            asset_id,
            before: Some(before),
            after: None,
        });
    }
    for change in &changes {
        if transaction
            .execute("DELETE FROM assets WHERE id = ?1", [&change.asset_id])
            .map_err(AppError::from)?
            != 1
        {
            return Err(AppError::new("not_found", "The asset was not found."));
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::AssetBatch { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn delete_assets_batch(
    state: tauri::State<'_, AppState>,
    input: DeleteAssetsBatchInput,
) -> Result<ProjectSnapshot, AppError> {
    delete_assets_batch_in_state(state.inner(), input)
}

#[allow(dead_code)]
pub(crate) fn asset_manifest_snapshot(state: &AppState) -> Result<Vec<AssetManifest>, AppError> {
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    asset_manifests(project)
}
