use crate::contract::{
    CellAttributeSnapshot, CellLayer, CellViewportInput, FeatureSnapshot, FeatureType,
    ProjectSnapshot, WorldSnapshot,
};
use crate::domain::cell::cell_id;
use crate::domain::geometry::validate_geometry;
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
    let (world_id, world_name): (String, String) = project
        .connection
        .query_row("SELECT id, name FROM world LIMIT 1", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => AppError::new(
                "corrupt_project",
                "The project does not contain a world record.",
            ),
            other => other.into(),
        })?;
    let mut query = project.connection.prepare(
        "SELECT id, feature_type, name, geometry_json FROM features ORDER BY feature_type, name, id"
    ).map_err(AppError::from)?;
    let rows = query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let features = rows
        .into_iter()
        .map(|(id, kind, name, geometry_json)| {
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
            Ok(FeatureSnapshot {
                id,
                feature_type,
                name,
                geometry,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let feature_count = i64::try_from(features.len())
        .map_err(|_| AppError::new("storage_error", "The feature count is unavailable."))?;
    Ok(ProjectSnapshot {
        format_version: CURRENT_SCHEMA_VERSION,
        path: project.path.to_string_lossy().into_owned(),
        world: WorldSnapshot {
            id: world_id,
            name: world_name,
        },
        features,
        feature_count,
        can_undo: !project.undo_stack.is_empty(),
        can_redo: !project.redo_stack.is_empty(),
    })
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
