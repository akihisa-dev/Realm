use crate::error::AppError;
#[cfg(test)]
use crate::storage::path::preflight_existing_project_with_connection;
use crate::storage::{path::ValidatedProject, project::sqlite_connection_has_moved};
use rusqlite::{Connection, OpenFlags, backup::Backup};
use std::{
    ffi::CString,
    fs,
    fs::{File, OpenOptions},
    io,
    mem::MaybeUninit,
    os::unix::ffi::OsStrExt,
    os::unix::fs::MetadataExt,
    os::unix::io::{AsRawFd, FromRawFd},
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[cfg(test)]
pub(crate) fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
pub(crate) fn publish_new_project(staged_path: &Path, destination: &Path) -> Result<(), AppError> {
    let staged_parent = staged_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "The staging folder is unavailable."))?;
    let destination_parent = destination
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "The destination folder is unavailable."))?;
    let staged_parent_meta = fs::symlink_metadata(staged_parent)
        .map_err(|_| AppError::new("invalid_path", "The staging folder is unavailable."))?;
    let destination_parent_meta = fs::symlink_metadata(destination_parent)
        .map_err(|_| AppError::new("invalid_path", "The destination folder is unavailable."))?;
    if staged_parent_meta.dev() != destination_parent_meta.dev()
        || staged_parent_meta.ino() != destination_parent_meta.ino()
        || !destination_parent_meta.file_type().is_dir()
    {
        return Err(AppError::new(
            "invalid_path",
            "The project paths must share a directory.",
        ));
    }
    let parent_dir = OpenOptions::new()
        .read(true)
        .open(destination_parent)
        .map_err(|_| {
            AppError::new(
                "invalid_path",
                "The destination folder could not be opened.",
            )
        })?;
    let staged_name = CString::new(
        staged_path
            .file_name()
            .ok_or_else(|| AppError::new("invalid_path", "The staging name is invalid."))?
            .as_bytes(),
    )
    .map_err(|_| AppError::new("invalid_path", "The staging name is invalid."))?;
    let destination_name = CString::new(
        destination
            .file_name()
            .ok_or_else(|| AppError::new("invalid_path", "The destination name is invalid."))?
            .as_bytes(),
    )
    .map_err(|_| AppError::new("invalid_path", "The destination name is invalid."))?;
    let staged_fd = unsafe {
        libc::openat(
            parent_dir.as_raw_fd(),
            staged_name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW,
        )
    };
    if staged_fd < 0 {
        return Err(AppError::new(
            "invalid_path",
            "The staging file could not be opened.",
        ));
    }
    let staged_file = unsafe { File::from_raw_fd(staged_fd) };
    let staged_meta = staged_file
        .metadata()
        .map_err(|_| AppError::new("storage_error", "The staging file could not be inspected."))?;
    if !staged_meta.file_type().is_file() {
        return Err(AppError::new(
            "invalid_path",
            "The staging file is not regular.",
        ));
    }
    staged_file.sync_all().map_err(|_| {
        AppError::new(
            "storage_error",
            "The project file could not be synchronized.",
        )
    })?;
    let result = unsafe {
        libc::renameatx_np(
            parent_dir.as_raw_fd(),
            staged_name.as_ptr(),
            parent_dir.as_raw_fd(),
            destination_name.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result != 0 {
        let error = io::Error::last_os_error();
        return Err(if error.kind() == io::ErrorKind::AlreadyExists {
            AppError::new("already_exists", "A project already exists at that path.")
        } else {
            AppError::new(
                "invalid_path",
                "The project file could not be published safely.",
            )
        });
    }
    parent_dir.sync_all().map_err(|_| {
        AppError::new(
            "published_durability_uncertain",
            "The project was published, but folder durability could not be confirmed.",
        )
    })
}

/// Owns a hidden destination sibling until its complete contents have been synchronized and
/// atomically published. Dropping an unpublished publisher removes the database and any SQLite
/// sidecars, so every create/import/export path gets the same failure cleanup.
pub(crate) struct AtomicPublisher {
    staged_path: PathBuf,
    staged_file: File,
    destination: PathBuf,
    parent_dir: File,
    staged_name: CString,
    destination_name: CString,
    published: bool,
    parent_device: u64,
    parent_inode: u64,
    staged_device: u64,
    staged_inode: u64,
}

impl AtomicPublisher {
    pub(crate) fn new(destination: &Path, prefix: &str) -> Result<Self, AppError> {
        let parent = destination.parent().ok_or_else(|| {
            AppError::new("invalid_path", "The destination folder is unavailable.")
        })?;
        let staged_path = parent.join(format!(".{prefix}-{}.staging", Uuid::new_v4()));
        let metadata = fs::symlink_metadata(parent)
            .map_err(|_| AppError::new("invalid_path", "The destination folder is unavailable."))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err(AppError::new(
                "invalid_path",
                "The destination folder is not a directory.",
            ));
        }
        let parent_dir = OpenOptions::new().read(true).open(parent).map_err(|_| {
            AppError::new(
                "invalid_path",
                "The destination folder could not be opened.",
            )
        })?;
        let staged_name = CString::new(
            staged_path
                .file_name()
                .ok_or_else(|| AppError::new("invalid_path", "The staging name is invalid."))?
                .as_bytes(),
        )
        .map_err(|_| AppError::new("invalid_path", "The staging name is invalid."))?;
        let destination_name = CString::new(
            destination
                .file_name()
                .ok_or_else(|| AppError::new("invalid_path", "The destination name is invalid."))?
                .as_bytes(),
        )
        .map_err(|_| AppError::new("invalid_path", "The destination name is invalid."))?;
        let created_fd = unsafe {
            libc::openat(
                parent_dir.as_raw_fd(),
                staged_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if created_fd < 0 {
            return Err(AppError::new(
                "invalid_path",
                "The project file could not be created.",
            ));
        }
        // The file is immediately owned by this publisher; all later SQLite opens use this
        // sibling path while publication itself remains relative to the pinned directory fd.
        let created_file = unsafe { File::from_raw_fd(created_fd) };
        let staged_metadata = created_file.metadata().map_err(|_| {
            AppError::new("storage_error", "The staging file could not be inspected.")
        })?;
        Ok(Self {
            staged_path,
            staged_file: created_file,
            destination: destination.to_path_buf(),
            parent_dir,
            staged_name,
            destination_name,
            published: false,
            parent_device: metadata.dev(),
            parent_inode: metadata.ino(),
            staged_device: staged_metadata.dev(),
            staged_inode: staged_metadata.ino(),
        })
    }

    pub(crate) fn staged_path(&self) -> &Path {
        &self.staged_path
    }

    pub(crate) fn validate_staged_identity(&self) -> Result<(), AppError> {
        let metadata = fs::symlink_metadata(&self.staged_path).map_err(|_| {
            AppError::new("invalid_path", "The staging file changed while publishing.")
        })?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.dev() != self.staged_device
            || metadata.ino() != self.staged_inode
        {
            return Err(AppError::new(
                "invalid_path",
                "The staging file changed while publishing.",
            ));
        }
        let held = self.staged_file.metadata().map_err(|_| {
            AppError::new("storage_error", "The staging file could not be inspected.")
        })?;
        if held.dev() != self.staged_device || held.ino() != self.staged_inode {
            return Err(AppError::new(
                "invalid_path",
                "The staging file changed while publishing.",
            ));
        }
        Ok(())
    }

    pub(crate) fn open_staged_read_write(&self) -> Result<File, AppError> {
        self.validate_staged_identity()?;
        let fd = unsafe {
            libc::openat(
                self.parent_dir.as_raw_fd(),
                self.staged_name.as_ptr(),
                libc::O_RDWR | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            return Err(AppError::new(
                "invalid_path",
                "The staging file changed while opening.",
            ));
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata().map_err(|_| {
            AppError::new("storage_error", "The staging file could not be inspected.")
        })?;
        if metadata.dev() != self.staged_device || metadata.ino() != self.staged_inode {
            return Err(AppError::new(
                "invalid_path",
                "The staging file changed while opening.",
            ));
        }
        Ok(file)
    }

    pub(crate) fn sync_staged_file(&self) -> Result<(), AppError> {
        self.validate_staged_identity()?;
        self.staged_file.sync_all().map_err(|_| {
            AppError::new(
                "storage_error",
                "The project file could not be synchronized.",
            )
        })
    }

    pub(crate) fn publish(self) -> Result<(), AppError> {
        self.publish_with_parent_sync(|_| Ok(()))
    }

    fn publish_with_parent_sync<F>(mut self, sync_parent: F) -> Result<(), AppError>
    where
        F: FnOnce(&Path) -> Result<(), AppError>,
    {
        self.ensure_parent_identity()?;
        let result = unsafe {
            libc::renameatx_np(
                self.parent_dir.as_raw_fd(),
                self.staged_name.as_ptr(),
                self.parent_dir.as_raw_fd(),
                self.destination_name.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        if result != 0 {
            let error = io::Error::last_os_error();
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                AppError::new("already_exists", "A project already exists at that path.")
            } else {
                AppError::new(
                    "invalid_path",
                    "The project file could not be published safely.",
                )
            });
        }
        // The no-replace rename is the publication point. A later directory-sync failure cannot
        // undo it; preserve the destination and report the durability error without attempting
        // unsafe cleanup of an already-published file.
        self.published = true;
        self.ensure_parent_identity().map_err(|_| {
            AppError::new(
                "published_durability_uncertain",
                "The project was published, but folder durability could not be confirmed.",
            )
        })?;
        self.parent_dir.sync_all().map_err(|_| {
            AppError::new(
                "published_durability_uncertain",
                "The project was published, but folder durability could not be confirmed.",
            )
        })?;
        self.ensure_parent_identity().map_err(|_| {
            AppError::new(
                "published_durability_uncertain",
                "The project was published, but folder durability could not be confirmed.",
            )
        })?;
        sync_parent(&self.destination).map_err(|_| {
            AppError::new(
                "published_durability_uncertain",
                "The project was published, but folder durability could not be confirmed.",
            )
        })
    }

    fn ensure_parent_identity(&self) -> Result<(), AppError> {
        let pinned = self.parent_dir.metadata().map_err(|_| {
            AppError::new(
                "invalid_path",
                "The destination folder could not be inspected.",
            )
        })?;
        let parent = self.destination.parent().ok_or_else(|| {
            AppError::new("invalid_path", "The destination folder is unavailable.")
        })?;
        let metadata = fs::symlink_metadata(parent)
            .map_err(|_| AppError::new("invalid_path", "The destination folder changed."))?;
        if pinned.dev() != self.parent_device
            || pinned.ino() != self.parent_inode
            || !pinned.file_type().is_dir()
            || metadata.dev() != self.parent_device
            || metadata.ino() != self.parent_inode
            || !metadata.file_type().is_dir()
            || metadata.file_type().is_symlink()
        {
            return Err(AppError::new(
                "invalid_path",
                "The destination folder changed while publishing.",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn publish_with_parent_sync_for_test<F>(self, sync_parent: F) -> Result<(), AppError>
    where
        F: FnOnce(&Path) -> Result<(), AppError>,
    {
        self.publish_with_parent_sync(sync_parent)
    }
}

impl Drop for AtomicPublisher {
    fn drop(&mut self) {
        if !self.published {
            let owned = unsafe {
                let mut stat = MaybeUninit::<libc::stat>::uninit();
                libc::fstatat(
                    self.parent_dir.as_raw_fd(),
                    self.staged_name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                ) == 0
                    && {
                        let stat = stat.assume_init();
                        (stat.st_mode & libc::S_IFMT) == libc::S_IFREG
                            && stat.st_dev as u64 == self.staged_device
                            && stat.st_ino == self.staged_inode
                    }
            };
            if owned {
                let _ = unsafe {
                    libc::unlinkat(self.parent_dir.as_raw_fd(), self.staged_name.as_ptr(), 0)
                };
                for suffix in ["-journal", "-wal", "-shm"] {
                    let mut value = self.staged_name.as_bytes().to_vec();
                    value.extend_from_slice(suffix.as_bytes());
                    if let Ok(name) = CString::new(value) {
                        let _ = unsafe {
                            libc::unlinkat(self.parent_dir.as_raw_fd(), name.as_ptr(), 0)
                        };
                    }
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn copy_synced_file(
    source: &Path,
    destination: &Path,
    prefix: &str,
) -> Result<(), AppError> {
    let publisher = AtomicPublisher::new(destination, prefix)?;
    fs::copy(source, publisher.staged_path())
        .map_err(|_| AppError::new("storage_error", "The project file could not be copied."))?;
    publisher.validate_staged_identity()?;
    publisher.sync_staged_file()?;
    publisher.publish()
}

/// Copy one logical SQLite snapshot without mutating the source or relying on its journal
/// sidecars. SQLite's online backup API reads the source's current snapshot, including any
/// committed WAL pages, and writes a self-contained destination database.
#[cfg(test)]
pub(crate) fn copy_sqlite_snapshot(
    source: &Path,
    destination: &Path,
    prefix: &str,
) -> Result<(), AppError> {
    let source = preflight_existing_project_with_connection(source)?;
    copy_sqlite_snapshot_from_validated(&source, destination, prefix)
}

pub(crate) fn copy_sqlite_snapshot_from_validated(
    source: &ValidatedProject,
    destination: &Path,
    prefix: &str,
) -> Result<(), AppError> {
    source.ensure_current_identity()?;
    let publisher = AtomicPublisher::new(destination, prefix)?;
    publisher.validate_staged_identity()?;
    let _staged_handle = publisher.open_staged_read_write()?;
    let backup_result = (|| {
        let mut destination_connection = Connection::open_with_flags(
            publisher.staged_path(),
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(AppError::from)?;
        publisher.validate_staged_identity()?;
        sqlite_connection_has_moved(&destination_connection)?;
        // Backup reads the already validated read-only connection. SQLite supplies a consistent
        // snapshot of committed WAL pages without copying or checkpointing source sidecars.
        let backup = Backup::new(source.connection(), &mut destination_connection)
            .map_err(AppError::from)?;
        backup
            .run_to_completion(100, std::time::Duration::from_millis(10), None)
            .map_err(AppError::from)
    })();
    backup_result?;
    sqlite_connection_has_moved(
        &Connection::open_with_flags(
            publisher.staged_path(),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(AppError::from)?,
    )?;
    publisher.validate_staged_identity()?;
    source.ensure_current_identity()?;
    publisher.sync_staged_file()?;
    publisher.publish()
}
