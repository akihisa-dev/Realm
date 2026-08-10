use crate::contract::{ProjectSnapshot, SaveProjectInput, UpdateProjectSettingsInput};
use crate::domain::geometry::validate_name;
use crate::domain::settings::validate_settings;
use crate::edit::apply_edit_operation;
use crate::error::AppError;
use crate::read_model::project_snapshot;
use crate::state::{AppState, EditOperation, lock_project};

pub(crate) fn save_project_in_state(
    state: &AppState,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before: String = project
        .connection
        .query_row("SELECT name FROM world LIMIT 1", [], |row| row.get(0))
        .map_err(AppError::from)?;
    let after = input.name.trim().to_owned();
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    if transaction
        .execute("UPDATE world SET name = ?1", [&after])
        .map_err(AppError::from)?
        != 1
    {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    transaction.commit().map_err(AppError::from)?;
    if before != after {
        project
            .undo_stack
            .push(EditOperation::ProjectName { before, after });
        project.redo_stack.clear();
    }
    project_snapshot(project)
}

pub(crate) fn update_project_settings_in_state(
    state: &AppState,
    input: UpdateProjectSettingsInput,
) -> Result<ProjectSnapshot, AppError> {
    let after = validate_settings(&input.settings)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before: String = project
        .connection
        .query_row("SELECT settings_json FROM world LIMIT 1", [], |row| {
            row.get(0)
        })
        .map_err(AppError::from)?;
    if before != after {
        let transaction = project.connection.transaction().map_err(AppError::from)?;
        if transaction
            .execute("UPDATE world SET settings_json = ?1", [&after])
            .map_err(AppError::from)?
            != 1
        {
            return Err(AppError::new(
                "corrupt_project",
                "The project must contain exactly one world record.",
            ));
        }
        transaction.commit().map_err(AppError::from)?;
        project
            .undo_stack
            .push(EditOperation::Settings { before, after });
        project.redo_stack.clear();
    }
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn update_project_settings(
    state: tauri::State<'_, AppState>,
    input: UpdateProjectSettingsInput,
) -> Result<ProjectSnapshot, AppError> {
    update_project_settings_in_state(state.inner(), input)
}

#[tauri::command]
pub(crate) fn save_project(
    state: tauri::State<'_, AppState>,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    save_project_in_state(state.inner(), input)
}

pub(crate) fn undo_project_in_state(state: &AppState) -> Result<ProjectSnapshot, AppError> {
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let operation = project
        .undo_stack
        .pop()
        .ok_or_else(|| AppError::new("nothing_to_undo", "There is nothing to undo."))?;
    if let Err(error) = apply_edit_operation(project, &operation, false) {
        project.undo_stack.push(operation);
        return Err(error);
    }
    project.redo_stack.push(operation);
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn undo_project(state: tauri::State<'_, AppState>) -> Result<ProjectSnapshot, AppError> {
    undo_project_in_state(state.inner())
}

pub(crate) fn redo_project_in_state(state: &AppState) -> Result<ProjectSnapshot, AppError> {
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let operation = project
        .redo_stack
        .pop()
        .ok_or_else(|| AppError::new("nothing_to_redo", "There is nothing to redo."))?;
    if let Err(error) = apply_edit_operation(project, &operation, true) {
        project.redo_stack.push(operation);
        return Err(error);
    }
    project.undo_stack.push(operation);
    project_snapshot(project)
}

#[tauri::command]
pub(crate) fn redo_project(state: tauri::State<'_, AppState>) -> Result<ProjectSnapshot, AppError> {
    redo_project_in_state(state.inner())
}

pub(crate) fn close_project_in_state(state: &AppState) -> Result<(), AppError> {
    let mut open = lock_project(state)?;
    // Dropping the connection closes the current SQLite transaction and transient sidecars.
    let _ = open.take();
    Ok(())
}

#[tauri::command]
pub(crate) fn close_project(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    close_project_in_state(state.inner())
}

pub(crate) fn get_open_project_in_state(
    state: &AppState,
) -> Result<Option<ProjectSnapshot>, AppError> {
    let open = lock_project(state)?;
    open.as_ref().map(project_snapshot).transpose()
}

#[tauri::command]
pub(crate) fn get_open_project(
    state: tauri::State<'_, AppState>,
) -> Result<Option<ProjectSnapshot>, AppError> {
    get_open_project_in_state(state.inner())
}
