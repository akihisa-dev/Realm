use crate::contract::{
    AssetManifest, CellAttributeSnapshot, CellLayer, CellViewportInput, FeatureSnapshot,
    FeatureType, ProjectSnapshot, WorldSnapshot,
};
use crate::domain::cell::cell_id;
use crate::domain::geometry::{validate_geometry, validate_properties};
use crate::domain::settings::parse_stored_settings;
use crate::error::AppError;
use crate::state::OpenProject;
use crate::storage::schema::{CURRENT_SCHEMA_VERSION, GRID_COLUMNS, GRID_ROWS, GRID_VERSION};
use rusqlite::{Error as SqlError, params};
use serde_json::Value;

pub(crate) fn project_snapshot(project: &OpenProject) -> Result<ProjectSnapshot, AppError> {
    let world_count: i64 = project
        .connection
        .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    let (world_id, world_name, settings_json): (String, String, String) = project
        .connection
        .query_row(
            "SELECT id, name, settings_json FROM world LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => AppError::new(
                "corrupt_project",
                "The project does not contain a world record.",
            ),
            other => other.into(),
        })?;
    let settings = parse_stored_settings(&settings_json)?;
    let mut query = project.connection.prepare(
        "SELECT id, feature_type, name, geometry_json, properties_json FROM features ORDER BY feature_type, name, id"
    ).map_err(AppError::from)?;
    let rows = query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let features = rows
        .into_iter()
        .map(|(id, kind, name, geometry_json, properties_json)| {
            let geometry: Value = serde_json::from_str(&geometry_json).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid geometry.")
            })?;
            let feature_type = FeatureType::from_storage(&kind)?;
            validate_geometry(feature_type, &geometry).map_err(|_| {
                AppError::new(
                    "corrupt_project",
                    "A feature contains geometry that does not match its class.",
                )
            })?;
            let properties: Value = serde_json::from_str(&properties_json).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid properties.")
            })?;
            validate_properties(&properties).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid properties.")
            })?;
            Ok(FeatureSnapshot {
                id,
                feature_type,
                name,
                geometry,
                properties,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let feature_count = i64::try_from(features.len())
        .map_err(|_| AppError::new("storage_error", "The feature count is unavailable."))?;
    let assets = asset_manifests(project)?;
    Ok(ProjectSnapshot {
        format_version: CURRENT_SCHEMA_VERSION,
        path: project.path.to_string_lossy().into_owned(),
        world: WorldSnapshot {
            id: world_id,
            name: world_name,
        },
        settings,
        features,
        assets,
        feature_count,
        can_undo: !project.undo_stack.is_empty(),
        can_redo: !project.redo_stack.is_empty(),
    })
}

pub(crate) fn asset_manifests(project: &OpenProject) -> Result<Vec<AssetManifest>, AppError> {
    let mut query = project
        .connection
        .prepare(
            "SELECT id, sha256, mime, length(bytes), width, height, metadata_json
             FROM assets ORDER BY id",
        )
        .map_err(AppError::from)?;
    query
        .query_map([], |row| {
            let metadata_json: String = row.get(6)?;
            let metadata =
                serde_json::from_str(&metadata_json).map_err(|_| rusqlite::Error::InvalidQuery)?;
            let sha256: String = row.get(1)?;
            if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(rusqlite::Error::InvalidQuery);
            }
            Ok(AssetManifest {
                id: row.get(0)?,
                sha256,
                mime: row.get(2)?,
                byte_length: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                metadata,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub(crate) fn cell_attributes_snapshot(
    project: &OpenProject,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    let min_x = input.min_x.unwrap_or(0).max(0);
    let max_x = input
        .max_x
        .unwrap_or(GRID_COLUMNS - 1)
        .min(GRID_COLUMNS - 1);
    let min_y = input.min_y.unwrap_or(0).max(0);
    let max_y = input.max_y.unwrap_or(GRID_ROWS - 1).min(GRID_ROWS - 1);
    if min_x > max_x || min_y > max_y {
        return Err(AppError::invalid("The cell viewport is invalid."));
    }
    let mut query = project
        .connection
        .prepare(
            "SELECT cell_x, cell_y, layer, value FROM cell_attributes
         WHERE grid_version = ?1 AND cell_x BETWEEN ?2 AND ?3 AND cell_y BETWEEN ?4 AND ?5
         ORDER BY cell_y, cell_x, layer",
        )
        .map_err(AppError::from)?;
    query
        .query_map(params![GRID_VERSION, min_x, max_x, min_y, max_y], |row| {
            let layer = CellLayer::from_storage(&row.get::<_, String>(2)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(CellAttributeSnapshot {
                cell_id: cell_id(row.get(0)?, row.get(1)?),
                attribute: layer,
                value: row.get(3)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}
