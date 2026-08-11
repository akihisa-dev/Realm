use crate::error::AppError;
use crate::state::OpenProject;
use crate::storage::atomic::{publish_new_project, remove_unpublished_project};
use crate::storage::path::{path_with_canonical_parent, preflight_existing_project};
use crate::storage::schema::{
    SCHEMA_VERSION_V3, SCHEMA_VERSION_V4, SCHEMA_VERSION_V5, SCHEMA_VERSION_V6, SCHEMA_VERSION_V7,
    configure_connection, initialize_new_schema, migrate_v3_to_v8, migrate_v4_to_v8,
    migrate_v5_to_v8, migrate_v6_to_v8, migrate_v7_to_v8, validate_existing_schema,
};
use rusqlite::{Connection, OpenFlags};
use std::{
    fs::File,
    fs::OpenOptions,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(crate) fn open_connection(path: &Path) -> Result<Connection, AppError> {
    let (path, version) = preflight_existing_project(path)?;
    let mut connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    configure_connection(&connection)?;
    match version {
        SCHEMA_VERSION_V3 => {
            migrate_v3_to_v8(&mut connection)?;
        }
        SCHEMA_VERSION_V4 => migrate_v4_to_v8(&mut connection)?,
        SCHEMA_VERSION_V5 => migrate_v5_to_v8(&mut connection)?,
        SCHEMA_VERSION_V6 => migrate_v6_to_v8(&mut connection)?,
        _ => {}
    }
    if version == SCHEMA_VERSION_V7 {
        migrate_v7_to_v8(&mut connection)?;
    }
    validate_existing_schema(&connection)?;
    Ok(connection)
}

pub(crate) fn create_project_inner(path: PathBuf, name: &str) -> Result<OpenProject, AppError> {
    let path = path_with_canonical_parent(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "The project folder is invalid."))?;
    let staged_path = parent.join(format!(".realm-{}.creating", Uuid::new_v4()));
    let world_id = Uuid::new_v4().to_string();
    let created = (|| {
        let reservation = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged_path)
            .map_err(|_| AppError::new("invalid_path", "The project file could not be created."))?;
        drop(reservation);

        let mut connection = Connection::open_with_flags(
            &staged_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(AppError::from)?;
        initialize_new_schema(&mut connection, &world_id, name)?;
        drop(connection);

        File::open(&staged_path)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                AppError::new(
                    "storage_error",
                    "The project file could not be synchronized.",
                )
            })?;
        publish_new_project(&staged_path, &path)?;

        let connection = open_connection(&path)?;
        Ok(OpenProject {
            path,
            connection,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        })
    })();
    if created.is_err() {
        remove_unpublished_project(&staged_path);
    }
    created
}

pub(crate) fn create_open_project(path: PathBuf) -> Result<OpenProject, AppError> {
    let connection = open_connection(&path)?;
    Ok(OpenProject {
        path,
        connection,
        undo_stack: Vec::new(),
        redo_stack: Vec::new(),
    })
}
