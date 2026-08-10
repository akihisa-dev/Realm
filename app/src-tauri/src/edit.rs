use crate::contract::{CellLayer, FeatureType};
use crate::error::AppError;
use crate::state::{CellState, EditOperation, FeatureState, OpenProject};
use crate::storage::schema::GRID_VERSION;
use rusqlite::{Connection, Error as SqlError, Transaction, params};

pub(crate) fn feature_state(
    connection: &Connection,
    feature_id: &str,
) -> Result<Option<FeatureState>, AppError> {
    let result = connection.query_row(
        "SELECT name, geometry_json FROM features WHERE id = ?1",
        [feature_id],
        |row| {
            Ok(FeatureState {
                name: row.get(0)?,
                geometry_json: row.get(1)?,
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
        "INSERT INTO features(id, feature_type, name, geometry_json) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, geometry_json = excluded.geometry_json",
        params![feature_id, feature_type.as_str(), state.name, state.geometry_json],
    ).map_err(AppError::from)?;
    Ok(())
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
