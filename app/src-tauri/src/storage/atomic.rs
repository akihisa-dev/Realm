use crate::error::AppError;
use std::{
    ffi::CString,
    fs,
    fs::File,
    io,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

pub(crate) fn remove_unpublished_project(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-journal", "-wal", "-shm"] {
        let _ = fs::remove_file(path_with_suffix(path, suffix));
    }
}

pub(crate) fn publish_new_project(staged_path: &Path, destination: &Path) -> Result<(), AppError> {
    let staged = CString::new(staged_path.as_os_str().as_bytes())
        .map_err(|_| AppError::new("invalid_path", "The project path is invalid."))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|_| AppError::new("invalid_path", "The project path is invalid."))?;

    // Both paths share a canonical parent. RENAME_EXCL publishes the complete database in one
    // directory operation and cannot replace a file created concurrently at the destination.
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            staged.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        return Ok(());
    }

    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::AlreadyExists {
        Err(AppError::new(
            "already_exists",
            "A project already exists at that path.",
        ))
    } else {
        Err(AppError::new(
            "invalid_path",
            "The project file could not be published safely.",
        ))
    }
}

pub(crate) fn copy_synced_file(
    source: &Path,
    destination: &Path,
    prefix: &str,
) -> Result<(), AppError> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "The destination folder is unavailable."))?;
    let staged_path = parent.join(format!(".{prefix}-{}.staging", Uuid::new_v4()));
    let result = (|| {
        fs::copy(source, &staged_path)
            .map_err(|_| AppError::new("storage_error", "The project file could not be copied."))?;
        File::open(&staged_path)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                AppError::new(
                    "storage_error",
                    "The project file could not be synchronized.",
                )
            })?;
        publish_new_project(&staged_path, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged_path);
    }
    result
}
