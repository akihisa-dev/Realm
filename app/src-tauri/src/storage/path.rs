use crate::error::AppError;
use crate::storage::schema::validate_existing_schema;
use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

pub(crate) const PROJECT_EXTENSION: &str = "realmmap";

pub(crate) fn path_with_canonical_parent(path: &Path) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| AppError::new("invalid_path", "The project folder could not be accessed."))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::invalid("A project file name is required."))?;
    Ok(canonical_parent.join(file_name))
}

pub(crate) fn validated_path(raw: &str, must_exist: bool) -> Result<PathBuf, AppError> {
    let input = raw.trim();
    if input.is_empty() {
        return Err(AppError::invalid("A project path is required."));
    }
    let path = Path::new(input);
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(PROJECT_EXTENSION))
    {
        return Err(AppError::invalid(
            "Project files must use the .realmmap extension.",
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent_metadata = fs::metadata(parent)
        .map_err(|_| AppError::new("invalid_path", "The project folder does not exist."))?;
    if !parent_metadata.is_dir() {
        return Err(AppError::new(
            "invalid_path",
            "The project folder is not a directory.",
        ));
    }
    let candidate = path_with_canonical_parent(path)?;

    match fs::symlink_metadata(&candidate) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() {
                return Err(AppError::new(
                    "invalid_path",
                    "The project path is not a regular file.",
                ));
            }
            if !must_exist {
                return Err(AppError::new(
                    "already_exists",
                    "A project already exists at that path.",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if must_exist {
                return Err(AppError::new(
                    "not_found",
                    "The project file could not be found.",
                ));
            }
        }
        Err(_) => {
            return Err(AppError::new(
                "invalid_path",
                "The project path could not be accessed.",
            ));
        }
    }
    Ok(candidate)
}

pub(crate) fn preflight_existing_project(path: &Path) -> Result<(PathBuf, i32), AppError> {
    let path = path_with_canonical_parent(path)?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| AppError::new("not_found", "The project file could not be found."))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "invalid_path",
            "The project path is not a regular file.",
        ));
    }
    let mut header = [0_u8; 16];
    File::open(&path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| AppError::new("corrupt_project", "The project file could not be read."))?;
    if &header != b"SQLite format 3\0" {
        return Err(AppError::new(
            "corrupt_project",
            "The project file is corrupt or not a Realm project.",
        ));
    }
    let read_only = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    validate_existing_schema(&read_only)?;
    let world_count: i64 = read_only
        .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    let version: i32 = read_only
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(AppError::from)?;
    Ok((path, version))
}
