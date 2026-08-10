#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Realm 0.1 series supports only Apple Silicon macOS targets.");

use std::{
    ffi::CString,
    fs,
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
};

use rusqlite::{Connection, Error as SqlError, ErrorCode, OpenFlags, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use thiserror::Error;
use uuid::Uuid;

const CURRENT_SCHEMA_VERSION: i32 = 3;
const GRID_VERSION: i32 = 1;
const GRID_COLUMNS: i32 = 512;
const GRID_ROWS: i32 = 256;
const PROJECT_EXTENSION: &str = "realmmap";
const MAX_ARTIFACT_BYTES: usize = 50 * 1024 * 1024;

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
];
const FEATURE_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("feature_type", "TEXT", true, false),
    column("name", "TEXT", true, false),
    column("geometry_json", "TEXT", true, false),
];
const CELL_GRID_COLUMNS: &[ColumnExpectation] = &[
    column("id", "INTEGER", true, true),
    column("grid_version", "INTEGER", true, false),
    column("grid_columns", "INTEGER", true, false),
    column("grid_rows", "INTEGER", true, false),
];
const CELL_ATTRIBUTE_COLUMNS: &[ColumnExpectation] = &[
    column("id", "INTEGER", false, true),
    column("grid_version", "INTEGER", true, false),
    column("cell_x", "INTEGER", true, false),
    column("cell_y", "INTEGER", true, false),
    column("layer", "TEXT", true, false),
    column("value", "TEXT", true, false),
];

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
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FeatureType {
    Terrain,
    Forest,
    River,
    Coastline,
    Country,
    Region,
    Boundary,
    City,
    Town,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CellLayer {
    Forest,
    Country,
    Region,
}

impl CellLayer {
    fn as_str(self) -> &'static str {
        match self {
            Self::Forest => "forest",
            Self::Country => "country",
            Self::Region => "region",
        }
    }
    fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
            "forest" => Ok(Self::Forest),
            "country" => Ok(Self::Country),
            "region" => Ok(Self::Region),
            _ => Err(corrupt_schema()),
        }
    }
}

impl FeatureType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Terrain => "terrain",
            Self::Forest => "forest",
            Self::River => "river",
            Self::Coastline => "coastline",
            Self::Country => "country",
            Self::Region => "region",
            Self::Boundary => "boundary",
            Self::City => "city",
            Self::Town => "town",
        }
    }
    fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
            "terrain" => Ok(Self::Terrain),
            "forest" => Ok(Self::Forest),
            "river" => Ok(Self::River),
            "coastline" => Ok(Self::Coastline),
            "country" => Ok(Self::Country),
            "region" => Ok(Self::Region),
            "boundary" => Ok(Self::Boundary),
            "city" => Ok(Self::City),
            "town" => Ok(Self::Town),
            _ => Err(corrupt_schema()),
        }
    }
    fn geometry_type(self) -> &'static str {
        match self {
            Self::City | Self::Town => "Point",
            Self::River | Self::Coastline | Self::Boundary => "LineString",
            Self::Terrain | Self::Forest | Self::Country | Self::Region => "Polygon",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSnapshot {
    pub id: String,
    pub feature_type: FeatureType,
    pub name: String,
    pub geometry: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub format_version: i32,
    pub path: String,
    pub world: WorldSnapshot,
    pub features: Vec<FeatureSnapshot>,
    pub feature_count: i64,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub library_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellAttributeSnapshot {
    pub cell_id: String,
    pub attribute: CellLayer,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCellAttributesInput {
    pub cell_ids: Vec<String>,
    pub attribute: CellLayer,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellViewportInput {
    pub min_x: Option<i32>,
    pub max_x: Option<i32>,
    pub min_y: Option<i32>,
    pub max_y: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectInput {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeatureInput {
    pub feature_type: FeatureType,
    pub name: String,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseFeatureInput {
    pub id: String,
    pub name: String,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFeatureInput {
    pub id: String,
}

#[derive(Debug, Clone)]
struct CellState {
    value: String,
}

#[derive(Debug, Clone)]
struct CellEditChange {
    x: i32,
    y: i32,
    layer: CellLayer,
    before: Option<CellState>,
    after: Option<CellState>,
}

#[derive(Debug, Clone)]
struct FeatureState {
    name: String,
    geometry_json: String,
}

#[derive(Debug, Clone)]
enum EditOperation {
    ProjectName {
        before: String,
        after: String,
    },
    Feature {
        feature_id: String,
        feature_type: FeatureType,
        before: Option<FeatureState>,
        after: Option<FeatureState>,
    },
    CellAttributes {
        changes: Vec<CellEditChange>,
    },
}

struct OpenProject {
    path: PathBuf,
    connection: Connection,
    undo_stack: Vec<EditOperation>,
    redo_stack: Vec<EditOperation>,
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

fn coordinate(value: &Value) -> Result<[f64; 2], AppError> {
    let values = value
        .as_array()
        .filter(|values| values.len() == 2)
        .ok_or_else(|| {
            AppError::invalid("Geometry coordinates must contain longitude and latitude.")
        })?;
    let longitude = values[0]
        .as_f64()
        .filter(|value| value.is_finite() && (-180.0..=180.0).contains(value))
        .ok_or_else(|| AppError::invalid("Geometry longitude must be between -180 and 180."))?;
    let latitude = values[1]
        .as_f64()
        .filter(|value| value.is_finite() && (-90.0..=90.0).contains(value))
        .ok_or_else(|| AppError::invalid("Geometry latitude must be between -90 and 90."))?;
    Ok([longitude, latitude])
}

fn line_coordinates(value: &Value, minimum: usize) -> Result<Vec<[f64; 2]>, AppError> {
    let values = value
        .as_array()
        .filter(|values| values.len() >= minimum)
        .ok_or_else(|| AppError::invalid("Geometry does not contain enough coordinates."))?;
    values.iter().map(coordinate).collect()
}

fn validate_geometry(feature_type: FeatureType, geometry: &Value) -> Result<String, AppError> {
    let object = geometry
        .as_object()
        .ok_or_else(|| AppError::invalid("Geometry must be a GeoJSON geometry object."))?;
    let geometry_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("Geometry type is required."))?;
    if geometry_type != feature_type.geometry_type() {
        return Err(AppError::invalid(
            "Geometry type does not match the selected feature class.",
        ));
    }
    let coordinates = object
        .get("coordinates")
        .ok_or_else(|| AppError::invalid("Geometry coordinates are required."))?;
    match geometry_type {
        "Point" => {
            coordinate(coordinates)?;
        }
        "LineString" => {
            line_coordinates(coordinates, 2)?;
        }
        "Polygon" => {
            let rings = coordinates
                .as_array()
                .filter(|rings| !rings.is_empty())
                .ok_or_else(|| AppError::invalid("A polygon must contain at least one ring."))?;
            for ring in rings {
                let points = line_coordinates(ring, 4)?;
                if points.first() != points.last() {
                    return Err(AppError::invalid("Polygon rings must be closed."));
                }
            }
        }
        _ => return Err(AppError::invalid("Unsupported GeoJSON geometry type.")),
    }
    serde_json::to_string(geometry)
        .map_err(|_| AppError::invalid("Geometry could not be encoded as GeoJSON."))
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
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS features (
            id TEXT PRIMARY KEY NOT NULL,
            feature_type TEXT NOT NULL CHECK (feature_type IN
                ('terrain','forest','river','coastline','country','region','boundary','city','town')),
            name TEXT NOT NULL,
            geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json))
        );
        CREATE TABLE IF NOT EXISTS cell_grid (
            id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
            grid_version INTEGER NOT NULL CHECK (grid_version = 1),
            grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),
            grid_rows INTEGER NOT NULL CHECK (grid_rows = 256)
        );
        CREATE TABLE IF NOT EXISTS cell_attributes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grid_version INTEGER NOT NULL CHECK (grid_version = 1),
            cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),
            cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),
            layer TEXT NOT NULL CHECK (layer IN ('forest','country','region')),
            value TEXT NOT NULL,
            UNIQUE (grid_version, cell_x, cell_y, layer)
        );
        CREATE INDEX IF NOT EXISTS cell_attributes_lookup
            ON cell_attributes(grid_version, cell_x, cell_y, layer);
        INSERT OR IGNORE INTO cell_grid(id, grid_version, grid_columns, grid_rows)
            VALUES (1, 1, 512, 256);
        ",
    ).map_err(AppError::from)
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
        .execute_batch(&format!("PRAGMA user_version = {CURRENT_SCHEMA_VERSION};"))
        .map_err(AppError::from)?;
    transaction
        .execute(
            "INSERT INTO world(id, name) VALUES (?1, ?2)",
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

fn object_exists(connection: &Connection, object_type: &str, name: &str) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type=?1 AND name=?2)",
            params![object_type, name],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

fn verify_table(
    connection: &Connection,
    table: &str,
    expected: &[ColumnExpectation],
) -> Result<(), AppError> {
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
        || found.iter().zip(expected).any(|((name, ty, nn, pk), e)| {
            name != e.name
                || !ty.eq_ignore_ascii_case(e.declared_type)
                || *nn != e.not_null
                || *pk != e.primary_key
        })
    {
        return Err(corrupt_schema());
    }
    Ok(())
}

fn verify_schema(connection: &Connection) -> Result<(), AppError> {
    for (table, expected) in [
        ("schema_migrations", SCHEMA_MIGRATION_COLUMNS),
        ("world", WORLD_COLUMNS),
        ("features", FEATURE_COLUMNS),
        ("cell_grid", CELL_GRID_COLUMNS),
        ("cell_attributes", CELL_ATTRIBUTE_COLUMNS),
    ] {
        verify_table(connection, table, expected)?;
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
    if !feature_sql.contains("check (json_valid(geometry_json))") {
        return Err(corrupt_schema());
    }
    let cell_sql = normalized_object_sql(connection, "table", "cell_attributes")?;
    if !cell_sql.contains("check (layer in ('forest','country','region'))")
        || !cell_sql.contains("unique (grid_version, cell_x, cell_y, layer)")
    {
        return Err(corrupt_schema());
    }
    let grid_sql = normalized_object_sql(connection, "table", "cell_grid")?;
    for invariant in [
        "check (id = 1)",
        "check (grid_version = 1)",
        "check (grid_columns = 512)",
        "check (grid_rows = 256)",
    ] {
        if !grid_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    if index_columns(connection, "cell_attributes_lookup")?
        != ["grid_version", "cell_x", "cell_y", "layer"]
    {
        return Err(corrupt_schema());
    }
    if connection
        .query_row("SELECT COUNT(*) FROM cell_grid", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(AppError::from)?
        != 1
    {
        return Err(corrupt_schema());
    }
    for name in [
        "eras",
        "timeline_events",
        "feature_revisions",
        "cell_edit_operations",
        "cell_attribute_revisions",
        "feature_revisions_lookup",
        "feature_revisions_year",
        "timeline_events_range",
        "cell_attribute_revisions_lookup",
        "cell_attribute_revisions_view",
        "feature_revision_sequence_monotonic",
        "feature_revision_no_update",
        "feature_revision_no_delete",
        "cell_attribute_revision_sequence_monotonic",
        "cell_attribute_revision_no_update",
        "cell_attribute_revision_no_delete",
        "cell_edit_operation_no_update",
        "cell_edit_operation_no_delete",
    ] {
        if object_exists(connection, "table", name)?
            || object_exists(connection, "index", name)?
            || object_exists(connection, "trigger", name)?
        {
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
    let (world_id, world_name): (String, String) = project
        .connection
        .query_row("SELECT id, name FROM world LIMIT 1", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => AppError::new(
                "corrupt_project",
                "The project does not contain a world record.",
            ),
            other => other.into(),
        })?;
    let mut query = project.connection.prepare(
        "SELECT id, feature_type, name, geometry_json FROM features ORDER BY feature_type, name, id"
    ).map_err(AppError::from)?;
    let rows = query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let features = rows
        .into_iter()
        .map(|(id, kind, name, geometry_json)| {
            let geometry: Value = serde_json::from_str(&geometry_json).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid geometry.")
            })?;
            let feature_type = FeatureType::from_storage(&kind)?;
            validate_geometry(feature_type, &geometry).map_err(|_| {
                AppError::new(
                    "corrupt_project",
                    "A feature contains geometry that does not match its class.",
                )
            })?;
            Ok(FeatureSnapshot {
                id,
                feature_type,
                name,
                geometry,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let feature_count = i64::try_from(features.len())
        .map_err(|_| AppError::new("storage_error", "The feature count is unavailable."))?;
    Ok(ProjectSnapshot {
        format_version: CURRENT_SCHEMA_VERSION,
        path: project.path.to_string_lossy().into_owned(),
        world: WorldSnapshot {
            id: world_id,
            name: world_name,
        },
        features,
        feature_count,
        can_undo: !project.undo_stack.is_empty(),
        can_redo: !project.redo_stack.is_empty(),
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
    let migrations_table: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')", [], |row| row.get(0)
    ).map_err(AppError::from)?;
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
            "This project uses a legacy Realm format that is no longer supported.",
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
    let (path, _) = preflight_existing_project(path)?;
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

fn preflight_existing_project(path: &Path) -> Result<(PathBuf, i32), AppError> {
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

fn app_library_directory(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
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

fn library_project_path(
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

fn project_summary_from_path(path: &Path) -> Result<ProjectSummary, AppError> {
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

fn copy_synced_file(source: &Path, destination: &Path, prefix: &str) -> Result<(), AppError> {
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

#[tauri::command]
fn create_project(
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
fn open_project(
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
fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, AppError> {
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
fn import_project(
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

fn create_open_project(path: PathBuf) -> Result<OpenProject, AppError> {
    let connection = open_connection(&path)?;
    Ok(OpenProject {
        path,
        connection,
        undo_stack: Vec::new(),
        redo_stack: Vec::new(),
    })
}

#[tauri::command]
fn export_project(state: tauri::State<'_, AppState>, path: String) -> Result<(), AppError> {
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

fn validated_artifact_path(raw: &str) -> Result<PathBuf, AppError> {
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
fn write_artifact(path: String, bytes: Vec<u8>) -> Result<(), AppError> {
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

fn feature_state(
    connection: &Connection,
    feature_id: &str,
) -> Result<Option<FeatureState>, AppError> {
    let result = connection.query_row(
        "SELECT name, geometry_json FROM features WHERE id = ?1",
        [feature_id],
        |row| {
            Ok(FeatureState {
                name: row.get(0)?,
                geometry_json: row.get(1)?,
            })
        },
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn upsert_feature_state(
    transaction: &Transaction<'_>,
    feature_id: &str,
    feature_type: FeatureType,
    state: &FeatureState,
) -> Result<(), AppError> {
    transaction.execute(
        "INSERT INTO features(id, feature_type, name, geometry_json) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, geometry_json = excluded.geometry_json",
        params![feature_id, feature_type.as_str(), state.name, state.geometry_json],
    ).map_err(AppError::from)?;
    Ok(())
}

fn parse_cell_id(value: &str) -> Result<(i32, i32), AppError> {
    let mut parts = value.trim().split(':');
    let x = parts
        .next()
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| AppError::invalid("A cell identifier must use x:y coordinates."))?;
    let y = parts
        .next()
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| AppError::invalid("A cell identifier must use x:y coordinates."))?;
    if parts.next().is_some() || !(0..GRID_COLUMNS).contains(&x) || !(0..GRID_ROWS).contains(&y) {
        return Err(AppError::invalid(
            "A cell identifier is outside the world grid.",
        ));
    }
    Ok((x, y))
}

fn cell_id(x: i32, y: i32) -> String {
    format!("{x}:{y}")
}

fn normalize_cell_ids(cell_ids: Vec<String>) -> Result<Vec<(i32, i32)>, AppError> {
    if cell_ids.is_empty() {
        return Err(AppError::invalid("At least one cell must be selected."));
    }
    if cell_ids.len() > 200_000 {
        return Err(AppError::invalid("The cell selection is too large."));
    }
    let mut cells = cell_ids
        .into_iter()
        .map(|id| parse_cell_id(&id))
        .collect::<Result<Vec<_>, _>>()?;
    cells.sort_unstable();
    cells.dedup();
    Ok(cells)
}

fn validate_cell_value(value: Option<&str>) -> Result<(), AppError> {
    if let Some(value) = value {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > 200 {
            return Err(AppError::invalid("A cell attribute value is invalid."));
        }
    }
    Ok(())
}

fn latest_cell_state(
    connection: &Connection,
    x: i32,
    y: i32,
    layer: CellLayer,
) -> Result<Option<CellState>, AppError> {
    let result = connection.query_row(
        "SELECT value FROM cell_attributes WHERE grid_version = ?1 AND cell_x = ?2 AND cell_y = ?3 AND layer = ?4",
        params![GRID_VERSION, x, y, layer.as_str()],
        |row| Ok(CellState { value: row.get(0)? }),
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn cell_attributes_snapshot(
    project: &OpenProject,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    let min_x = input.min_x.unwrap_or(0).max(0);
    let max_x = input
        .max_x
        .unwrap_or(GRID_COLUMNS - 1)
        .min(GRID_COLUMNS - 1);
    let min_y = input.min_y.unwrap_or(0).max(0);
    let max_y = input.max_y.unwrap_or(GRID_ROWS - 1).min(GRID_ROWS - 1);
    if min_x > max_x || min_y > max_y {
        return Err(AppError::invalid("The cell viewport is invalid."));
    }
    let mut query = project
        .connection
        .prepare(
            "SELECT cell_x, cell_y, layer, value FROM cell_attributes
         WHERE grid_version = ?1 AND cell_x BETWEEN ?2 AND ?3 AND cell_y BETWEEN ?4 AND ?5
         ORDER BY cell_y, cell_x, layer",
        )
        .map_err(AppError::from)?;
    query
        .query_map(params![GRID_VERSION, min_x, max_x, min_y, max_y], |row| {
            let layer = CellLayer::from_storage(&row.get::<_, String>(2)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(CellAttributeSnapshot {
                cell_id: cell_id(row.get(0)?, row.get(1)?),
                attribute: layer,
                value: row.get(3)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

fn save_project_in_state(
    state: &AppState,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before: String = project
        .connection
        .query_row("SELECT name FROM world LIMIT 1", [], |row| row.get(0))
        .map_err(AppError::from)?;
    let after = input.name.trim().to_owned();
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    if transaction
        .execute("UPDATE world SET name = ?1", [&after])
        .map_err(AppError::from)?
        != 1
    {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    transaction.commit().map_err(AppError::from)?;
    if before != after {
        project
            .undo_stack
            .push(EditOperation::ProjectName { before, after });
        project.redo_stack.clear();
    }
    project_snapshot(project)
}

#[tauri::command]
fn save_project(
    state: tauri::State<'_, AppState>,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    save_project_in_state(state.inner(), input)
}

fn apply_cell_attributes_in_state(
    state: &AppState,
    input: ApplyCellAttributesInput,
) -> Result<ProjectSnapshot, AppError> {
    let cells = normalize_cell_ids(input.cell_ids)?;
    validate_cell_value(input.value.as_deref())?;
    let value = input.value.map(|value| value.trim().to_owned());
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let changes = cells
        .into_iter()
        .map(|(x, y)| {
            Ok(CellEditChange {
                x,
                y,
                layer: input.attribute,
                before: latest_cell_state(&project.connection, x, y, input.attribute)?,
                after: value.clone().map(|value| CellState { value }),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    for change in &changes {
        match &change.after {
            Some(after) => {
                transaction.execute(
                    "INSERT INTO cell_attributes(grid_version, cell_x, cell_y, layer, value)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(grid_version, cell_x, cell_y, layer) DO UPDATE SET value = excluded.value",
                    params![GRID_VERSION, change.x, change.y, change.layer.as_str(), after.value],
                ).map_err(AppError::from)?;
            }
            None => {
                transaction.execute(
                    "DELETE FROM cell_attributes WHERE grid_version = ?1 AND cell_x = ?2 AND cell_y = ?3 AND layer = ?4",
                    params![GRID_VERSION, change.x, change.y, change.layer.as_str()],
                ).map_err(AppError::from)?;
            }
        }
    }
    transaction.commit().map_err(AppError::from)?;
    project
        .undo_stack
        .push(EditOperation::CellAttributes { changes });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
fn apply_cell_attributes(
    state: tauri::State<'_, AppState>,
    input: ApplyCellAttributesInput,
) -> Result<ProjectSnapshot, AppError> {
    apply_cell_attributes_in_state(state.inner(), input)
}

fn view_cell_attributes_in_state(
    state: &AppState,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    cell_attributes_snapshot(project, input)
}

#[tauri::command]
fn view_cell_attributes(
    state: tauri::State<'_, AppState>,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    view_cell_attributes_in_state(state.inner(), input)
}

fn create_feature_in_state(
    state: &AppState,
    input: CreateFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let geometry_json = validate_geometry(input.feature_type, &input.geometry)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let feature_id = Uuid::new_v4().to_string();
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    upsert_feature_state(&transaction, &feature_id, input.feature_type, &after)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type: input.feature_type,
        before: None,
        after: Some(after),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
fn create_feature(
    state: tauri::State<'_, AppState>,
    input: CreateFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    create_feature_in_state(state.inner(), input)
}

fn revise_feature_in_state(
    state: &AppState,
    input: ReviseFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    let feature_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("A feature identifier is invalid."))?
        .to_string();
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let feature_type = project
        .connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [&feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => {
                AppError::new("not_found", "The feature was not found.")
            }
            other => other.into(),
        })
        .and_then(|value| FeatureType::from_storage(&value))?;
    let before = feature_state(&project.connection, &feature_id)?
        .ok_or_else(|| AppError::new("not_found", "The feature was not found."))?;
    let geometry_json = validate_geometry(feature_type, &input.geometry)?;
    let after = FeatureState {
        name: input.name.trim().to_owned(),
        geometry_json,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    transaction
        .execute(
            "UPDATE features SET name = ?1, geometry_json = ?2 WHERE id = ?3",
            params![after.name, after.geometry_json, feature_id],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type,
        before: Some(before),
        after: Some(after),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
fn revise_feature(
    state: tauri::State<'_, AppState>,
    input: ReviseFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    revise_feature_in_state(state.inner(), input)
}

fn delete_feature_in_state(
    state: &AppState,
    input: DeleteFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    let feature_id = Uuid::parse_str(input.id.trim())
        .map_err(|_| AppError::invalid("A feature identifier is invalid."))?
        .to_string();
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before = feature_state(&project.connection, &feature_id)?
        .ok_or_else(|| AppError::new("not_found", "The feature was not found."))?;
    let feature_type = project
        .connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [&feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(AppError::from)
        .and_then(|value| FeatureType::from_storage(&value))?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    if transaction
        .execute("DELETE FROM features WHERE id = ?1", [&feature_id])
        .map_err(AppError::from)?
        != 1
    {
        return Err(AppError::new("not_found", "The feature was not found."));
    }
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        feature_type,
        before: Some(before),
        after: None,
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
fn delete_feature(
    state: tauri::State<'_, AppState>,
    input: DeleteFeatureInput,
) -> Result<ProjectSnapshot, AppError> {
    delete_feature_in_state(state.inner(), input)
}

fn apply_edit_operation(
    project: &mut OpenProject,
    operation: &EditOperation,
    forward: bool,
) -> Result<(), AppError> {
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    match operation {
        EditOperation::ProjectName { before, after } => {
            let name = if forward { after } else { before };
            if transaction
                .execute("UPDATE world SET name = ?1", [name])
                .map_err(AppError::from)?
                != 1
            {
                return Err(AppError::new(
                    "corrupt_project",
                    "The project must contain exactly one world record.",
                ));
            }
        }
        EditOperation::Feature {
            feature_id,
            feature_type,
            before,
            after,
        } => {
            let state = if forward { after } else { before };
            match state {
                Some(state) => {
                    upsert_feature_state(&transaction, feature_id, *feature_type, state)?;
                }
                None => {
                    transaction
                        .execute("DELETE FROM features WHERE id = ?1", [feature_id])
                        .map_err(AppError::from)?;
                }
            }
        }
        EditOperation::CellAttributes { changes } => {
            for change in changes {
                match if forward {
                    &change.after
                } else {
                    &change.before
                } {
                    Some(state) => {
                        transaction.execute(
                            "INSERT INTO cell_attributes(grid_version, cell_x, cell_y, layer, value) VALUES (?1,?2,?3,?4,?5)
                             ON CONFLICT(grid_version,cell_x,cell_y,layer) DO UPDATE SET value=excluded.value",
                            params![GRID_VERSION, change.x, change.y, change.layer.as_str(), state.value],
                        ).map_err(AppError::from)?;
                    }
                    None => {
                        transaction.execute("DELETE FROM cell_attributes WHERE grid_version=?1 AND cell_x=?2 AND cell_y=?3 AND layer=?4", params![GRID_VERSION, change.x, change.y, change.layer.as_str()]).map_err(AppError::from)?;
                    }
                }
            }
        }
    }
    transaction.commit().map_err(AppError::from)
}

fn undo_project_in_state(state: &AppState) -> Result<ProjectSnapshot, AppError> {
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let operation = project
        .undo_stack
        .pop()
        .ok_or_else(|| AppError::new("nothing_to_undo", "There is nothing to undo."))?;
    if let Err(error) = apply_edit_operation(project, &operation, false) {
        project.undo_stack.push(operation);
        return Err(error);
    }
    project.redo_stack.push(operation);
    project_snapshot(project)
}

#[tauri::command]
fn undo_project(state: tauri::State<'_, AppState>) -> Result<ProjectSnapshot, AppError> {
    undo_project_in_state(state.inner())
}

fn redo_project_in_state(state: &AppState) -> Result<ProjectSnapshot, AppError> {
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let operation = project
        .redo_stack
        .pop()
        .ok_or_else(|| AppError::new("nothing_to_redo", "There is nothing to redo."))?;
    if let Err(error) = apply_edit_operation(project, &operation, true) {
        project.redo_stack.push(operation);
        return Err(error);
    }
    project.undo_stack.push(operation);
    project_snapshot(project)
}

#[tauri::command]
fn redo_project(state: tauri::State<'_, AppState>) -> Result<ProjectSnapshot, AppError> {
    redo_project_in_state(state.inner())
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
            list_projects,
            open_project,
            import_project,
            export_project,
            write_artifact,
            save_project,
            apply_cell_attributes,
            view_cell_attributes,
            create_feature,
            revise_feature,
            delete_feature,
            undo_project,
            redo_project,
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

    fn geometry_for(feature_type: FeatureType) -> Value {
        match feature_type.geometry_type() {
            "Point" => serde_json::json!({ "type": "Point", "coordinates": [12.0, 34.0] }),
            "LineString" => {
                serde_json::json!({ "type": "LineString", "coordinates": [[0.0, 0.0], [10.0, 10.0]] })
            }
            "Polygon" => {
                serde_json::json!({ "type": "Polygon", "coordinates": [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 0.0]]] })
            }
            _ => unreachable!(),
        }
    }

    fn create(path: &Path, name: &str) -> Result<ProjectSnapshot, AppError> {
        let project = create_project_inner(path.to_path_buf(), name)?;
        project_snapshot(&project)
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
        }
        assert!(!object_exists(&connection, "table", "world").unwrap());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn atomic_publication_never_replaces_existing_file() {
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
    fn artifact_publication_validates_content_size_and_no_replace() {
        let directory = tempdir().unwrap();
        let artifact = directory.path().join("map.png");
        let png = b"\x89PNG\r\n\x1a\nsynthetic".to_vec();
        write_artifact(artifact.to_string_lossy().into_owned(), png.clone()).unwrap();
        assert_eq!(fs::read(&artifact).unwrap(), png);
        assert_eq!(
            write_artifact(artifact.to_string_lossy().into_owned(), vec![9])
                .unwrap_err()
                .code,
            "already_exists"
        );
        assert_eq!(
            write_artifact(
                directory
                    .path()
                    .join("map.txt")
                    .to_string_lossy()
                    .into_owned(),
                vec![1]
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
        assert_eq!(
            write_artifact(
                directory
                    .path()
                    .join("wrong.pdf")
                    .to_string_lossy()
                    .into_owned(),
                b"\x89PNG\r\n\x1a\nsynthetic".to_vec(),
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
        assert_eq!(
            write_artifact(
                directory
                    .path()
                    .join("large.pdf")
                    .to_string_lossy()
                    .into_owned(),
                vec![0; MAX_ARTIFACT_BYTES + 1],
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
    }

    #[test]
    fn path_validation_rejects_wrong_extension_missing_parent_directory_and_symlink() {
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
                false,
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
    fn rejects_mismatch_partial_and_weakened_schema_without_writing() {
        let directory = tempdir().unwrap();
        let mismatch = directory.path().join("mismatch.realmmap");
        create(&mismatch, "Mismatch").unwrap();
        let connection = Connection::open(&mismatch).unwrap();
        connection.pragma_update(None, "user_version", 0).unwrap();
        drop(connection);
        let mismatch_before = fs::read(&mismatch).unwrap();
        assert_eq!(
            open_connection(&mismatch).unwrap_err().code,
            "corrupt_project"
        );
        assert_eq!(fs::read(&mismatch).unwrap(), mismatch_before);

        let partial = directory.path().join("partial.realmmap");
        let connection = Connection::open(&partial).unwrap();
        connection
            .execute_batch("CREATE TABLE world(id TEXT PRIMARY KEY, name TEXT);")
            .unwrap();
        drop(connection);
        let partial_before = fs::read(&partial).unwrap();
        assert_eq!(
            open_connection(&partial).unwrap_err().code,
            "corrupt_project"
        );
        assert_eq!(fs::read(&partial).unwrap(), partial_before);

        let weakened = directory.path().join("weakened.realmmap");
        create(&weakened, "Weakened").unwrap();
        let connection = Connection::open(&weakened).unwrap();
        connection
            .execute_batch(
                "DROP TABLE cell_attributes; CREATE TABLE cell_attributes(id INTEGER PRIMARY KEY);",
            )
            .unwrap();
        drop(connection);
        let weakened_before = fs::read(&weakened).unwrap();
        assert_eq!(
            open_connection(&weakened).unwrap_err().code,
            "corrupt_project"
        );
        assert_eq!(fs::read(&weakened).unwrap(), weakened_before);
    }

    #[test]
    fn corrupt_sqlite_source_remains_unchanged() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("corrupt.realmmap");
        let bytes = b"SQLite format 3\0synthetic corruption";
        fs::write(&path, bytes).unwrap();
        assert_eq!(open_connection(&path).unwrap_err().code, "corrupt_project");
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn copy_synced_file_leaves_source_unchanged() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.realmmap");
        let destination = directory.path().join("copy.realmmap");
        create(&source, "Source").unwrap();
        let before = fs::read(&source).unwrap();
        copy_synced_file(&source, &destination, "test-copy").unwrap();
        assert_eq!(fs::read(&source).unwrap(), before);
        assert_eq!(
            project_snapshot(&OpenProject {
                path: destination.clone(),
                connection: open_connection(&destination).unwrap(),
                undo_stack: Vec::new(),
                redo_stack: Vec::new()
            })
            .unwrap()
            .world
            .name,
            "Source"
        );
    }

    #[test]
    fn creates_static_schema_without_history_or_terrain_kind() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("world.realmmap");
        let snapshot = create(&path, "World").unwrap();
        assert_eq!(snapshot.format_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(snapshot.world.name, "World");
        let connection = Connection::open(&path).unwrap();
        for table in [
            "schema_migrations",
            "world",
            "features",
            "cell_grid",
            "cell_attributes",
        ] {
            assert!(
                object_exists(&connection, "table", table).unwrap(),
                "missing {table}"
            );
        }
        for object in [
            "eras",
            "timeline_events",
            "feature_revisions",
            "cell_edit_operations",
            "cell_attribute_revisions",
        ] {
            assert!(
                !object_exists(&connection, "table", object).unwrap(),
                "legacy table {object}"
            );
        }
        let world_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(world)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(world_columns, vec!["id", "name"]);
        let cell_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='cell_attributes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!cell_sql.contains("terrain_kind"));
    }

    #[test]
    fn static_feature_crud_reopen_and_undo_redo() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("features.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(path.clone(), "Features").unwrap());
        let created = create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::City,
                name: "Old".into(),
                geometry: geometry_for(FeatureType::City),
            },
        )
        .unwrap();
        let id = created.features[0].id.clone();
        revise_feature_in_state(
            &state,
            ReviseFeatureInput {
                id: id.clone(),
                name: "New".into(),
                geometry: geometry_for(FeatureType::City),
            },
        )
        .unwrap();
        assert_eq!(
            get_open_project_in_state(&state).unwrap().unwrap().features[0].name,
            "New"
        );
        delete_feature_in_state(&state, DeleteFeatureInput { id: id.clone() }).unwrap();
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .is_empty()
        );
        undo_project_in_state(&state).unwrap();
        assert_eq!(
            get_open_project_in_state(&state).unwrap().unwrap().features[0].name,
            "New"
        );
        redo_project_in_state(&state).unwrap();
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .is_empty()
        );
        close_project_in_state(&state).unwrap();
        *state.project.lock().unwrap() = Some(OpenProject {
            path,
            connection: open_connection(&directory.path().join("features.realmmap")).unwrap(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        });
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .is_empty()
        );
    }

    #[test]
    fn all_feature_classes_round_trip_static_geometry_and_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("classes.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(path.clone(), "Classes").unwrap());
        let types = [
            FeatureType::Terrain,
            FeatureType::Forest,
            FeatureType::River,
            FeatureType::Coastline,
            FeatureType::Country,
            FeatureType::Region,
            FeatureType::Boundary,
            FeatureType::City,
            FeatureType::Town,
        ];
        for feature_type in types {
            create_feature_in_state(
                &state,
                CreateFeatureInput {
                    feature_type,
                    name: feature_type.as_str().to_owned(),
                    geometry: geometry_for(feature_type),
                },
            )
            .unwrap();
        }
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .len(),
            9
        );
        close_project_in_state(&state).unwrap();
        let connection = open_connection(&path).unwrap();
        let project = OpenProject {
            path,
            connection,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        };
        assert_eq!(project_snapshot(&project).unwrap().features.len(), 9);
    }

    #[test]
    fn static_cell_attributes_round_trip_and_undo() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(directory.path().join("cells.realmmap"), "Cells").unwrap());
        apply_cell_attributes_in_state(
            &state,
            ApplyCellAttributesInput {
                cell_ids: vec!["1:2".into(), "2:2".into(), "1:2".into()],
                attribute: CellLayer::Forest,
                value: Some("on".into()),
            },
        )
        .unwrap();
        let current = view_cell_attributes_in_state(
            &state,
            CellViewportInput {
                min_x: Some(1),
                max_x: Some(1),
                min_y: Some(2),
                max_y: Some(2),
            },
        )
        .unwrap();
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].value, "on");
        apply_cell_attributes_in_state(
            &state,
            ApplyCellAttributesInput {
                cell_ids: vec!["1:2".into()],
                attribute: CellLayer::Forest,
                value: None,
            },
        )
        .unwrap();
        assert!(
            view_cell_attributes_in_state(
                &state,
                CellViewportInput {
                    min_x: Some(1),
                    max_x: Some(1),
                    min_y: Some(2),
                    max_y: Some(2),
                }
            )
            .unwrap()
            .is_empty()
        );
        undo_project_in_state(&state).unwrap();
        assert_eq!(
            view_cell_attributes_in_state(
                &state,
                CellViewportInput {
                    min_x: Some(1),
                    max_x: Some(1),
                    min_y: Some(2),
                    max_y: Some(2),
                }
            )
            .unwrap()[0]
                .value,
            "on"
        );
        let project_guard = state.project.lock().unwrap();
        let connection = &project_guard.as_ref().unwrap().connection;
        let table_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '%revision%' OR name LIKE '%operation%'", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(table_count, 0);
    }

    #[test]
    fn cell_input_and_viewport_validation_are_transactional() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        let project =
            create_project_inner(directory.path().join("cell-validation.realmmap"), "Cells")
                .unwrap();
        project.connection.execute_batch("CREATE TEMP TRIGGER reject_cell BEFORE INSERT ON cell_attributes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        *state.project.lock().unwrap() = Some(project);
        assert_eq!(
            apply_cell_attributes_in_state(
                &state,
                ApplyCellAttributesInput {
                    cell_ids: vec!["bad".into()],
                    attribute: CellLayer::Forest,
                    value: Some("on".into())
                }
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
        assert_eq!(
            view_cell_attributes_in_state(
                &state,
                CellViewportInput {
                    min_x: Some(3),
                    max_x: Some(2),
                    min_y: None,
                    max_y: None
                }
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
        assert_eq!(
            apply_cell_attributes_in_state(
                &state,
                ApplyCellAttributesInput {
                    cell_ids: vec!["1:2".into()],
                    attribute: CellLayer::Forest,
                    value: Some("on".into())
                }
            )
            .unwrap_err()
            .code,
            "storage_constraint"
        );
        assert_eq!(
            state
                .project
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .connection
                .query_row("SELECT COUNT(*) FROM cell_attributes", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn save_name_is_transactional_and_undoable() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(directory.path().join("save.realmmap"), "Before").unwrap());
        let saved = save_project_in_state(
            &state,
            SaveProjectInput {
                name: "After".into(),
            },
        )
        .unwrap();
        assert_eq!(saved.world.name, "After");
        assert_eq!(undo_project_in_state(&state).unwrap().world.name, "Before");
        assert_eq!(redo_project_in_state(&state).unwrap().world.name, "After");
        assert_eq!(
            save_project_in_state(&state, SaveProjectInput { name: "".into() })
                .unwrap_err()
                .code,
            "invalid_input"
        );
    }

    #[test]
    fn feature_transaction_rolls_back_on_constraint_failure() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        let project =
            create_project_inner(directory.path().join("rollback.realmmap"), "Rollback").unwrap();
        project.connection.execute_batch(
            "CREATE TEMP TRIGGER reject_feature BEFORE INSERT ON features BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;"
        ).unwrap();
        *state.project.lock().unwrap() = Some(project);
        let error = create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::Town,
                name: "Town".into(),
                geometry: geometry_for(FeatureType::Town),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "storage_constraint");
        assert_eq!(
            state
                .project
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .connection
                .query_row("SELECT COUNT(*) FROM features", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn invalid_geometry_does_not_write() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(directory.path().join("invalid.realmmap"), "Invalid").unwrap(),
        );
        let error = create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::City,
                name: "Invalid".into(),
                geometry: serde_json::json!({ "type": "Point", "coordinates": [181, 0] }),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_input");
        assert_eq!(
            state
                .project
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .connection
                .query_row("SELECT COUNT(*) FROM features", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn legacy_schema_is_rejected_without_mutating_source() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("legacy.realmmap");
        create(&path, "Legacy").unwrap();
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("DELETE FROM schema_migrations; INSERT INTO schema_migrations(version) VALUES (2); PRAGMA user_version = 2;").unwrap();
        drop(connection);
        let before = fs::read(&path).unwrap();
        let error = open_connection(&path).unwrap_err();
        assert_eq!(error.code, "unsupported_schema");
        assert_eq!(fs::read(&path).unwrap(), before);
        let check = Connection::open(&path).unwrap();
        assert_eq!(
            check
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn future_schema_is_rejected_without_changing_journal_mode() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("future.realmmap");
        create(&path, "Future").unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection.pragma_update(None, "user_version", 999).unwrap();
        drop(connection);
        let before = fs::read(&path).unwrap();
        let error = open_connection(&path).unwrap_err();
        assert_eq!(error.code, "future_schema");
        assert_eq!(fs::read(&path).unwrap(), before);
        let connection = Connection::open(&path).unwrap();
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn close_and_get_open_project_are_safe_when_empty() {
        let state = direct_state();
        assert!(get_open_project_in_state(&state).unwrap().is_none());
        close_project_in_state(&state).unwrap();
    }
}
