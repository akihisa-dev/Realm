use crate::contract::ProjectSummary;
use crate::error::AppError;
use crate::storage::path::{PROJECT_EXTENSION, preflight_existing_project};
use rusqlite::{Connection, OpenFlags};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::Manager;
use uuid::Uuid;

pub(crate) fn app_library_directory(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "invalid_path",
            "The application data folder is unavailable.",
        )
    })?;
    fs::create_dir_all(&app_data).map_err(|_| {
        AppError::new(
            "invalid_path",
            "The application data folder is unavailable.",
        )
    })?;
    let app_data_metadata = fs::symlink_metadata(&app_data).map_err(|_| {
        AppError::new(
            "invalid_path",
            "The application data folder is unavailable.",
        )
    })?;
    if !app_data_metadata.file_type().is_dir() || app_data_metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "invalid_path",
            "The application data folder is unavailable.",
        ));
    }
    let worlds = app_data.join("worlds");
    fs::create_dir_all(&worlds)
        .map_err(|_| AppError::new("invalid_path", "The project library is unavailable."))?;
    let worlds_metadata = fs::symlink_metadata(&worlds)
        .map_err(|_| AppError::new("invalid_path", "The project library is unavailable."))?;
    if !worlds_metadata.file_type().is_dir() || worlds_metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "invalid_path",
            "The project library is unavailable.",
        ));
    }
    worlds
        .canonicalize()
        .map_err(|_| AppError::new("invalid_path", "The project library is unavailable."))
}

pub(crate) fn library_project_path(
    app: &tauri::AppHandle,
    library_id: &str,
) -> Result<(String, PathBuf), AppError> {
    let id = Uuid::parse_str(library_id.trim())
        .map_err(|_| AppError::invalid("The library project identifier is invalid."))?;
    let canonical_id = id.to_string();
    let path = app_library_directory(app)?.join(format!("{canonical_id}.{PROJECT_EXTENSION}"));
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err(AppError::new(
                "invalid_path",
                "The library project is not a regular file.",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(AppError::new(
                "not_found",
                "The library project could not be found.",
            ));
        }
        Err(_) => {
            return Err(AppError::new(
                "invalid_path",
                "The library project could not be accessed.",
            ));
        }
    }
    Ok((canonical_id, path))
}

pub(crate) fn project_summary_from_path(path: &Path) -> Result<ProjectSummary, AppError> {
    let library_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .map(|value| value.to_string())
        .ok_or_else(|| AppError::invalid("The library project identifier is invalid."))?;
    let (path, _) = preflight_existing_project(path)?;
    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    let name: String = connection
        .query_row("SELECT name FROM world LIMIT 1", [], |row| row.get(0))
        .map_err(AppError::from)?;
    Ok(ProjectSummary { library_id, name })
}
