use crate::contract::{
    ApplyCellAttributesInput, CellAttributeSnapshot, CellViewportInput, ProjectSnapshot,
};
use crate::domain::cell::{normalize_cell_ids, validate_cell_value};
use crate::edit::latest_cell_state;
use crate::error::AppError;
use crate::read_model::{cell_attributes_snapshot, project_snapshot};
use crate::state::{AppState, CellEditChange, CellState, EditOperation, lock_project};
use crate::storage::schema::GRID_VERSION;
use rusqlite::params;

pub(crate) fn apply_cell_attributes_in_state(
    state: &AppState,
    input: ApplyCellAttributesInput,
) -> Result<ProjectSnapshot, AppError> {
    let cells = normalize_cell_ids(input.cell_ids)?;
    validate_cell_value(input.value.as_deref())?;
    let value = input.value.map(|value| value.trim().to_owned());
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let changes = cells
        .into_iter()
        .map(|(x, y)| {
            Ok(CellEditChange {
                x,
                y,
                layer: input.attribute,
                before: latest_cell_state(&project.connection, x, y, input.attribute)?,
                after: value.clone().map(|value| CellState { value }),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        match &change.after {
            Some(after) => {
                transaction.execute(
                    "INSERT INTO cell_attributes(grid_version, cell_x, cell_y, layer, value)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(grid_version, cell_x, cell_y, layer) DO UPDATE SET value = excluded.value",
                    params![GRID_VERSION, change.x, change.y, change.layer.as_str(), after.value],
                ).map_err(AppError::from)?;
            }
            None => {
                transaction.execute(
                    "DELETE FROM cell_attributes WHERE grid_version = ?1 AND cell_x = ?2 AND cell_y = ?3 AND layer = ?4",
                    params![GRID_VERSION, change.x, change.y, change.layer.as_str()],
                ).map_err(AppError::from)?;
            }
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::CellAttributes { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn apply_cell_attributes(
    state: tauri::State<'_, AppState>,
    input: ApplyCellAttributesInput,
) -> Result<ProjectSnapshot, AppError> {
    apply_cell_attributes_in_state(state.inner(), input)
}

pub(crate) fn view_cell_attributes_in_state(
    state: &AppState,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    cell_attributes_snapshot(project, input)
}

#[tauri::command]
pub(crate) fn view_cell_attributes(
    state: tauri::State<'_, AppState>,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    view_cell_attributes_in_state(state.inner(), input)
}
