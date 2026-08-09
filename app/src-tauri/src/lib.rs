#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Realm 0.1.0 supports only Apple Silicon macOS targets.");

use std::{
    collections::HashSet,
    ffi::CString,
    fs,
    fs::{File, OpenOptions},
    io::{self, Read},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
};

use rusqlite::{Connection, Error as SqlError, ErrorCode, OpenFlags, Transaction, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const CURRENT_SCHEMA_VERSION: i32 = 1;
const PROJECT_EXTENSION: &str = "realmmap";

#[derive(Clone, Copy)]
struct ColumnExpectation {
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    primary_key: bool,
}

const fn column(
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    primary_key: bool,
) -> ColumnExpectation {
    ColumnExpectation {
        name,
        declared_type,
        not_null,
        primary_key,
    }
}

const SCHEMA_MIGRATION_COLUMNS: &[ColumnExpectation] = &[
    column("version", "INTEGER", false, true),
    column("applied_at", "TEXT", true, false),
];
const WORLD_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("name", "TEXT", true, false),
    column("current_year", "INTEGER", true, false),
];
const ERA_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("name", "TEXT", true, false),
    column("start_year", "INTEGER", true, false),
    column("end_year", "INTEGER", false, false),
];
const FEATURE_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("feature_type", "TEXT", true, false),
];
const FEATURE_REVISION_COLUMNS: &[ColumnExpectation] = &[
    column("id", "INTEGER", false, true),
    column("feature_id", "TEXT", true, false),
    column("valid_from_year", "INTEGER", true, false),
    column("sequence", "INTEGER", true, false),
    column("name", "TEXT", true, false),
    column("geometry_json", "TEXT", false, false),
    column("deleted", "INTEGER", true, false),
];
const TIMELINE_EVENT_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("title", "TEXT", true, false),
    column("description", "TEXT", true, false),
    column("start_year", "INTEGER", true, false),
    column("end_year", "INTEGER", false, false),
    column("sequence", "INTEGER", true, false),
];

/// Errors crossing the native/webview boundary are deliberately stable and do not include
/// SQL text, machine paths, or other implementation details.
#[derive(Debug, Error, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
        }
    }

    fn invalid(message: &str) -> Self {
        Self::new("invalid_input", message)
    }
}

impl From<SqlError> for AppError {
    fn from(error: SqlError) -> Self {
        match error {
            SqlError::SqliteFailure(details, _) => match details.code {
                ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => Self::new(
                    "corrupt_project",
                    "The project file is corrupt or not a Realm project.",
                ),
                ErrorCode::ConstraintViolation => {
                    Self::new("storage_constraint", "The project could not be updated.")
                }
                _ => Self::new("storage_error", "The project could not be read or written."),
            },
            _ => Self::new("storage_error", "The project could not be read or written."),
        }
    }
}

impl<T> From<PoisonError<T>> for AppError {
    fn from(_: PoisonError<T>) -> Self {
        Self::new(
            "state_unavailable",
            "The project state is temporarily unavailable.",
        )
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorldSnapshot {
    pub id: String,
    pub name: String,
    pub current_year: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EraSnapshot {
    pub id: String,
    pub name: String,
    pub start_year: i32,
    pub end_year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub format_version: i32,
    pub path: String,
    pub world: WorldSnapshot,
    pub eras: Vec<EraSnapshot>,
    pub feature_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEraInput {
    pub id: Option<String>,
    pub name: String,
    pub start_year: i32,
    pub end_year: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectInput {
    pub name: String,
    pub current_year: i32,
    pub eras: Vec<SaveEraInput>,
}

struct OpenProject {
    path: PathBuf,
    connection: Connection,
}

pub struct AppState {
    project: Mutex<Option<OpenProject>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(None),
        }
    }
}

fn lock_project(state: &AppState) -> Result<MutexGuard<'_, Option<OpenProject>>, AppError> {
    state.project.lock().map_err(AppError::from)
}

fn validate_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("A project name is required."));
    }
    if trimmed.chars().count() > 200 {
        return Err(AppError::invalid("The project name is too long."));
    }
    Ok(())
}

fn validate_year(year: i32) -> Result<(), AppError> {
    // i32 is the storage contract; no narrower range is imposed on fictional timelines.
    let _ = year;
    Ok(())
}

fn normalize_eras(eras: Vec<SaveEraInput>) -> Result<Vec<EraSnapshot>, AppError> {
    if eras.len() > 10_000 {
        return Err(AppError::invalid("The project contains too many eras."));
    }

    let mut ids = HashSet::with_capacity(eras.len());
    eras.into_iter()
        .map(|era| {
            validate_name(&era.name)?;
            validate_year(era.start_year)?;
            if let Some(end_year) = era.end_year {
                validate_year(end_year)?;
                if end_year < era.start_year {
                    return Err(AppError::invalid(
                        "An era end year cannot be earlier than its start year.",
                    ));
                }
            }
            let id = match era.id {
                Some(id) => Uuid::parse_str(id.trim())
                    .map_err(|_| AppError::invalid("An era identifier is invalid."))?
                    .to_string(),
                None => Uuid::new_v4().to_string(),
            };
            if !ids.insert(id.clone()) {
                return Err(AppError::invalid("Era identifiers must be unique."));
            }
            Ok(EraSnapshot {
                id,
                name: era.name.trim().to_owned(),
                start_year: era.start_year,
                end_year: era.end_year,
            })
        })
        .collect()
}

fn path_with_canonical_parent(path: &Path) -> Result<PathBuf, AppError> {
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

fn validated_path(raw: &str, must_exist: bool) -> Result<PathBuf, AppError> {
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

fn configure_connection(connection: &Connection) -> Result<(), AppError> {
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(AppError::from)?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(AppError::from)?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(AppError::from)?;
    Ok(())
}

fn configure_new_connection(connection: &Connection) -> Result<(), AppError> {
    configure_connection(connection)?;
    let journal_mode: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .map_err(AppError::from)?;
    if !journal_mode.eq_ignore_ascii_case("delete") {
        connection
            .pragma_update(None, "journal_mode", "DELETE")
            .map_err(AppError::from)?;
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(AppError::from)?;
        if !mode.eq_ignore_ascii_case("delete") {
            return Err(AppError::new(
                "storage_error",
                "The project storage mode is unavailable.",
            ));
        }
    }
    Ok(())
}

fn schema_sql(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS world (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            current_year INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS eras (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            start_year INTEGER NOT NULL,
            end_year INTEGER,
            CHECK (end_year IS NULL OR end_year >= start_year)
        );
        CREATE TABLE IF NOT EXISTS timeline_events (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            start_year INTEGER NOT NULL,
            end_year INTEGER,
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            CHECK (end_year IS NULL OR end_year >= start_year),
            UNIQUE (start_year, sequence)
        );
        CREATE INDEX IF NOT EXISTS timeline_events_range
            ON timeline_events(start_year, end_year, sequence);
        CREATE TABLE IF NOT EXISTS features (
            id TEXT PRIMARY KEY NOT NULL,
            feature_type TEXT NOT NULL CHECK (feature_type IN
                ('terrain','forest','river','coastline','country','region','boundary','city','town'))
        );
        CREATE TABLE IF NOT EXISTS feature_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature_id TEXT NOT NULL REFERENCES features(id),
            valid_from_year INTEGER NOT NULL,
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            name TEXT NOT NULL,
            geometry_json TEXT CHECK (geometry_json IS NULL OR json_valid(geometry_json)),
            deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
            UNIQUE (feature_id, valid_from_year, sequence)
        );
        CREATE INDEX IF NOT EXISTS feature_revisions_lookup
            ON feature_revisions(feature_id, valid_from_year DESC, sequence DESC);
        CREATE INDEX IF NOT EXISTS feature_revisions_year
            ON feature_revisions(valid_from_year, sequence);
        CREATE TRIGGER IF NOT EXISTS feature_revision_sequence_monotonic
        BEFORE INSERT ON feature_revisions
        WHEN EXISTS (
            SELECT 1 FROM feature_revisions AS previous
            WHERE previous.feature_id = NEW.feature_id
              AND previous.valid_from_year = NEW.valid_from_year
              AND NEW.sequence <= previous.sequence
        )
        BEGIN
            SELECT RAISE(ABORT, 'revision sequence must increase');
        END;
        CREATE TRIGGER IF NOT EXISTS feature_revision_no_update
        BEFORE UPDATE ON feature_revisions
        BEGIN
            SELECT RAISE(ABORT, 'feature revisions are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS feature_revision_no_delete
        BEFORE DELETE ON feature_revisions
        BEGIN
            SELECT RAISE(ABORT, 'feature revisions are append-only');
        END;
        /* Geometry is GeoJSON in EPSG:4326; revisions are append-only and deletions are states. */
        ",
    )
    .map_err(AppError::from)
}

fn initialize_schema_transaction(
    transaction: &Transaction<'_>,
    world_id: &str,
    world_name: &str,
) -> Result<(), AppError> {
    let user_version: i32 = transaction
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::from)?;
    let table_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    if user_version != 0 || table_count != 0 {
        return Err(AppError::new(
            "storage_error",
            "A new project could not be initialized safely.",
        ));
    }
    schema_sql(transaction)?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(version) VALUES (?1)",
            [CURRENT_SCHEMA_VERSION],
        )
        .map_err(AppError::from)?;
    transaction
        .execute_batch("PRAGMA user_version = 1;")
        .map_err(AppError::from)?;
    transaction
        .execute(
            "INSERT INTO world(id, name, current_year) VALUES (?1, ?2, 0)",
            params![world_id, world_name.trim()],
        )
        .map_err(AppError::from)?;
    verify_schema(transaction)?;
    Ok(())
}

fn initialize_new_schema(
    connection: &mut Connection,
    world_id: &str,
    world_name: &str,
) -> Result<(), AppError> {
    configure_new_connection(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    initialize_schema_transaction(&transaction, world_id, world_name)?;
    transaction.commit().map_err(AppError::from)?;
    validate_existing_schema(connection)
}

fn corrupt_schema() -> AppError {
    AppError::new("corrupt_project", "The project schema is incomplete.")
}

fn normalized_object_sql(
    connection: &Connection,
    object_type: &str,
    name: &str,
) -> Result<String, AppError> {
    let sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2 AND sql IS NOT NULL",
            params![object_type, name],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => corrupt_schema(),
            other => other.into(),
        })?;
    Ok(sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase())
}

fn index_columns(connection: &Connection, index: &str) -> Result<Vec<String>, AppError> {
    let pragma = format!("PRAGMA index_info({index})");
    let mut statement = connection.prepare(&pragma).map_err(AppError::from)?;
    statement
        .query_map([], |row| row.get::<_, String>(2))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

fn verify_schema(connection: &Connection) -> Result<(), AppError> {
    let required_columns = [
        ("schema_migrations", SCHEMA_MIGRATION_COLUMNS),
        ("world", WORLD_COLUMNS),
        ("eras", ERA_COLUMNS),
        ("timeline_events", TIMELINE_EVENT_COLUMNS),
        ("features", FEATURE_COLUMNS),
        ("feature_revisions", FEATURE_REVISION_COLUMNS),
    ];
    for (table, expected) in required_columns {
        let pragma = format!("PRAGMA table_info({table})");
        let mut statement = connection.prepare(&pragma).map_err(AppError::from)?;
        let found = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, i64>(5)? != 0,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        if found.len() != expected.len()
            || found.iter().zip(expected).any(
                |((name, declared_type, not_null, primary_key), expected)| {
                    name != expected.name
                        || !declared_type.eq_ignore_ascii_case(expected.declared_type)
                        || *not_null != expected.not_null
                        || *primary_key != expected.primary_key
                },
            )
        {
            return Err(corrupt_schema());
        }
    }

    let era_sql = normalized_object_sql(connection, "table", "eras")?;
    if !era_sql.contains("check (end_year is null or end_year >= start_year)") {
        return Err(corrupt_schema());
    }
    let feature_sql = normalized_object_sql(connection, "table", "features")?;
    for feature_type in [
        "'terrain'",
        "'forest'",
        "'river'",
        "'coastline'",
        "'country'",
        "'region'",
        "'boundary'",
        "'city'",
        "'town'",
    ] {
        if !feature_sql.contains(feature_type) {
            return Err(corrupt_schema());
        }
    }
    let timeline_sql = normalized_object_sql(connection, "table", "timeline_events")?;
    for invariant in [
        "check (sequence >= 0)",
        "check (end_year is null or end_year >= start_year)",
        "unique (start_year, sequence)",
    ] {
        if !timeline_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    let revision_sql = normalized_object_sql(connection, "table", "feature_revisions")?;
    for invariant in [
        "check (sequence >= 0)",
        "check (geometry_json is null or json_valid(geometry_json))",
        "check (deleted in (0, 1))",
        "unique (feature_id, valid_from_year, sequence)",
    ] {
        if !revision_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }

    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_list(feature_revisions)")
        .map_err(AppError::from)?;
    let foreign_keys = foreign_keys
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    if foreign_keys
        != vec![(
            "features".to_owned(),
            "feature_id".to_owned(),
            "id".to_owned(),
            "NO ACTION".to_owned(),
            "NO ACTION".to_owned(),
        )]
    {
        return Err(corrupt_schema());
    }

    for (index, expected) in [
        (
            "feature_revisions_lookup",
            &["feature_id", "valid_from_year", "sequence"][..],
        ),
        (
            "feature_revisions_year",
            &["valid_from_year", "sequence"][..],
        ),
        (
            "timeline_events_range",
            &["start_year", "end_year", "sequence"][..],
        ),
    ] {
        if index_columns(connection, index)? != expected {
            return Err(corrupt_schema());
        }
    }

    for (trigger, invariants) in [
        (
            "feature_revision_sequence_monotonic",
            &[
                "before insert on feature_revisions",
                "previous.feature_id = new.feature_id",
                "previous.valid_from_year = new.valid_from_year",
                "new.sequence <= previous.sequence",
            ][..],
        ),
        (
            "feature_revision_no_update",
            &[
                "before update on feature_revisions",
                "feature revisions are append-only",
            ][..],
        ),
        (
            "feature_revision_no_delete",
            &[
                "before delete on feature_revisions",
                "feature revisions are append-only",
            ][..],
        ),
    ] {
        let sql = normalized_object_sql(connection, "trigger", trigger)?;
        if invariants.iter().any(|invariant| !sql.contains(invariant)) {
            return Err(corrupt_schema());
        }
    }
    Ok(())
}

fn project_snapshot(project: &OpenProject) -> Result<ProjectSnapshot, AppError> {
    let world_count: i64 = project
        .connection
        .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    let (world_id, world_name, current_year): (String, String, i32) = project
        .connection
        .query_row(
            "SELECT id, name, current_year FROM world LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => AppError::new(
                "corrupt_project",
                "The project does not contain a world record.",
            ),
            other => other.into(),
        })?;
    let mut era_query = project
        .connection
        .prepare("SELECT id, name, start_year, end_year FROM eras ORDER BY start_year, id")
        .map_err(AppError::from)?;
    let eras = era_query
        .query_map([], |row| {
            Ok(EraSnapshot {
                id: row.get(0)?,
                name: row.get(1)?,
                start_year: row.get(2)?,
                end_year: row.get(3)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let feature_count: i64 = project
        .connection
        .query_row(
            "
            SELECT COUNT(*) FROM features AS f
            WHERE EXISTS (
                SELECT 1 FROM feature_revisions AS r
                WHERE r.feature_id = f.id AND r.valid_from_year <= ?1
                ORDER BY r.valid_from_year DESC, r.sequence DESC
                LIMIT 1
            ) AND COALESCE((
                SELECT r.deleted FROM feature_revisions AS r
                WHERE r.feature_id = f.id AND r.valid_from_year <= ?1
                ORDER BY r.valid_from_year DESC, r.sequence DESC
                LIMIT 1
            ), 0) = 0
            ",
            [current_year],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;

    Ok(ProjectSnapshot {
        format_version: CURRENT_SCHEMA_VERSION,
        path: project.path.to_string_lossy().into_owned(),
        world: WorldSnapshot {
            id: world_id,
            name: world_name,
            current_year,
        },
        eras,
        feature_count,
    })
}

fn validate_existing_schema(connection: &Connection) -> Result<(), AppError> {
    let integrity: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(AppError::new(
            "corrupt_project",
            "The project file is corrupt or not a Realm project.",
        ));
    }

    let migrations_table: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'schema_migrations'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    if !migrations_table {
        return Err(AppError::new(
            "corrupt_project",
            "The project file does not contain a Realm schema.",
        ));
    }

    let user_version: i32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(AppError::from)?;
    let recorded_version: Option<i32> = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .map_err(AppError::from)?;
    let recorded_version = recorded_version.ok_or_else(|| {
        AppError::new("corrupt_project", "The project schema version is missing.")
    })?;
    if user_version > CURRENT_SCHEMA_VERSION || recorded_version > CURRENT_SCHEMA_VERSION {
        return Err(AppError::new(
            "future_schema",
            "This project was created by a newer version of Realm.",
        ));
    }
    if user_version != recorded_version {
        return Err(AppError::new(
            "corrupt_project",
            "The project schema versions do not agree.",
        ));
    }
    if user_version != CURRENT_SCHEMA_VERSION {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses an unsupported older Realm format.",
        ));
    }

    verify_schema(connection)?;
    let world_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    Ok(())
}

fn open_connection(path: &Path) -> Result<Connection, AppError> {
    let path = path_with_canonical_parent(path)?;
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
    drop(read_only);

    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    configure_connection(&connection)?;
    validate_existing_schema(&connection)?;
    Ok(connection)
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn remove_unpublished_project(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-journal", "-wal", "-shm"] {
        let _ = fs::remove_file(path_with_suffix(path, suffix));
    }
}

fn publish_new_project(staged_path: &Path, destination: &Path) -> Result<(), AppError> {
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

fn create_project_inner(path: PathBuf, name: &str) -> Result<OpenProject, AppError> {
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
        Ok(OpenProject { path, connection })
    })();
    if created.is_err() {
        remove_unpublished_project(&staged_path);
    }
    created
}

#[tauri::command]
fn create_project(
    state: tauri::State<'_, AppState>,
    path: String,
    name: String,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&name)?;
    let path = validated_path(&path, false)?;
    let project = create_project_inner(path, &name)?;
    let snapshot = project_snapshot(&project)?;
    let mut open = lock_project(state.inner())?;
    *open = Some(project);
    Ok(snapshot)
}

#[tauri::command]
fn open_project(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ProjectSnapshot, AppError> {
    let path = validated_path(&path, true)?;
    let connection = open_connection(&path)?;
    let project = OpenProject { path, connection };
    let snapshot = project_snapshot(&project)?;
    let mut open = lock_project(state.inner())?;
    *open = Some(project);
    Ok(snapshot)
}

fn save_project_in_state(
    state: &AppState,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    validate_year(input.current_year)?;
    let eras = normalize_eras(input.eras)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    let (world_id, world_count): (String, i64) = transaction
        .query_row("SELECT MIN(id), COUNT(*) FROM world", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    let updated = transaction
        .execute(
            "UPDATE world SET name = ?1, current_year = ?2 WHERE id = ?3",
            params![input.name.trim(), input.current_year, world_id],
        )
        .map_err(AppError::from)?;
    if updated != 1 {
        return Err(AppError::new(
            "storage_error",
            "The project world could not be updated.",
        ));
    }
    transaction
        .execute("DELETE FROM eras", [])
        .map_err(AppError::from)?;
    for era in eras {
        transaction
            .execute(
                "INSERT INTO eras(id, name, start_year, end_year) VALUES (?1, ?2, ?3, ?4)",
                params![era.id, era.name, era.start_year, era.end_year],
            )
            .map_err(AppError::from)?;
    }
    transaction.commit().map_err(AppError::from)?;
    project_snapshot(project)
}

#[tauri::command]
fn save_project(
    state: tauri::State<'_, AppState>,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    save_project_in_state(state.inner(), input)
}

fn close_project_in_state(state: &AppState) -> Result<(), AppError> {
    let mut open = lock_project(state)?;
    // Dropping the connection closes the current SQLite transaction and transient sidecars.
    let _ = open.take();
    Ok(())
}

#[tauri::command]
fn close_project(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    close_project_in_state(state.inner())
}

fn get_open_project_in_state(state: &AppState) -> Result<Option<ProjectSnapshot>, AppError> {
    let open = lock_project(state)?;
    open.as_ref().map(project_snapshot).transpose()
}

#[tauri::command]
fn get_open_project(
    state: tauri::State<'_, AppState>,
) -> Result<Option<ProjectSnapshot>, AppError> {
    get_open_project_in_state(state.inner())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project,
            close_project,
            get_open_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running Realm");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn direct_state() -> AppState {
        AppState::default()
    }

    fn create(path: &Path, name: &str) -> Result<ProjectSnapshot, AppError> {
        let project = create_project_inner(path.to_path_buf(), name)?;
        project_snapshot(&project)
    }

    #[test]
    fn creates_empty_project_with_stable_world_id() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("world.realmmap");
        let first = create(&path, "World").unwrap();
        let second = open_connection(&path).unwrap();
        let opened = project_snapshot(&OpenProject {
            path: path.clone(),
            connection: second,
        })
        .unwrap();
        assert_eq!(first.world.id, opened.world.id);
        assert_eq!(first.feature_count, 0);
        assert_eq!(first.format_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn schema_and_world_initialization_roll_back_together() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("rollback.realmmap");
        let mut connection = Connection::open(&path).unwrap();
        configure_new_connection(&connection).unwrap();
        {
            let transaction = connection.transaction().unwrap();
            initialize_schema_transaction(&transaction, &Uuid::new_v4().to_string(), "Rollback")
                .unwrap();
            let world_count: i64 = transaction
                .query_row("SELECT COUNT(*) FROM world", [], |row| row.get(0))
                .unwrap();
            assert_eq!(world_count, 1);
            // Dropping without commit represents any failure after both schema and world writes.
        }
        let has_world: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='world')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let user_version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert!(!has_world);
        assert_eq!(user_version, 0);
    }

    #[test]
    fn atomic_publication_never_replaces_an_existing_file() {
        let directory = tempdir().unwrap();
        let staged = directory.path().join(".staged.creating");
        let destination = directory.path().join("world.realmmap");
        fs::write(&staged, b"complete project").unwrap();
        fs::write(&destination, b"existing project").unwrap();

        let error = publish_new_project(&staged, &destination).unwrap_err();
        assert_eq!(error.code, "already_exists");
        assert_eq!(fs::read(&destination).unwrap(), b"existing project");
        assert_eq!(fs::read(&staged).unwrap(), b"complete project");

        fs::remove_file(&destination).unwrap();
        publish_new_project(&staged, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"complete project");
        assert!(!staged.exists());
    }

    #[test]
    fn schema_has_revision_and_era_tables_and_delete_journal() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("schema.realmmap");
        let _ = create(&path, "Schema").unwrap();
        let connection = Connection::open(&path).unwrap();
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_ascii_lowercase(), "delete");
        for table in [
            "schema_migrations",
            "world",
            "eras",
            "timeline_events",
            "features",
            "feature_revisions",
        ] {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "missing table {table}");
        }
    }

    #[test]
    fn future_schema_is_rejected_without_changing_existing_journal_mode() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("future.realmmap");
        let _ = create(&path, "Future").unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection.pragma_update(None, "user_version", 999).unwrap();
        drop(connection);
        let error = open_connection(&path).unwrap_err();
        assert_eq!(error.code, "future_schema");
        assert!(path.is_file());
        let connection = Connection::open(&path).unwrap();
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn rejects_version_mismatch_and_partial_sqlite_without_migrating_them() {
        let directory = tempdir().unwrap();
        let mismatch = directory.path().join("mismatch.realmmap");
        let _ = create(&mismatch, "Mismatch").unwrap();
        let connection = Connection::open(&mismatch).unwrap();
        connection.pragma_update(None, "user_version", 0).unwrap();
        drop(connection);
        assert_eq!(
            open_connection(&mismatch).unwrap_err().code,
            "corrupt_project"
        );

        let partial = directory.path().join("partial.realmmap");
        let connection = Connection::open(&partial).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE world(id TEXT PRIMARY KEY, name TEXT, current_year INTEGER);",
            )
            .unwrap();
        drop(connection);
        assert_eq!(
            open_connection(&partial).unwrap_err().code,
            "corrupt_project"
        );
        let connection = Connection::open(&partial).unwrap();
        let has_eras: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='eras')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_eras);

        let weakened = directory.path().join("weakened.realmmap");
        let _ = create(&weakened, "Weakened").unwrap();
        let connection = Connection::open(&weakened).unwrap();
        connection
            .execute_batch(
                "DROP TABLE eras;
                 CREATE TABLE eras(
                   id TEXT PRIMARY KEY NOT NULL,
                   name TEXT NOT NULL,
                   start_year INTEGER NOT NULL,
                   end_year INTEGER
                 );",
            )
            .unwrap();
        drop(connection);
        assert_eq!(
            open_connection(&weakened).unwrap_err().code,
            "corrupt_project"
        );
    }

    #[test]
    fn path_validation_rejects_wrong_extension_missing_parent_and_directory() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        assert_eq!(
            validated_path("bad.sqlite", true).unwrap_err().code,
            "invalid_input"
        );
        assert_eq!(
            validated_path(
                &directory
                    .path()
                    .join("missing/world.realmmap")
                    .to_string_lossy(),
                false
            )
            .unwrap_err()
            .code,
            "invalid_path"
        );
        let dir_path = directory.path().join("folder.realmmap");
        fs::create_dir(&dir_path).unwrap();
        assert_eq!(
            validated_path(&dir_path.to_string_lossy(), true)
                .unwrap_err()
                .code,
            "invalid_path"
        );
        let uppercase = directory.path().join("WORLD.REALMMAP");
        let validated_uppercase = validated_path(&uppercase.to_string_lossy(), false).unwrap();
        assert_eq!(validated_uppercase.file_name(), uppercase.file_name());
        assert_eq!(
            validated_uppercase.parent(),
            Some(directory.path().canonicalize().unwrap().as_path())
        );
        let source = directory.path().join("source.realmmap");
        fs::write(&source, b"not a project").unwrap();
        let linked = directory.path().join("linked.realmmap");
        symlink(&source, &linked).unwrap();
        assert_eq!(
            validated_path(&linked.to_string_lossy(), true)
                .unwrap_err()
                .code,
            "invalid_path"
        );
    }

    #[test]
    fn save_is_transactional_and_updates_snapshot() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.realmmap");
        let state = direct_state();
        let project = create_project_inner(path.clone(), "Before").unwrap();
        *state.project.lock().unwrap() = Some(project);
        let snapshot = save_project_in_state(
            &state,
            SaveProjectInput {
                name: "After".into(),
                current_year: 1234,
                eras: vec![SaveEraInput {
                    id: None,
                    name: "First Era".into(),
                    start_year: 1000,
                    end_year: Some(1500),
                }],
            },
        )
        .unwrap();
        assert_eq!(snapshot.world.name, "After");
        assert_eq!(snapshot.world.current_year, 1234);
        assert_eq!(snapshot.eras.len(), 1);
        assert!(Uuid::parse_str(&snapshot.eras[0].id).is_ok());
        let era_id = snapshot.eras[0].id.clone();
        let failed = save_project_in_state(
            &state,
            SaveProjectInput {
                name: "".into(),
                current_year: 0,
                eras: vec![],
            },
        )
        .unwrap_err();
        assert_eq!(failed.code, "invalid_input");
        let current = get_open_project_in_state(&state).unwrap().unwrap();
        assert_eq!(current.world.name, "After");
        assert_eq!(current.world.current_year, 1234);
        assert_eq!(current.eras[0].id, era_id);

        close_project_in_state(&state).unwrap();
        let reopened = OpenProject {
            path: path.clone(),
            connection: open_connection(&path).unwrap(),
        };
        let reopened = project_snapshot(&reopened).unwrap();
        assert_eq!(reopened.world.current_year, 1234);
        assert_eq!(reopened.eras[0].id, era_id);
    }

    #[test]
    fn snapshot_uses_year_revision_order_and_eras() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("history.realmmap");
        let mut project = create_project_inner(path.clone(), "History").unwrap();
        let feature_id = Uuid::new_v4().to_string();
        let era_id = Uuid::new_v4().to_string();
        let transaction = project.connection.transaction().unwrap();
        transaction
            .execute(
                "INSERT INTO features(id, feature_type) VALUES (?1, 'city')",
                [&feature_id],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO feature_revisions(feature_id, valid_from_year, sequence, name, deleted)
                 VALUES (?1, 100, 0, 'Old', 0)",
                [&feature_id],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO feature_revisions(feature_id, valid_from_year, sequence, name, deleted)
                 VALUES (?1, 100, 1, 'Removed', 1)",
                [&feature_id],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO eras(id, name, start_year, end_year) VALUES (?1, 'First Era', 0, 500)",
                [&era_id],
            )
            .unwrap();
        transaction
            .execute("UPDATE world SET current_year = 100", [])
            .unwrap();
        transaction.commit().unwrap();
        let snapshot = project_snapshot(&project).unwrap();
        assert_eq!(snapshot.feature_count, 0);
        assert_eq!(snapshot.eras[0].id, era_id);
        assert_eq!(snapshot.eras[0].end_year, Some(500));
        let duplicate = project.connection.execute(
            "INSERT INTO feature_revisions(feature_id, valid_from_year, sequence, name, deleted)
             VALUES (?1, 100, 1, 'Duplicate', 0)",
            [&feature_id],
        );
        assert!(duplicate.is_err());
        let update = project.connection.execute(
            "UPDATE feature_revisions SET name = 'Changed' WHERE feature_id = ?1",
            [&feature_id],
        );
        assert!(update.is_err());
        let delete = project.connection.execute(
            "DELETE FROM feature_revisions WHERE feature_id = ?1",
            [&feature_id],
        );
        assert!(delete.is_err());
    }

    #[test]
    fn close_and_get_open_project_are_safe_when_empty() {
        let state = direct_state();
        assert!(get_open_project_in_state(&state).unwrap().is_none());
        close_project_in_state(&state).unwrap();
    }
}
