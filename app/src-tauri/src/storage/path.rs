use crate::error::AppError;
use crate::storage::schema::validate_existing_schema_for_preflight;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    fs,
    fs::File,
    io::{self, Read},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) const PROJECT_EXTENSION: &str = "realmmap";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SidecarIdentity {
    file: FileIdentity,
    length: u64,
    modified: i64,
    digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SourceIdentity {
    file: FileIdentity,
    digest: [u8; 32],
    parent: FileIdentity,
    sidecars: [Option<SidecarIdentity>; 3],
}

/// A read-only, schema-validated project handle. Keeping this connection alive through a
/// transfer snapshot makes the preflight result and the SQLite backup refer to the same opened
/// file identity instead of reopening a path that could have been replaced in between.
pub(crate) struct ValidatedProject {
    path: PathBuf,
    version: i32,
    identity: SourceIdentity,
    connection: Connection,
    #[allow(dead_code)]
    snapshot_guard: PrivateSnapshotGuard,
}

impl ValidatedProject {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn version(&self) -> i32 {
        self.version
    }

    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }

    pub(crate) fn ensure_current_identity(&self) -> Result<(), AppError> {
        if source_identity(&self.path)? != self.identity {
            return Err(AppError::new(
                "invalid_path",
                "The project file changed while it was being copied.",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn snapshot_path_for_test(&self) -> &Path {
        &self.snapshot_guard.path
    }
}

fn digest_file(path: &Path) -> Result<[u8; 32], AppError> {
    let mut file = File::open(path)
        .map_err(|_| AppError::new("storage_error", "The project file could not be hashed."))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| AppError::new("storage_error", "The project file could not be hashed."))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().into())
}

#[allow(dead_code)]
fn remove_private_snapshot_if_owned(path: &Path, identity: &SourceIdentity) {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let Ok(parent_metadata) = fs::symlink_metadata(parent) else {
        return;
    };
    if !parent_metadata.file_type().is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.dev() != identity.parent.device
        || parent_metadata.ino() != identity.parent.inode
    {
        return;
    }
    let Ok(main_metadata) = fs::symlink_metadata(path) else {
        return;
    };
    let same_main = main_metadata.file_type().is_file()
        && !main_metadata.file_type().is_symlink()
        && main_metadata.dev() == identity.file.device
        && main_metadata.ino() == identity.file.inode;
    let same_sidecars = identity
        .sidecars
        .iter()
        .enumerate()
        .all(|(index, expected)| {
            let suffix = ["-journal", "-wal", "-shm"][index];
            let mut value = path.as_os_str().to_os_string();
            value.push(suffix);
            match (expected, fs::symlink_metadata(PathBuf::from(value))) {
                (None, Err(error)) if error.kind() == io::ErrorKind::NotFound => true,
                (Some(expected), Ok(metadata)) => {
                    metadata.file_type().is_file()
                        && !metadata.file_type().is_symlink()
                        && metadata.dev() == expected.file.device
                        && metadata.ino() == expected.file.inode
                }
                _ => false,
            }
        });
    let same_owned_files = same_main && same_sidecars;
    if same_owned_files {
        let _ = fs::remove_file(path);
        for suffix in ["-journal", "-wal", "-shm"] {
            let mut value = path.as_os_str().to_os_string();
            value.push(suffix);
            let _ = fs::remove_file(PathBuf::from(value));
        }
    }
}

#[derive(Debug)]
struct PrivateSnapshotGuard {
    path: PathBuf,
    main: Option<FileIdentity>,
    sidecars: [Option<FileIdentity>; 3],
}

impl PrivateSnapshotGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            main: None,
            sidecars: [None, None, None],
        }
    }

    fn record_main(&mut self) -> Result<(), AppError> {
        self.main = Some(file_identity(&self.path)?);
        Ok(())
    }

    fn record_sidecar(&mut self, index: usize, path: &Path) -> Result<(), AppError> {
        self.sidecars[index] = Some(file_identity(path)?);
        Ok(())
    }
}

impl Drop for PrivateSnapshotGuard {
    fn drop(&mut self) {
        let same_main = self.main.is_some_and(|expected| {
            fs::symlink_metadata(&self.path)
                .map(|metadata| {
                    metadata.file_type().is_file()
                        && !metadata.file_type().is_symlink()
                        && metadata.dev() == expected.device
                        && metadata.ino() == expected.inode
                })
                .unwrap_or(false)
        });
        if !same_main {
            return;
        }
        let same_sidecars = self.sidecars.iter().enumerate().all(|(index, expected)| {
            let suffix = ["-journal", "-wal", "-shm"][index];
            let mut value = self.path.as_os_str().to_os_string();
            value.push(suffix);
            match (expected, fs::symlink_metadata(PathBuf::from(value))) {
                (None, Err(error)) if error.kind() == io::ErrorKind::NotFound => true,
                (Some(expected), Ok(metadata)) => {
                    metadata.file_type().is_file()
                        && !metadata.file_type().is_symlink()
                        && metadata.dev() == expected.device
                        && metadata.ino() == expected.inode
                }
                _ => false,
            }
        });
        if !same_sidecars {
            return;
        }
        let _ = fs::remove_file(&self.path);
        for suffix in ["-journal", "-wal", "-shm"] {
            let mut value = self.path.as_os_str().to_os_string();
            value.push(suffix);
            let _ = fs::remove_file(PathBuf::from(value));
        }
    }
}

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

fn file_identity(path: &Path) -> Result<FileIdentity, AppError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| AppError::new("not_found", "The project file could not be found."))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "invalid_path",
            "The project path is not a regular file.",
        ));
    }
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

fn source_identity(path: &Path) -> Result<SourceIdentity, AppError> {
    let file = file_identity(path)?;
    let digest = digest_file(path)?;
    let parent_path = path.parent().unwrap_or_else(|| Path::new("."));
    let parent_metadata = fs::symlink_metadata(parent_path)
        .map_err(|_| AppError::new("invalid_path", "The project folder could not be accessed."))?;
    if !parent_metadata.file_type().is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "invalid_path",
            "The project folder is not a directory.",
        ));
    }
    let parent = FileIdentity {
        device: parent_metadata.dev(),
        inode: parent_metadata.ino(),
    };
    let sidecars = ["-journal", "-wal", "-shm"].map(|suffix| {
        let sidecar = {
            let mut value = path.as_os_str().to_os_string();
            value.push(suffix);
            PathBuf::from(value)
        };
        match fs::symlink_metadata(&sidecar) {
            Ok(metadata)
                if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
            {
                Ok(Some(SidecarIdentity {
                    file: FileIdentity {
                        device: metadata.dev(),
                        inode: metadata.ino(),
                    },
                    length: metadata.len(),
                    modified: metadata.mtime(),
                    digest: digest_file(&sidecar)?,
                }))
            }
            Ok(_) => Err(AppError::new(
                "invalid_path",
                "The project journal is not a regular file.",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(AppError::new(
                "invalid_path",
                "The project journal could not be accessed.",
            )),
        }
    });
    let sidecars = sidecars.into_iter().collect::<Result<Vec<_>, _>>()?;
    let sidecars: [Option<SidecarIdentity>; 3] = sidecars.try_into().map_err(|_| {
        AppError::new(
            "storage_error",
            "The project journals could not be inspected.",
        )
    })?;
    Ok(SourceIdentity {
        file,
        digest,
        parent,
        sidecars,
    })
}

fn copy_private_snapshot(source: &Path) -> Result<PrivateSnapshotGuard, AppError> {
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let snapshot = parent.join(format!(".realm-source-{}.staging", Uuid::new_v4()));
    let mut guard = PrivateSnapshotGuard::new(snapshot.clone());
    (|| {
        let mut source_file = File::open(source).map_err(|_| {
            AppError::new(
                "storage_error",
                "The project file could not be snapshotted.",
            )
        })?;
        let mut snapshot_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&snapshot)
            .map_err(|_| {
                AppError::new(
                    "storage_error",
                    "The project file could not be snapshotted.",
                )
            })?;
        guard.record_main()?;
        io::copy(&mut source_file, &mut snapshot_file).map_err(|_| {
            AppError::new(
                "storage_error",
                "The project file could not be snapshotted.",
            )
        })?;
        snapshot_file.sync_all().map_err(|_| {
            AppError::new(
                "storage_error",
                "The project file could not be snapshotted.",
            )
        })?;
        drop(snapshot_file);
        for suffix in ["-journal", "-wal", "-shm"] {
            let source_sidecar = {
                let mut value = source.as_os_str().to_os_string();
                value.push(suffix);
                PathBuf::from(value)
            };
            match fs::symlink_metadata(&source_sidecar) {
                Ok(metadata)
                    if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
                {
                    let mut source_file = File::open(&source_sidecar).map_err(|_| {
                        AppError::new(
                            "storage_error",
                            "The project journal could not be snapshotted.",
                        )
                    })?;
                    let mut value = snapshot.as_os_str().to_os_string();
                    value.push(suffix);
                    let mut snapshot_file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(PathBuf::from(value))
                        .map_err(|_| {
                            AppError::new(
                                "storage_error",
                                "The project journal could not be snapshotted.",
                            )
                        })?;
                    guard.record_sidecar(index_for_sidecar(suffix), &{
                        let mut value = snapshot.as_os_str().to_os_string();
                        value.push(suffix);
                        PathBuf::from(value)
                    })?;
                    io::copy(&mut source_file, &mut snapshot_file).map_err(|_| {
                        AppError::new(
                            "storage_error",
                            "The project journal could not be snapshotted.",
                        )
                    })?;
                    snapshot_file.sync_all().map_err(|_| {
                        AppError::new(
                            "storage_error",
                            "The project journal could not be snapshotted.",
                        )
                    })?;
                    drop(snapshot_file);
                }
                Ok(_) => {
                    return Err(AppError::new(
                        "invalid_path",
                        "The project journal is not a regular file.",
                    ));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => {
                    return Err(AppError::new(
                        "storage_error",
                        "The project journal could not be snapshotted.",
                    ));
                }
            }
        }
        Ok(guard)
    })()
}

fn index_for_sidecar(suffix: &str) -> usize {
    match suffix {
        "-journal" => 0,
        "-wal" => 1,
        "-shm" => 2,
        _ => unreachable!(),
    }
}

fn bundle_matches(source: &SourceIdentity, snapshot: &SourceIdentity) -> bool {
    source.digest == snapshot.digest
        && source
            .sidecars
            .iter()
            .zip(snapshot.sidecars.iter())
            .all(|(left, right)| match (left, right) {
                (Some(left), Some(right)) => left.digest == right.digest,
                (None, None) => true,
                _ => false,
            })
}

pub(crate) fn preflight_existing_project_with_connection(
    path: &Path,
) -> Result<ValidatedProject, AppError> {
    preflight_existing_project_with_connection_after_copy(path, |_| Ok(()))
}

fn preflight_existing_project_with_connection_after_copy<F>(
    path: &Path,
    after_copy: F,
) -> Result<ValidatedProject, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError>,
{
    let path = path_with_canonical_parent(path)?;
    let identity = source_identity(&path)?;
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
    let snapshot_guard = copy_private_snapshot(&path)?;
    let snapshot_path = snapshot_guard.path.clone();
    let snapshot_identity = source_identity(&snapshot_path)?;
    after_copy(&path)?;
    if source_identity(&path)? != identity {
        return Err(AppError::new(
            "invalid_path",
            "The project file changed while it was being inspected.",
        ));
    }
    if !bundle_matches(&identity, &snapshot_identity) {
        return Err(AppError::new(
            "invalid_path",
            "The project snapshot changed while it was being copied.",
        ));
    }
    let read_only = Connection::open_with_flags(
        &snapshot_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    (|| {
        // Reject a path replacement that happened between lstat/header inspection and open. The
        // open connection itself remains safe, but its preflight must not be attributed to
        // another file at the requested path.
        if source_identity(&path)? != identity {
            return Err(AppError::new(
                "invalid_path",
                "The project file changed while it was being inspected.",
            ));
        }
        let version = validate_existing_schema_for_preflight(&read_only)?;
        let world_count: i64 = read_only
            .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
            .map_err(AppError::from)?;
        if world_count != 1 {
            return Err(AppError::new(
                "corrupt_project",
                "The project must contain exactly one world record.",
            ));
        }
        Ok(ValidatedProject {
            path: path.clone(),
            version,
            identity: identity.clone(),
            connection: read_only,
            snapshot_guard,
        })
    })()
}

#[cfg(test)]
pub(crate) fn preflight_existing_project_with_connection_after_copy_for_test<F>(
    path: &Path,
    after_copy: F,
) -> Result<ValidatedProject, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError>,
{
    preflight_existing_project_with_connection_after_copy(path, after_copy)
}

pub(crate) fn preflight_existing_project(path: &Path) -> Result<(PathBuf, i32), AppError> {
    let validated = preflight_existing_project_with_connection(path)?;
    // Keep the public-in-module compatibility shape used by open/list tests and callers while
    // ensuring they all share the same validation implementation.
    Ok((validated.path.clone(), validated.version))
}
