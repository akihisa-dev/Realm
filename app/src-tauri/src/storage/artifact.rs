use crate::error::AppError;
use crate::storage::atomic::publish_new_project;
use crate::storage::path::path_with_canonical_parent;
use std::{
    fs,
    fs::OpenOptions,
    io::{self, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) const MAX_ARTIFACT_BYTES: usize = 50 * 1024 * 1024;

pub(crate) fn validated_artifact_path(raw: &str) -> Result<PathBuf, AppError> {
    let input = raw.trim();
    if input.is_empty() {
        return Err(AppError::invalid("An artifact path is required."));
    }
    let path = Path::new(input);
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("png") || value.eq_ignore_ascii_case("pdf"))
    {
        return Err(AppError::invalid(
            "Artifacts must use the .png or .pdf extension.",
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let metadata = fs::metadata(parent)
        .map_err(|_| AppError::new("invalid_path", "The artifact folder does not exist."))?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "invalid_path",
            "The artifact folder is not a directory.",
        ));
    }
    let candidate = path_with_canonical_parent(path)?;
    match fs::symlink_metadata(&candidate) {
        Ok(_) => Err(AppError::new(
            "already_exists",
            "An artifact already exists at that path.",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(candidate),
        Err(_) => Err(AppError::new(
            "invalid_path",
            "The artifact path could not be accessed.",
        )),
    }
}

#[tauri::command]
pub(crate) fn write_artifact(path: String, bytes: Vec<u8>) -> Result<(), AppError> {
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(AppError::invalid("The artifact is too large."));
    }
    let destination = validated_artifact_path(&path)?;
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let valid_bytes = if extension.eq_ignore_ascii_case("png") {
        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    } else {
        bytes.starts_with(b"%PDF-")
    };
    if !valid_bytes {
        return Err(AppError::invalid(
            "The artifact content does not match its file extension.",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "The artifact folder is unavailable."))?;
    let staged_path = parent.join(format!(".realm-artifact-{}.staging", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged_path)
            .map_err(|_| AppError::new("invalid_path", "The artifact could not be created."))?;
        file.write_all(&bytes)
            .map_err(|_| AppError::new("storage_error", "The artifact could not be written."))?;
        file.sync_all().map_err(|_| {
            AppError::new("storage_error", "The artifact could not be synchronized.")
        })?;
        publish_new_project(&staged_path, &destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged_path);
    }
    result
}
