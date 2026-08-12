use crate::error::AppError;
use crate::state::OpenProject;
use crate::storage::atomic::AtomicPublisher;
use crate::storage::path::{
    path_with_canonical_parent, preflight_existing_project_with_connection,
};
use crate::storage::schema::{
    SCHEMA_VERSION_V3, SCHEMA_VERSION_V4, SCHEMA_VERSION_V5, SCHEMA_VERSION_V6, SCHEMA_VERSION_V7,
    configure_connection, initialize_new_schema, migrate_v3_to_v8, migrate_v4_to_v8,
    migrate_v5_to_v8, migrate_v6_to_v8, migrate_v7_to_v8, validate_existing_schema,
};
use rusqlite::{Connection, OpenFlags};
use std::ffi::CString;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) fn open_connection(path: &Path) -> Result<Connection, AppError> {
    open_connection_after_validation(path, |_| Ok(()))
}

pub(crate) fn sqlite_connection_has_moved(connection: &Connection) -> Result<(), AppError> {
    let main = CString::new("main").expect("static database name");
    let mut moved = 0_i32;
    let result = unsafe {
        rusqlite::ffi::sqlite3_file_control(
            connection.handle(),
            main.as_ptr(),
            rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED,
            (&mut moved as *mut i32).cast(),
        )
    };
    if result != rusqlite::ffi::SQLITE_OK || moved != 0 {
        return Err(AppError::new(
            "invalid_path",
            "The project file moved while it was being opened.",
        ));
    }
    Ok(())
}

fn open_connection_after_validation<F>(
    path: &Path,
    before_rw_open: F,
) -> Result<Connection, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError>,
{
    let validated = preflight_existing_project_with_connection(path)?;
    validated.ensure_current_identity()?;
    let path = validated.path().to_path_buf();
    let version = validated.version();
    before_rw_open(&path)?;
    let mut connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    // Re-check the validated file identity immediately after opening the writable handle. If a
    // caller replaced the path between read-only preflight and this open, do not migrate or
    // configure the replacement.
    validated.ensure_current_identity()?;
    sqlite_connection_has_moved(&connection)?;
    configure_connection(&connection)?;
    sqlite_connection_has_moved(&connection)?;
    // Keep the validated read-only handle alive through every migration boundary. Configure may
    // legitimately create SQLite journal sidecars, so identity is checked immediately before
    // this first mutating call and the handle remains held afterward.
    match version {
        SCHEMA_VERSION_V3 => {
            sqlite_connection_has_moved(&connection)?;
            migrate_v3_to_v8(&mut connection)?;
        }
        SCHEMA_VERSION_V4 => {
            sqlite_connection_has_moved(&connection)?;
            migrate_v4_to_v8(&mut connection)?;
        }
        SCHEMA_VERSION_V5 => {
            sqlite_connection_has_moved(&connection)?;
            migrate_v5_to_v8(&mut connection)?;
        }
        SCHEMA_VERSION_V6 => {
            sqlite_connection_has_moved(&connection)?;
            migrate_v6_to_v8(&mut connection)?;
        }
        _ => {}
    }
    if version == SCHEMA_VERSION_V7 {
        sqlite_connection_has_moved(&connection)?;
        migrate_v7_to_v8(&mut connection)?;
    }
    sqlite_connection_has_moved(&connection)?;
    validate_existing_schema(&connection)?;
    Ok(connection)
}

#[cfg(test)]
pub(crate) fn open_connection_after_validation_for_test<F>(
    path: &Path,
    before_rw_open: F,
) -> Result<Connection, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError>,
{
    open_connection_after_validation(path, before_rw_open)
}

pub(crate) fn create_project_inner(path: PathBuf, name: &str) -> Result<OpenProject, AppError> {
    let path = path_with_canonical_parent(&path)?;
    let world_id = Uuid::new_v4().to_string();
    let publisher = AtomicPublisher::new(&path, "realm-create")?;
    (|| {
        let staged_path = publisher.staged_path();
        publisher.validate_staged_identity()?;
        let _staged_handle = publisher.open_staged_read_write()?;

        let mut connection = Connection::open_with_flags(
            staged_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(AppError::from)?;
        publisher.validate_staged_identity()?;
        sqlite_connection_has_moved(&connection)?;
        initialize_new_schema(&mut connection, &world_id, name)?;
        publisher.validate_staged_identity()?;
        drop(connection);
        publisher.sync_staged_file()?;
        publisher.publish()?;

        let connection = open_connection(&path)?;
        Ok(OpenProject {
            path,
            connection,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        })
    })()
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
