use crate::contract::{CellLayer, FeatureType};
use crate::error::AppError;
use crate::state::{
    AssetEdit, AssetState, CellState, EditOperation, FeatureEdit, FeatureState, OpenProject,
};
use crate::storage::schema::GRID_VERSION;
use rusqlite::{Connection, Error as SqlError, Transaction, params};

pub(crate) fn feature_state(
    connection: &Connection,
    feature_id: &str,
) -> Result<Option<FeatureState>, AppError> {
    let result = connection.query_row(
        "SELECT name, geometry_json, properties_json FROM features WHERE id = ?1",
        [feature_id],
        |row| {
            Ok(FeatureState {
                name: row.get(0)?,
                geometry_json: row.get(1)?,
                properties_json: row.get(2)?,
            })
        },
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn upsert_feature_state(
    transaction: &Transaction<'_>,
    feature_id: &str,
    feature_type: FeatureType,
    state: &FeatureState,
) -> Result<(), AppError> {
    transaction.execute(
        "INSERT INTO features(id, feature_type, name, geometry_json, properties_json) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET feature_type = excluded.feature_type, name = excluded.name,
             geometry_json = excluded.geometry_json, properties_json = excluded.properties_json",
        params![
            feature_id,
            feature_type.as_str(),
            state.name,
            state.geometry_json,
            state.properties_json
        ],
    ).map_err(AppError::from)?;
    Ok(())
}

pub(crate) fn asset_state(
    connection: &Connection,
    asset_id: &str,
) -> Result<Option<AssetState>, AppError> {
    let result = connection.query_row(
        "SELECT sha256, mime, bytes, width, height, metadata_json FROM assets WHERE id = ?1",
        [asset_id],
        |row| {
            Ok(AssetState {
                sha256: row.get(0)?,
                mime: row.get(1)?,
                bytes: row.get(2)?,
                width: row.get(3)?,
                height: row.get(4)?,
                metadata_json: row.get(5)?,
            })
        },
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn upsert_asset_state(
    transaction: &Transaction<'_>,
    asset_id: &str,
    state: &AssetState,
) -> Result<(), AppError> {
    transaction
        .execute(
            "INSERT INTO assets(id, sha256, mime, bytes, width, height, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256, mime = excluded.mime,
                 bytes = excluded.bytes, width = excluded.width, height = excluded.height,
                 metadata_json = excluded.metadata_json",
            params![
                asset_id,
                state.sha256,
                state.mime,
                state.bytes,
                state.width,
                state.height,
                state.metadata_json
            ],
        )
        .map_err(AppError::from)?;
    Ok(())
}

pub(crate) fn asset_is_referenced(
    connection: &Connection,
    asset_id: &str,
) -> Result<bool, AppError> {
    let mut query = connection
        .prepare("SELECT properties_json FROM features")
        .map_err(AppError::from)?;
    for properties in query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::from)?
    {
        let properties = properties.map_err(AppError::from)?;
        let value: serde_json::Value = serde_json::from_str(&properties).map_err(|_| {
            AppError::new("corrupt_project", "A feature contains invalid properties.")
        })?;
        if value_contains_asset(&value, asset_id) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn value_contains_asset(value: &serde_json::Value, asset_id: &str) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, value)| {
            ((matches!(
                key.as_str(),
                "assetId" | "assetIds" | "asset_id" | "asset_ids" | "asset"
            )) && match value {
                serde_json::Value::String(candidate) => candidate == asset_id,
                serde_json::Value::Array(values) => values
                    .iter()
                    .any(|item| item.as_str().is_some_and(|candidate| candidate == asset_id)),
                _ => false,
            }) || value_contains_asset(value, asset_id)
        }),
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| value_contains_asset(value, asset_id)),
        _ => false,
    }
}

pub(crate) fn latest_cell_state(
    connection: &Connection,
    x: i32,
    y: i32,
    layer: CellLayer,
) -> Result<Option<CellState>, AppError> {
    let result = connection.query_row(
        "SELECT value FROM cell_attributes WHERE grid_version = ?1 AND cell_x = ?2 AND cell_y = ?3 AND layer = ?4",
        params![GRID_VERSION, x, y, layer.as_str()],
        |row| Ok(CellState { value: row.get(0)? }),
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn apply_edit_operation(
    project: &mut OpenProject,
    operation: &EditOperation,
    forward: bool,
) -> Result<(), AppError> {
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    match operation {
        EditOperation::ProjectName { before, after } => {
            let name = if forward { after } else { before };
            if transaction
                .execute("UPDATE world SET name = ?1", [name])
                .map_err(AppError::from)?
                != 1
            {
                return Err(AppError::new(
                    "corrupt_project",
                    "The project must contain exactly one world record.",
                ));
            }
        }
        EditOperation::Settings { before, after } => {
            let settings_json = if forward { after } else { before };
            if transaction
                .execute("UPDATE world SET settings_json = ?1", [settings_json])
                .map_err(AppError::from)?
                != 1
            {
                return Err(AppError::new(
                    "corrupt_project",
                    "The project must contain exactly one world record.",
                ));
            }
        }
        EditOperation::Feature {
            feature_id,
            feature_type,
            before,
            after,
        } => {
            let state = if forward { after } else { before };
            match state {
                Some(state) => {
                    upsert_feature_state(&transaction, feature_id, *feature_type, state)?;
                }
                None => {
                    transaction
                        .execute("DELETE FROM features WHERE id = ?1", [feature_id])
                        .map_err(AppError::from)?;
                }
            }
        }
        EditOperation::FeatureBatch { changes } => {
            for change in changes {
                apply_feature_change(&transaction, change, forward)?;
            }
        }
        EditOperation::Asset {
            asset_id,
            before,
            after,
        } => {
            apply_asset_change(
                &transaction,
                &AssetEdit {
                    asset_id: asset_id.clone(),
                    before: before.clone(),
                    after: after.clone(),
                },
                forward,
            )?;
        }
        EditOperation::AssetBatch { changes } => {
            for change in changes {
                apply_asset_change(&transaction, change, forward)?;
            }
        }
        EditOperation::CellAttributes { changes } => {
            for change in changes {
                match if forward {
                    &change.after
                } else {
                    &change.before
                } {
                    Some(state) => {
                        transaction.execute(
                            "INSERT INTO cell_attributes(grid_version, cell_x, cell_y, layer, value) VALUES (?1,?2,?3,?4,?5)
                             ON CONFLICT(grid_version,cell_x,cell_y,layer) DO UPDATE SET value=excluded.value",
                            params![GRID_VERSION, change.x, change.y, change.layer.as_str(), state.value],
                        ).map_err(AppError::from)?;
                    }
                    None => {
                        transaction.execute("DELETE FROM cell_attributes WHERE grid_version=?1 AND cell_x=?2 AND cell_y=?3 AND layer=?4", params![GRID_VERSION, change.x, change.y, change.layer.as_str()]).map_err(AppError::from)?;
                    }
                }
            }
        }
    }
    transaction.commit().map_err(AppError::from)
}

fn apply_asset_change(
    transaction: &Transaction<'_>,
    change: &AssetEdit,
    forward: bool,
) -> Result<(), AppError> {
    let state = if forward {
        &change.after
    } else {
        &change.before
    };
    match state {
        Some(state) => upsert_asset_state(transaction, &change.asset_id, state),
        None => {
            if asset_is_referenced(transaction, &change.asset_id)? {
                return Err(AppError::new(
                    "asset_in_use",
                    "The asset is still referenced by a feature.",
                ));
            }
            transaction
                .execute("DELETE FROM assets WHERE id = ?1", [&change.asset_id])
                .map_err(AppError::from)?;
            Ok(())
        }
    }
}

fn apply_feature_change(
    transaction: &Transaction<'_>,
    change: &FeatureEdit,
    forward: bool,
) -> Result<(), AppError> {
    let state = if forward {
        &change.after
    } else {
        &change.before
    };
    match state {
        Some(state) => {
            upsert_feature_state(transaction, &change.feature_id, change.feature_type, state)
        }
        None => transaction
            .execute("DELETE FROM features WHERE id = ?1", [&change.feature_id])
            .map(|_| ())
            .map_err(AppError::from),
    }
}
