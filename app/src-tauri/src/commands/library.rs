use crate::contract::{ProjectSnapshot, ProjectSummary};
use crate::domain::geometry::validate_name;
use crate::error::AppError;
use crate::read_model::project_snapshot;
use crate::state::{AppState, OpenProject, lock_project};
use crate::storage::atomic::{copy_synced_file, remove_unpublished_project};
use crate::storage::library::{
    app_library_directory, library_project_path, project_summary_from_path,
};
use crate::storage::path::{PROJECT_EXTENSION, preflight_existing_project, validated_path};
use crate::storage::project::{create_open_project, create_project_inner, open_connection};
use std::{fs, fs::File};
use uuid::Uuid;

#[tauri::command]
pub(crate) fn create_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&name)?;
    let path =
        app_library_directory(&app)?.join(format!("{}.{}", Uuid::new_v4(), PROJECT_EXTENSION));
    let project = create_project_inner(path, &name)?;
    let snapshot = project_snapshot(&project)?;
    let mut open = lock_project(state.inner())?;
    *open = Some(project);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn open_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    library_id: String,
) -> Result<ProjectSnapshot, AppError> {
    let (_, path) = library_project_path(&app, &library_id)?;
    let connection = open_connection(&path)?;
    let project = OpenProject {
        path,
        connection,
        undo_stack: Vec::new(),
        redo_stack: Vec::new(),
    };
    let snapshot = project_snapshot(&project)?;
    let mut open = lock_project(state.inner())?;
    *open = Some(project);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, AppError> {
    let directory = app_library_directory(&app)?;
    let mut projects = Vec::new();
    let entries = fs::read_dir(&directory)
        .map_err(|_| AppError::new("storage_error", "The project library could not be read."))?;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            continue;
        }
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(PROJECT_EXTENSION))
        {
            continue;
        }
        // Ignore unrelated or corrupt files in the managed directory. A single bad file must
        // not prevent the library from showing the projects that can still be opened.
        if let Ok(summary) = project_summary_from_path(&path) {
            projects.push(summary);
        }
    }
    projects.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.library_id.cmp(&right.library_id))
    });
    Ok(projects)
}

#[tauri::command]
pub(crate) fn import_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ProjectSnapshot, AppError> {
    let source = validated_path(&path, true)?;
    // This is intentionally read-only: importing must never migrate or otherwise mutate the
    // selected external file. Legacy files are rejected by the copied open path as well.
    let (source, _) = preflight_existing_project(&source)?;
    let destination =
        app_library_directory(&app)?.join(format!("{}.{}", Uuid::new_v4(), PROJECT_EXTENSION));
    copy_synced_file(&source, &destination, "realm-import")?;
    let project = match create_open_project(destination.clone()) {
        Ok(project) => project,
        Err(error) => {
            remove_unpublished_project(&destination);
            return Err(error);
        }
    };
    let snapshot = match project_snapshot(&project) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let project_path = project.path.clone();
            drop(project);
            remove_unpublished_project(&project_path);
            return Err(error);
        }
    };
    let mut open = lock_project(state.inner())?;
    *open = Some(project);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn export_project(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    let destination = validated_path(&path, false)?;
    let open = lock_project(state.inner())?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    // Ensure a WAL-backed connection has checkpointed its committed pages before copying the
    // main database file. The command is a no-op for the normal DELETE journal mode.
    project
        .connection
        .execute_batch("PRAGMA wal_checkpoint(FULL)")
        .map_err(AppError::from)?;
    File::open(&project.path)
        .and_then(|file| file.sync_all())
        .map_err(|_| {
            AppError::new(
                "storage_error",
                "The project file could not be synchronized.",
            )
        })?;
    copy_synced_file(&project.path, &destination, "realm-export")
}
