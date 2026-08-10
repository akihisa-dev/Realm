#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Realm 0.1 series supports only Apple Silicon macOS targets.");

use std::{
    collections::HashSet,
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

const CURRENT_SCHEMA_VERSION: i32 = 2;
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
const CELL_GRID_COLUMNS: &[ColumnExpectation] = &[
    column("id", "INTEGER", true, true),
    column("grid_version", "INTEGER", true, false),
    column("grid_columns", "INTEGER", true, false),
    column("grid_rows", "INTEGER", true, false),
];
const CELL_OPERATION_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("valid_from_year", "INTEGER", true, false),
    column("sequence", "INTEGER", true, false),
];
const CELL_REVISION_COLUMNS: &[ColumnExpectation] = &[
    column("id", "INTEGER", false, true),
    column("operation_id", "TEXT", true, false),
    column("grid_version", "INTEGER", true, false),
    column("cell_x", "INTEGER", true, false),
    column("cell_y", "INTEGER", true, false),
    column("layer", "TEXT", true, false),
    column("valid_from_year", "INTEGER", true, false),
    column("sequence", "INTEGER", true, false),
    column("value", "TEXT", false, false),
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
    TerrainKind,
    Forest,
    Country,
    Region,
}

impl CellLayer {
    fn as_str(self) -> &'static str {
        match self {
            Self::TerrainKind => "terrain_kind",
            Self::Forest => "forest",
            Self::Country => "country",
            Self::Region => "region",
        }
    }

    fn from_storage(value: &str) -> Result<Self, AppError> {
        match value {
            "terrain_kind" => Ok(Self::TerrainKind),
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
    pub valid_from_year: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEventSnapshot {
    pub id: String,
    pub title: String,
    pub description: String,
    pub start_year: i32,
    pub end_year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub format_version: i32,
    pub path: String,
    pub world: WorldSnapshot,
    pub eras: Vec<EraSnapshot>,
    pub features: Vec<FeatureSnapshot>,
    pub timeline_events: Vec<TimelineEventSnapshot>,
    pub feature_count: i64,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub library_id: String,
    pub name: String,
    pub current_year: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellAttributeSnapshot {
    pub cell_id: String,
    pub attribute: CellLayer,
    pub value: String,
    pub valid_from_year: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCellAttributesInput {
    pub year: i32,
    pub cell_ids: Vec<String>,
    pub attribute: CellLayer,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellViewportInput {
    pub year: i32,
    pub min_x: Option<i32>,
    pub max_x: Option<i32>,
    pub min_y: Option<i32>,
    pub max_y: Option<i32>,
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
    pub timeline_events: Vec<SaveTimelineEventInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTimelineEventInput {
    pub id: Option<String>,
    pub title: String,
    pub description: String,
    pub start_year: i32,
    pub end_year: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFeatureInput {
    pub feature_type: FeatureType,
    pub name: String,
    pub valid_from_year: i32,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseFeatureInput {
    pub id: String,
    pub name: String,
    pub valid_from_year: i32,
    pub geometry: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFeatureInput {
    pub id: String,
    pub valid_from_year: i32,
}

#[derive(Debug, Clone)]
struct CellRevisionState {
    value: Option<String>,
    deleted: bool,
}

#[derive(Debug, Clone)]
struct CellEditChange {
    x: i32,
    y: i32,
    layer: CellLayer,
    before: Option<CellRevisionState>,
    after: CellRevisionState,
}

#[derive(Debug, Clone)]
struct FeatureRevisionState {
    name: String,
    geometry_json: Option<String>,
    deleted: bool,
}

#[derive(Debug, Clone)]
struct MetadataState {
    name: String,
    current_year: i32,
    eras: Vec<EraSnapshot>,
    timeline_events: Vec<TimelineEventSnapshot>,
}

#[derive(Debug, Clone)]
enum EditOperation {
    Feature {
        feature_id: String,
        year: i32,
        before: Option<FeatureRevisionState>,
        after: FeatureRevisionState,
    },
    Metadata {
        before: MetadataState,
        after: MetadataState,
    },
    CellAttributes {
        year: i32,
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

fn normalize_timeline_events(
    events: Vec<SaveTimelineEventInput>,
) -> Result<Vec<TimelineEventSnapshot>, AppError> {
    if events.len() > 100_000 {
        return Err(AppError::invalid(
            "The project contains too many timeline events.",
        ));
    }
    let mut ids = HashSet::with_capacity(events.len());
    events
        .into_iter()
        .map(|event| {
            validate_name(&event.title)?;
            if event.description.chars().count() > 10_000 {
                return Err(AppError::invalid(
                    "The timeline event description is too long.",
                ));
            }
            if let Some(end_year) = event.end_year
                && end_year < event.start_year
            {
                return Err(AppError::invalid(
                    "A timeline event end year cannot be earlier than its start year.",
                ));
            }
            let id = match event.id {
                Some(id) => Uuid::parse_str(id.trim())
                    .map_err(|_| AppError::invalid("A timeline event identifier is invalid."))?
                    .to_string(),
                None => Uuid::new_v4().to_string(),
            };
            if !ids.insert(id.clone()) {
                return Err(AppError::invalid(
                    "Timeline event identifiers must be unique.",
                ));
            }
            Ok(TimelineEventSnapshot {
                id,
                title: event.title.trim().to_owned(),
                description: event.description.trim().to_owned(),
                start_year: event.start_year,
                end_year: event.end_year,
            })
        })
        .collect()
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
        CREATE TABLE IF NOT EXISTS cell_grid (
            id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
            grid_version INTEGER NOT NULL CHECK (grid_version = 1),
            grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),
            grid_rows INTEGER NOT NULL CHECK (grid_rows = 256)
        );
        CREATE TABLE IF NOT EXISTS cell_edit_operations (
            id TEXT PRIMARY KEY NOT NULL,
            valid_from_year INTEGER NOT NULL,
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            UNIQUE (valid_from_year, sequence)
        );
        CREATE TABLE IF NOT EXISTS cell_attribute_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL REFERENCES cell_edit_operations(id),
            grid_version INTEGER NOT NULL CHECK (grid_version = 1),
            cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),
            cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),
            layer TEXT NOT NULL CHECK (layer IN ('terrain_kind','forest','country','region')),
            valid_from_year INTEGER NOT NULL,
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            value TEXT,
            deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
            UNIQUE (grid_version, cell_x, cell_y, layer, valid_from_year, sequence)
        );
        CREATE INDEX IF NOT EXISTS cell_attribute_revisions_lookup
            ON cell_attribute_revisions(
                grid_version, cell_x, cell_y, layer, valid_from_year DESC, sequence DESC
            );
        CREATE INDEX IF NOT EXISTS cell_attribute_revisions_view
            ON cell_attribute_revisions(valid_from_year, sequence);
        CREATE TRIGGER IF NOT EXISTS cell_attribute_revision_sequence_monotonic
        BEFORE INSERT ON cell_attribute_revisions
        WHEN EXISTS (
            SELECT 1 FROM cell_attribute_revisions AS previous
            WHERE previous.grid_version = NEW.grid_version
              AND previous.cell_x = NEW.cell_x
              AND previous.cell_y = NEW.cell_y
              AND previous.layer = NEW.layer
              AND previous.valid_from_year = NEW.valid_from_year
              AND NEW.sequence <= previous.sequence
        )
        BEGIN
            SELECT RAISE(ABORT, 'cell revision sequence must increase');
        END;
        CREATE TRIGGER IF NOT EXISTS cell_attribute_revision_no_update
        BEFORE UPDATE ON cell_attribute_revisions
        BEGIN
            SELECT RAISE(ABORT, 'cell attribute revisions are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS cell_attribute_revision_no_delete
        BEFORE DELETE ON cell_attribute_revisions
        BEGIN
            SELECT RAISE(ABORT, 'cell attribute revisions are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS cell_edit_operation_no_update
        BEFORE UPDATE ON cell_edit_operations
        BEGIN
            SELECT RAISE(ABORT, 'cell edit operations are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS cell_edit_operation_no_delete
        BEFORE DELETE ON cell_edit_operations
        BEGIN
            SELECT RAISE(ABORT, 'cell edit operations are append-only');
        END;
        INSERT OR IGNORE INTO cell_grid(id, grid_version, grid_columns, grid_rows)
            VALUES (1, 1, 512, 256);
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
        .execute_batch(&format!("PRAGMA user_version = {CURRENT_SCHEMA_VERSION};"))
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

fn verify_base_schema(connection: &Connection) -> Result<(), AppError> {
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

fn verify_cell_schema(connection: &Connection) -> Result<(), AppError> {
    let required_columns = [
        ("cell_grid", CELL_GRID_COLUMNS),
        ("cell_edit_operations", CELL_OPERATION_COLUMNS),
        ("cell_attribute_revisions", CELL_REVISION_COLUMNS),
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
    let operation_sql = normalized_object_sql(connection, "table", "cell_edit_operations")?;
    for invariant in [
        "check (sequence >= 0)",
        "unique (valid_from_year, sequence)",
    ] {
        if !operation_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    let revision_sql = normalized_object_sql(connection, "table", "cell_attribute_revisions")?;
    for invariant in [
        "check (grid_version = 1)",
        "check (cell_x >= 0 and cell_x < 512)",
        "check (cell_y >= 0 and cell_y < 256)",
        "check (layer in ('terrain_kind','forest','country','region'))",
        "check (sequence >= 0)",
        "check (deleted in (0, 1))",
        "unique (grid_version, cell_x, cell_y, layer, valid_from_year, sequence)",
    ] {
        if !revision_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    for (index, expected) in [
        (
            "cell_attribute_revisions_lookup",
            &[
                "grid_version",
                "cell_x",
                "cell_y",
                "layer",
                "valid_from_year",
                "sequence",
            ][..],
        ),
        (
            "cell_attribute_revisions_view",
            &["valid_from_year", "sequence"][..],
        ),
    ] {
        if index_columns(connection, index)? != expected {
            return Err(corrupt_schema());
        }
    }

    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_list(cell_attribute_revisions)")
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
            "cell_edit_operations".to_owned(),
            "operation_id".to_owned(),
            "id".to_owned(),
            "NO ACTION".to_owned(),
            "NO ACTION".to_owned(),
        )]
    {
        return Err(corrupt_schema());
    }
    for (trigger, invariants) in [
        (
            "cell_attribute_revision_sequence_monotonic",
            &[
                "before insert on cell_attribute_revisions",
                "previous.cell_x = new.cell_x",
                "previous.cell_y = new.cell_y",
                "previous.layer = new.layer",
                "new.sequence <= previous.sequence",
            ][..],
        ),
        (
            "cell_attribute_revision_no_update",
            &[
                "before update on cell_attribute_revisions",
                "cell attribute revisions are append-only",
            ][..],
        ),
        (
            "cell_attribute_revision_no_delete",
            &[
                "before delete on cell_attribute_revisions",
                "cell attribute revisions are append-only",
            ][..],
        ),
        (
            "cell_edit_operation_no_update",
            &[
                "before update on cell_edit_operations",
                "cell edit operations are append-only",
            ][..],
        ),
        (
            "cell_edit_operation_no_delete",
            &[
                "before delete on cell_edit_operations",
                "cell edit operations are append-only",
            ][..],
        ),
    ] {
        let sql = normalized_object_sql(connection, "trigger", trigger)?;
        if invariants.iter().any(|invariant| !sql.contains(invariant)) {
            return Err(corrupt_schema());
        }
    }
    let grid_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM cell_grid", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if grid_count != 1 {
        return Err(corrupt_schema());
    }
    Ok(())
}

fn verify_schema(connection: &Connection) -> Result<(), AppError> {
    verify_base_schema(connection)?;
    verify_cell_schema(connection)
}

fn project_snapshot_at(
    project: &OpenProject,
    requested_year: Option<i32>,
) -> Result<ProjectSnapshot, AppError> {
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
    let view_year = requested_year.unwrap_or(current_year);
    let mut feature_query = project
        .connection
        .prepare(
            "
            SELECT f.id, f.feature_type, r.name, r.geometry_json, r.valid_from_year
            FROM features AS f
            JOIN feature_revisions AS r ON r.id = (
                SELECT latest.id FROM feature_revisions AS latest
                WHERE latest.feature_id = f.id AND latest.valid_from_year <= ?1
                ORDER BY latest.valid_from_year DESC, latest.sequence DESC
                LIMIT 1
            )
            WHERE r.deleted = 0
            ORDER BY f.feature_type, r.name, f.id
            ",
        )
        .map_err(AppError::from)?;
    let feature_rows = feature_query
        .query_map([view_year], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i32>(4)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let features = feature_rows
        .into_iter()
        .map(|(id, feature_type, name, geometry_json, valid_from_year)| {
            let geometry_json = geometry_json.ok_or_else(|| {
                AppError::new("corrupt_project", "A visible feature has no geometry.")
            })?;
            let geometry = serde_json::from_str(&geometry_json).map_err(|_| {
                AppError::new("corrupt_project", "A feature contains invalid geometry.")
            })?;
            let feature_type = FeatureType::from_storage(&feature_type)?;
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
                valid_from_year,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let mut event_query = project
        .connection
        .prepare(
            "SELECT id, title, description, start_year, end_year
             FROM timeline_events ORDER BY start_year, sequence, id",
        )
        .map_err(AppError::from)?;
    let timeline_events = event_query
        .query_map([], |row| {
            Ok(TimelineEventSnapshot {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                start_year: row.get(3)?,
                end_year: row.get(4)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let feature_count = i64::try_from(features.len())
        .map_err(|_| AppError::new("storage_error", "The feature count is unavailable."))?;

    Ok(ProjectSnapshot {
        format_version: CURRENT_SCHEMA_VERSION,
        path: project.path.to_string_lossy().into_owned(),
        world: WorldSnapshot {
            id: world_id,
            name: world_name,
            current_year: view_year,
        },
        eras,
        features,
        timeline_events,
        feature_count,
        can_undo: !project.undo_stack.is_empty(),
        can_redo: !project.redo_stack.is_empty(),
    })
}

fn project_snapshot(project: &OpenProject) -> Result<ProjectSnapshot, AppError> {
    project_snapshot_at(project, None)
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
    if user_version < 1 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses an unsupported older Realm format.",
        ));
    }

    if user_version == 1 {
        verify_base_schema(connection)?;
    } else {
        verify_schema(connection)?;
    }
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

fn migrate_schema(connection: &mut Connection, from_version: i32) -> Result<(), AppError> {
    if from_version == CURRENT_SCHEMA_VERSION {
        return Ok(());
    }
    if from_version != 1 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses an unsupported older Realm format.",
        ));
    }
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "
            CREATE TABLE cell_grid (
                id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
                grid_version INTEGER NOT NULL CHECK (grid_version = 1),
                grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),
                grid_rows INTEGER NOT NULL CHECK (grid_rows = 256)
            );
            CREATE TABLE cell_edit_operations (
                id TEXT PRIMARY KEY NOT NULL,
                valid_from_year INTEGER NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 0),
                UNIQUE (valid_from_year, sequence)
            );
            CREATE TABLE cell_attribute_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_id TEXT NOT NULL REFERENCES cell_edit_operations(id),
                grid_version INTEGER NOT NULL CHECK (grid_version = 1),
                cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),
                cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),
                layer TEXT NOT NULL CHECK (layer IN ('terrain_kind','forest','country','region')),
                valid_from_year INTEGER NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 0),
                value TEXT,
                deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
                UNIQUE (grid_version, cell_x, cell_y, layer, valid_from_year, sequence)
            );
            CREATE INDEX cell_attribute_revisions_lookup
                ON cell_attribute_revisions(
                    grid_version, cell_x, cell_y, layer, valid_from_year DESC, sequence DESC
                );
            CREATE INDEX cell_attribute_revisions_view
                ON cell_attribute_revisions(valid_from_year, sequence);
            CREATE TRIGGER cell_attribute_revision_sequence_monotonic
            BEFORE INSERT ON cell_attribute_revisions
            WHEN EXISTS (
                SELECT 1 FROM cell_attribute_revisions AS previous
                WHERE previous.grid_version = NEW.grid_version
                  AND previous.cell_x = NEW.cell_x
                  AND previous.cell_y = NEW.cell_y
                  AND previous.layer = NEW.layer
                  AND previous.valid_from_year = NEW.valid_from_year
                  AND NEW.sequence <= previous.sequence
            )
            BEGIN
                SELECT RAISE(ABORT, 'cell revision sequence must increase');
            END;
            CREATE TRIGGER cell_attribute_revision_no_update
            BEFORE UPDATE ON cell_attribute_revisions
            BEGIN
                SELECT RAISE(ABORT, 'cell attribute revisions are append-only');
            END;
            CREATE TRIGGER cell_attribute_revision_no_delete
            BEFORE DELETE ON cell_attribute_revisions
            BEGIN
                SELECT RAISE(ABORT, 'cell attribute revisions are append-only');
            END;
            CREATE TRIGGER cell_edit_operation_no_update
            BEFORE UPDATE ON cell_edit_operations
            BEGIN
                SELECT RAISE(ABORT, 'cell edit operations are append-only');
            END;
            CREATE TRIGGER cell_edit_operation_no_delete
            BEFORE DELETE ON cell_edit_operations
            BEGIN
                SELECT RAISE(ABORT, 'cell edit operations are append-only');
            END;
            INSERT INTO cell_grid(id, grid_version, grid_columns, grid_rows)
                VALUES (1, 1, 512, 256);
            INSERT INTO schema_migrations(version) VALUES (2);
            PRAGMA user_version = 2;
            ",
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)
}

fn open_connection(path: &Path) -> Result<Connection, AppError> {
    let (path, existing_version) = preflight_existing_project(path)?;

    let mut connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(AppError::from)?;
    configure_connection(&connection)?;
    migrate_schema(&mut connection, existing_version)?;
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
    let (name, current_year): (String, i32) = connection
        .query_row("SELECT name, current_year FROM world LIMIT 1", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(AppError::from)?;
    Ok(ProjectSummary {
        library_id,
        name,
        current_year,
    })
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
    // selected external file. The copied internal file is migrated by open_connection below.
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

fn metadata_state(project: &OpenProject) -> Result<MetadataState, AppError> {
    let snapshot = project_snapshot(project)?;
    Ok(MetadataState {
        name: snapshot.world.name,
        current_year: snapshot.world.current_year,
        eras: snapshot.eras,
        timeline_events: snapshot.timeline_events,
    })
}

fn apply_metadata(project: &mut OpenProject, state: &MetadataState) -> Result<(), AppError> {
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    let world_count = transaction
        .execute(
            "UPDATE world SET name = ?1, current_year = ?2",
            params![state.name, state.current_year],
        )
        .map_err(AppError::from)?;
    if world_count != 1 {
        return Err(AppError::new(
            "corrupt_project",
            "The project must contain exactly one world record.",
        ));
    }
    transaction
        .execute("DELETE FROM eras", [])
        .map_err(AppError::from)?;
    for era in &state.eras {
        transaction
            .execute(
                "INSERT INTO eras(id, name, start_year, end_year) VALUES (?1, ?2, ?3, ?4)",
                params![era.id, era.name, era.start_year, era.end_year],
            )
            .map_err(AppError::from)?;
    }
    transaction
        .execute("DELETE FROM timeline_events", [])
        .map_err(AppError::from)?;
    let mut last_start_year = None;
    let mut sequence = 0_i64;
    for event in &state.timeline_events {
        if last_start_year == Some(event.start_year) {
            sequence += 1;
        } else {
            last_start_year = Some(event.start_year);
            sequence = 0;
        }
        transaction
            .execute(
                "INSERT INTO timeline_events(id, title, description, start_year, end_year, sequence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    event.id,
                    event.title,
                    event.description,
                    event.start_year,
                    event.end_year,
                    sequence
                ],
            )
            .map_err(AppError::from)?;
    }
    transaction.commit().map_err(AppError::from)
}

fn latest_feature_state(
    connection: &Connection,
    feature_id: &str,
    year: i32,
) -> Result<Option<FeatureRevisionState>, AppError> {
    let result = connection.query_row(
        "SELECT name, geometry_json, deleted FROM feature_revisions
         WHERE feature_id = ?1 AND valid_from_year <= ?2
         ORDER BY valid_from_year DESC, sequence DESC LIMIT 1",
        params![feature_id, year],
        |row| {
            Ok(FeatureRevisionState {
                name: row.get(0)?,
                geometry_json: row.get(1)?,
                deleted: row.get::<_, i64>(2)? != 0,
            })
        },
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn append_feature_revision(
    connection: &Connection,
    feature_id: &str,
    year: i32,
    state: &FeatureRevisionState,
) -> Result<(), AppError> {
    let sequence: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM feature_revisions
             WHERE feature_id = ?1 AND valid_from_year = ?2",
            params![feature_id, year],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    connection
        .execute(
            "INSERT INTO feature_revisions(
                feature_id, valid_from_year, sequence, name, geometry_json, deleted
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                feature_id,
                year,
                sequence,
                state.name,
                state.geometry_json,
                i64::from(state.deleted)
            ],
        )
        .map_err(AppError::from)?;
    Ok(())
}

fn feature_type_for_id(connection: &Connection, feature_id: &str) -> Result<FeatureType, AppError> {
    let stored = connection
        .query_row(
            "SELECT feature_type FROM features WHERE id = ?1",
            [feature_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| match error {
            SqlError::QueryReturnedNoRows => {
                AppError::new("not_found", "The feature was not found.")
            }
            other => other.into(),
        })?;
    FeatureType::from_storage(&stored)
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

fn validate_cell_value(layer: CellLayer, value: Option<&str>) -> Result<(), AppError> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 200 {
        return Err(AppError::invalid("A cell attribute value is invalid."));
    }
    // Cell labels remain independent from polygon features. This lets a user assign a
    // temporary political name before drawing or revising its corresponding overlay.
    let _ = layer;
    Ok(())
}

fn latest_cell_state(
    connection: &Connection,
    x: i32,
    y: i32,
    layer: CellLayer,
    year: i32,
) -> Result<Option<CellRevisionState>, AppError> {
    let result = connection.query_row(
        "SELECT r.value, r.deleted
         FROM cell_attribute_revisions AS r
         JOIN cell_edit_operations AS o ON o.id = r.operation_id
         WHERE r.grid_version = ?1 AND r.cell_x = ?2 AND r.cell_y = ?3
           AND r.layer = ?4 AND o.valid_from_year <= ?5
         ORDER BY o.valid_from_year DESC, o.sequence DESC, r.id DESC
         LIMIT 1",
        params![GRID_VERSION, x, y, layer.as_str(), year],
        |row| {
            Ok(CellRevisionState {
                value: row.get(0)?,
                deleted: row.get::<_, i64>(1)? != 0,
            })
        },
    );
    match result {
        Ok(state) => Ok(Some(state)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn append_cell_batch(
    connection: &Connection,
    year: i32,
    changes: &[CellEditChange],
) -> Result<(), AppError> {
    if changes.is_empty() {
        return Err(AppError::invalid("At least one cell must be selected."));
    }
    let sequence: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1
             FROM cell_edit_operations WHERE valid_from_year = ?1",
            [year],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    let operation_id = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO cell_edit_operations(id, valid_from_year, sequence)
             VALUES (?1, ?2, ?3)",
            params![operation_id, year, sequence],
        )
        .map_err(AppError::from)?;
    for change in changes {
        let state = &change.after;
        connection
            .execute(
                "INSERT INTO cell_attribute_revisions(
                    operation_id, grid_version, cell_x, cell_y, layer,
                    valid_from_year, sequence, value, deleted
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    operation_id,
                    GRID_VERSION,
                    change.x,
                    change.y,
                    change.layer.as_str(),
                    year,
                    sequence,
                    state.value.as_deref(),
                    i64::from(state.deleted),
                ],
            )
            .map_err(AppError::from)?;
    }
    Ok(())
}

fn cell_attributes_snapshot(
    project: &OpenProject,
    input: CellViewportInput,
) -> Result<Vec<CellAttributeSnapshot>, AppError> {
    validate_year(input.year)?;
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
            "SELECT r.cell_x, r.cell_y, r.layer, r.value, o.valid_from_year
         FROM cell_attribute_revisions AS r
         JOIN cell_edit_operations AS o ON o.id = r.operation_id
         WHERE r.grid_version = ?1 AND r.cell_x BETWEEN ?2 AND ?3
           AND r.cell_y BETWEEN ?4 AND ?5 AND o.valid_from_year <= ?6
           AND r.id = (
             SELECT latest.id
             FROM cell_attribute_revisions AS latest
             JOIN cell_edit_operations AS latest_op ON latest_op.id = latest.operation_id
             WHERE latest.grid_version = r.grid_version
               AND latest.cell_x = r.cell_x AND latest.cell_y = r.cell_y
               AND latest.layer = r.layer
               AND latest_op.valid_from_year <= ?6
             ORDER BY latest_op.valid_from_year DESC, latest_op.sequence DESC, latest.id DESC
             LIMIT 1
           ) AND r.deleted = 0 AND r.value IS NOT NULL
         ORDER BY r.cell_y, r.cell_x, r.layer",
        )
        .map_err(AppError::from)?;
    let rows = query
        .query_map(
            params![GRID_VERSION, min_x, max_x, min_y, max_y, input.year],
            |row| {
                let layer_value: String = row.get(2)?;
                let layer = CellLayer::from_storage(&layer_value)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(CellAttributeSnapshot {
                    cell_id: cell_id(row.get(0)?, row.get(1)?),
                    attribute: layer,
                    value: row.get(3)?,
                    valid_from_year: row.get(4)?,
                })
            },
        )
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(rows)
}

fn save_project_in_state(
    state: &AppState,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_name(&input.name)?;
    validate_year(input.current_year)?;
    let eras = normalize_eras(input.eras)?;
    let mut timeline_events = normalize_timeline_events(input.timeline_events)?;
    timeline_events.sort_by_key(|event| event.start_year);
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    let before = metadata_state(project)?;
    let after = MetadataState {
        name: input.name.trim().to_owned(),
        current_year: input.current_year,
        eras,
        timeline_events,
    };
    apply_metadata(project, &after)?;
    project.undo_stack.push(EditOperation::Metadata {
        before,
        after: after.clone(),
    });
    project.redo_stack.clear();
    project_snapshot(project)
}

#[tauri::command]
fn save_project(
    state: tauri::State<'_, AppState>,
    input: SaveProjectInput,
) -> Result<ProjectSnapshot, AppError> {
    save_project_in_state(state.inner(), input)
}

fn view_project_year_in_state(state: &AppState, year: i32) -> Result<ProjectSnapshot, AppError> {
    let open = lock_project(state)?;
    let project = open
        .as_ref()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    project_snapshot_at(project, Some(year))
}

#[tauri::command]
fn view_project_year(
    state: tauri::State<'_, AppState>,
    year: i32,
) -> Result<ProjectSnapshot, AppError> {
    view_project_year_in_state(state.inner(), year)
}

fn apply_cell_attributes_in_state(
    state: &AppState,
    input: ApplyCellAttributesInput,
) -> Result<ProjectSnapshot, AppError> {
    validate_year(input.year)?;
    let cells = normalize_cell_ids(input.cell_ids)?;
    let mut open = lock_project(state)?;
    let project = open
        .as_mut()
        .ok_or_else(|| AppError::new("no_open_project", "No project is open."))?;
    validate_cell_value(input.attribute, input.value.as_deref())?;
    let value = input.value.map(|value| value.trim().to_owned());
    let after = CellRevisionState {
        deleted: value.is_none(),
        value,
    };
    let changes = cells
        .into_iter()
        .map(|(x, y)| {
            Ok(CellEditChange {
                x,
                y,
                layer: input.attribute,
                before: latest_cell_state(&project.connection, x, y, input.attribute, input.year)?,
                after: after.clone(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    append_cell_batch(&transaction, input.year, &changes)?;
    transaction
        .execute("UPDATE world SET current_year = ?1", [input.year])
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::CellAttributes {
        year: input.year,
        changes,
    });
    project.redo_stack.clear();
    project_snapshot_at(project, Some(input.year))
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
    let after = FeatureRevisionState {
        name: input.name.trim().to_owned(),
        geometry_json: Some(geometry_json),
        deleted: false,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    transaction
        .execute(
            "INSERT INTO features(id, feature_type) VALUES (?1, ?2)",
            params![feature_id, input.feature_type.as_str()],
        )
        .map_err(AppError::from)?;
    append_feature_revision(&transaction, &feature_id, input.valid_from_year, &after)?;
    transaction
        .execute(
            "UPDATE world SET current_year = ?1",
            [input.valid_from_year],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        year: input.valid_from_year,
        before: None,
        after,
    });
    project.redo_stack.clear();
    project_snapshot_at(project, Some(input.valid_from_year))
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
    let feature_type = feature_type_for_id(&project.connection, &feature_id)?;
    let geometry_json = validate_geometry(feature_type, &input.geometry)?;
    let before = latest_feature_state(&project.connection, &feature_id, input.valid_from_year)?
        .filter(|revision| !revision.deleted)
        .ok_or_else(|| AppError::new("not_found", "The feature is not visible at this year."))?;
    let after = FeatureRevisionState {
        name: input.name.trim().to_owned(),
        geometry_json: Some(geometry_json),
        deleted: false,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    append_feature_revision(&transaction, &feature_id, input.valid_from_year, &after)?;
    transaction
        .execute(
            "UPDATE world SET current_year = ?1",
            [input.valid_from_year],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        year: input.valid_from_year,
        before: Some(before),
        after,
    });
    project.redo_stack.clear();
    project_snapshot_at(project, Some(input.valid_from_year))
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
    feature_type_for_id(&project.connection, &feature_id)?;
    let before = latest_feature_state(&project.connection, &feature_id, input.valid_from_year)?
        .filter(|revision| !revision.deleted)
        .ok_or_else(|| AppError::new("not_found", "The feature is not visible at this year."))?;
    let after = FeatureRevisionState {
        name: before.name.clone(),
        geometry_json: None,
        deleted: true,
    };
    let transaction = project.connection.transaction().map_err(AppError::from)?;
    append_feature_revision(&transaction, &feature_id, input.valid_from_year, &after)?;
    transaction
        .execute(
            "UPDATE world SET current_year = ?1",
            [input.valid_from_year],
        )
        .map_err(AppError::from)?;
    transaction.commit().map_err(AppError::from)?;
    project.undo_stack.push(EditOperation::Feature {
        feature_id,
        year: input.valid_from_year,
        before: Some(before),
        after,
    });
    project.redo_stack.clear();
    project_snapshot_at(project, Some(input.valid_from_year))
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
) -> Result<i32, AppError> {
    match operation {
        EditOperation::Feature {
            feature_id,
            year,
            before,
            after,
        } => {
            let state = if forward {
                after.clone()
            } else {
                before.clone().unwrap_or_else(|| FeatureRevisionState {
                    name: after.name.clone(),
                    geometry_json: None,
                    deleted: true,
                })
            };
            let transaction = project.connection.transaction().map_err(AppError::from)?;
            append_feature_revision(&transaction, feature_id, *year, &state)?;
            transaction
                .execute("UPDATE world SET current_year = ?1", [year])
                .map_err(AppError::from)?;
            transaction.commit().map_err(AppError::from)?;
            Ok(*year)
        }
        EditOperation::Metadata { before, after } => {
            let state = if forward { after } else { before };
            apply_metadata(project, state)?;
            Ok(state.current_year)
        }
        EditOperation::CellAttributes { year, changes } => {
            let compensating = changes
                .iter()
                .map(|change| {
                    let after = if forward {
                        change.after.clone()
                    } else {
                        change.before.clone().unwrap_or(CellRevisionState {
                            value: None,
                            deleted: true,
                        })
                    };
                    CellEditChange {
                        x: change.x,
                        y: change.y,
                        layer: change.layer,
                        before: None,
                        after,
                    }
                })
                .collect::<Vec<_>>();
            let transaction = project.connection.transaction().map_err(AppError::from)?;
            append_cell_batch(&transaction, *year, &compensating)?;
            transaction
                .execute("UPDATE world SET current_year = ?1", [year])
                .map_err(AppError::from)?;
            transaction.commit().map_err(AppError::from)?;
            Ok(*year)
        }
    }
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
    let year = match apply_edit_operation(project, &operation, false) {
        Ok(year) => year,
        Err(error) => {
            project.undo_stack.push(operation);
            return Err(error);
        }
    };
    project.redo_stack.push(operation);
    project_snapshot_at(project, Some(year))
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
    let year = match apply_edit_operation(project, &operation, true) {
        Ok(year) => year,
        Err(error) => {
            project.redo_stack.push(operation);
            return Err(error);
        }
    };
    project.undo_stack.push(operation);
    project_snapshot_at(project, Some(year))
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
            view_project_year,
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
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
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
    fn artifact_publication_validates_extension_size_and_no_replace() {
        let directory = tempdir().unwrap();
        let artifact = directory.path().join("map.png");
        let png = b"\x89PNG\r\n\x1a\nsynthetic".to_vec();
        write_artifact(artifact.to_string_lossy().into_owned(), png.clone()).unwrap();
        assert_eq!(fs::read(&artifact).unwrap(), png);

        let error = write_artifact(artifact.to_string_lossy().into_owned(), vec![9]).unwrap_err();
        assert_eq!(error.code, "already_exists");
        assert_eq!(fs::read(&artifact).unwrap(), b"\x89PNG\r\n\x1a\nsynthetic");

        let error = write_artifact(
            directory
                .path()
                .join("map.txt")
                .to_string_lossy()
                .into_owned(),
            vec![1],
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_input");

        let error = write_artifact(
            directory
                .path()
                .join("wrong.pdf")
                .to_string_lossy()
                .into_owned(),
            b"\x89PNG\r\n\x1a\nsynthetic".to_vec(),
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_input");

        let error = write_artifact(
            directory
                .path()
                .join("large.pdf")
                .to_string_lossy()
                .into_owned(),
            vec![0; MAX_ARTIFACT_BYTES + 1],
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_input");
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
                timeline_events: vec![
                    SaveTimelineEventInput {
                        id: None,
                        title: "Founding".into(),
                        description: "A synthetic event".into(),
                        start_year: 1200,
                        end_year: None,
                    },
                    SaveTimelineEventInput {
                        id: None,
                        title: "Treaty".into(),
                        description: String::new(),
                        start_year: 1200,
                        end_year: Some(1201),
                    },
                ],
            },
        )
        .unwrap();
        assert_eq!(snapshot.world.name, "After");
        assert_eq!(snapshot.world.current_year, 1234);
        assert_eq!(snapshot.eras.len(), 1);
        assert_eq!(snapshot.timeline_events.len(), 2);
        assert!(Uuid::parse_str(&snapshot.eras[0].id).is_ok());
        let era_id = snapshot.eras[0].id.clone();
        let failed = save_project_in_state(
            &state,
            SaveProjectInput {
                name: "".into(),
                current_year: 0,
                eras: vec![],
                timeline_events: vec![],
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
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        };
        let reopened = project_snapshot(&reopened).unwrap();
        assert_eq!(reopened.world.current_year, 1234);
        assert_eq!(reopened.eras[0].id, era_id);
        assert_eq!(reopened.timeline_events.len(), 2);
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

    fn geometry_for(feature_type: FeatureType) -> Value {
        match feature_type.geometry_type() {
            "Point" => serde_json::json!({ "type": "Point", "coordinates": [12.0, 34.0] }),
            "LineString" => serde_json::json!({
                "type": "LineString",
                "coordinates": [[0.0, 0.0], [10.0, 10.0]]
            }),
            "Polygon" => serde_json::json!({
                "type": "Polygon",
                "coordinates": [[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 0.0]]]
            }),
            _ => unreachable!(),
        }
    }

    #[test]
    fn all_feature_classes_round_trip_revisions_deletions_and_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("features.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(path.clone(), "Features").unwrap());
        let feature_types = [
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
        let mut feature_ids = Vec::new();

        for feature_type in feature_types {
            let created = create_feature_in_state(
                &state,
                CreateFeatureInput {
                    feature_type,
                    name: format!("{} original", feature_type.as_str()),
                    valid_from_year: -10,
                    geometry: geometry_for(feature_type),
                },
            )
            .unwrap();
            let id = created
                .features
                .iter()
                .find(|feature| feature.feature_type == feature_type)
                .unwrap()
                .id
                .clone();
            revise_feature_in_state(
                &state,
                ReviseFeatureInput {
                    id: id.clone(),
                    name: format!("{} revised", feature_type.as_str()),
                    valid_from_year: 5,
                    geometry: geometry_for(feature_type),
                },
            )
            .unwrap();
            delete_feature_in_state(
                &state,
                DeleteFeatureInput {
                    id: id.clone(),
                    valid_from_year: 10,
                },
            )
            .unwrap();
            feature_ids.push(id);
        }

        let old = view_project_year_in_state(&state, -10).unwrap();
        assert_eq!(old.features.len(), 9);
        assert!(
            old.features
                .iter()
                .all(|feature| feature.name.ends_with("original"))
        );
        let revised = view_project_year_in_state(&state, 5).unwrap();
        assert_eq!(revised.features.len(), 9);
        assert!(
            revised
                .features
                .iter()
                .all(|feature| feature.name.ends_with("revised"))
        );
        assert!(
            view_project_year_in_state(&state, 10)
                .unwrap()
                .features
                .is_empty()
        );

        let first_id = feature_ids.first().unwrap().clone();
        revise_feature_in_state(
            &state,
            ReviseFeatureInput {
                id: first_id.clone(),
                name: "same-year winner".into(),
                valid_from_year: 5,
                geometry: geometry_for(FeatureType::Terrain),
            },
        )
        .unwrap();
        let same_year = view_project_year_in_state(&state, 5).unwrap();
        assert_eq!(
            same_year
                .features
                .iter()
                .find(|feature| feature.id == first_id)
                .unwrap()
                .name,
            "same-year winner"
        );

        close_project_in_state(&state).unwrap();
        *state.project.lock().unwrap() = Some(OpenProject {
            path,
            connection: open_connection(&directory.path().join("features.realmmap")).unwrap(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        });
        assert_eq!(
            view_project_year_in_state(&state, -10)
                .unwrap()
                .features
                .len(),
            9
        );
        assert!(
            view_project_year_in_state(&state, 10)
                .unwrap()
                .features
                .is_empty()
        );
    }

    #[test]
    fn feature_undo_and_redo_append_history_without_erasing_revisions() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("undo.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() = Some(create_project_inner(path, "Undo").unwrap());
        let created = create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::City,
                name: "City".into(),
                valid_from_year: i32::MIN,
                geometry: geometry_for(FeatureType::City),
            },
        )
        .unwrap();
        let id = created.features[0].id.clone();
        let undone = undo_project_in_state(&state).unwrap();
        assert!(undone.features.is_empty());
        assert!(undone.can_redo);
        let redone = redo_project_in_state(&state).unwrap();
        assert_eq!(redone.features[0].id, id);
        let revision_count: i64 = state
            .project
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .connection
            .query_row(
                "SELECT COUNT(*) FROM feature_revisions WHERE feature_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(revision_count, 3);
    }

    #[test]
    fn cell_attribute_batch_round_trips_layers_years_and_grouped_undo() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("cells.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() = Some(create_project_inner(path, "Cells").unwrap());

        apply_cell_attributes_in_state(
            &state,
            ApplyCellAttributesInput {
                year: -10,
                cell_ids: vec!["1:2".into(), "2:2".into(), "1:2".into()],
                attribute: CellLayer::TerrainKind,
                value: Some("mountain".into()),
            },
        )
        .unwrap();
        apply_cell_attributes_in_state(
            &state,
            ApplyCellAttributesInput {
                year: -10,
                cell_ids: vec!["1:2".into()],
                attribute: CellLayer::Forest,
                value: Some("on".into()),
            },
        )
        .unwrap();
        let current = view_cell_attributes_in_state(
            &state,
            CellViewportInput {
                year: -10,
                min_x: None,
                max_x: None,
                min_y: None,
                max_y: None,
            },
        )
        .unwrap();
        assert_eq!(current.len(), 3);
        assert!(
            current
                .iter()
                .any(|cell| cell.cell_id == "1:2" && cell.attribute == CellLayer::Forest)
        );

        apply_cell_attributes_in_state(
            &state,
            ApplyCellAttributesInput {
                year: 0,
                cell_ids: vec!["1:2".into()],
                attribute: CellLayer::TerrainKind,
                value: None,
            },
        )
        .unwrap();
        let cleared = view_cell_attributes_in_state(
            &state,
            CellViewportInput {
                year: 0,
                min_x: Some(1),
                max_x: Some(1),
                min_y: Some(2),
                max_y: Some(2),
            },
        )
        .unwrap();
        assert_eq!(cleared.len(), 1);
        assert_eq!(cleared[0].attribute, CellLayer::Forest);

        undo_project_in_state(&state).unwrap();
        let restored = view_cell_attributes_in_state(
            &state,
            CellViewportInput {
                year: 0,
                min_x: Some(1),
                max_x: Some(1),
                min_y: Some(2),
                max_y: Some(2),
            },
        )
        .unwrap();
        assert_eq!(restored.len(), 2);
        redo_project_in_state(&state).unwrap();
        assert_eq!(
            view_cell_attributes_in_state(
                &state,
                CellViewportInput {
                    year: 0,
                    min_x: Some(1),
                    max_x: Some(1),
                    min_y: Some(2),
                    max_y: Some(2),
                },
            )
            .unwrap()
            .len(),
            1
        );
    }

    #[test]
    fn v1_project_migrates_to_the_cell_schema_without_losing_features() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("v1.realmmap");
        let project = create_project_inner(path.clone(), "Legacy").unwrap();
        let feature_id = Uuid::new_v4().to_string();
        project
            .connection
            .execute(
                "INSERT INTO features(id, feature_type) VALUES (?1, 'terrain')",
                [&feature_id],
            )
            .unwrap();
        project
            .connection
            .execute(
                "INSERT INTO feature_revisions(feature_id, valid_from_year, sequence, name, geometry_json, deleted)
                 VALUES (?1, 0, 0, 'Legacy terrain', '{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[1,1],[0,0]]]}', 0)",
                [&feature_id],
            )
            .unwrap();
        project
            .connection
            .execute_batch(
                "DROP TABLE cell_attribute_revisions;
                 DROP TABLE cell_edit_operations;
                 DROP TABLE cell_grid;
                 DELETE FROM schema_migrations WHERE version = 2;
                 INSERT INTO schema_migrations(version) VALUES (1);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(project);

        let migrated = open_connection(&path).unwrap();
        let migrated_project = OpenProject {
            path,
            connection: migrated,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        };
        assert_eq!(
            project_snapshot(&migrated_project).unwrap().features.len(),
            1
        );
        let version: i32 = migrated_project
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn failed_v1_cell_migration_rolls_back_without_changing_source_version() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("v1-failure.realmmap");
        let project = create_project_inner(path.clone(), "Legacy").unwrap();
        project
            .connection
            .execute_batch(
                "DROP TABLE cell_attribute_revisions;
                 DROP TABLE cell_edit_operations;
                 DROP TABLE cell_grid;
                 CREATE TABLE cell_grid(conflict INTEGER);
                 DELETE FROM schema_migrations WHERE version = 2;
                 INSERT INTO schema_migrations(version) VALUES (1);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(project);

        assert!(open_connection(&path).is_err());
        let connection = Connection::open(&path).unwrap();
        let version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let recorded: i32 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 1);
        assert_eq!(recorded, 1);
        let columns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('cell_grid')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 1);
    }

    #[test]
    fn invalid_geometry_leaves_feature_tables_unchanged() {
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
                valid_from_year: i32::MAX,
                geometry: serde_json::json!({ "type": "Point", "coordinates": [181, 0] }),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_input");
        let feature_count: i64 = state
            .project
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .connection
            .query_row("SELECT COUNT(*) FROM features", [], |row| row.get(0))
            .unwrap();
        assert_eq!(feature_count, 0);
    }

    #[test]
    fn snapshot_rejects_geometry_that_does_not_match_feature_class() {
        let directory = tempdir().unwrap();
        let mut project =
            create_project_inner(directory.path().join("mismatch.realmmap"), "Mismatch").unwrap();
        let transaction = project.connection.transaction().unwrap();
        let id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO features(id, feature_type) VALUES (?1, 'city')",
                [&id],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO feature_revisions(feature_id, valid_from_year, sequence, name, geometry_json, deleted)
                 VALUES (?1, 0, 0, 'Mismatch', '{\"type\":\"LineString\",\"coordinates\":[[0,0],[1,1]]}', 0)",
                [&id],
            )
            .unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            project_snapshot(&project).unwrap_err().code,
            "corrupt_project"
        );
    }

    #[test]
    fn feature_transaction_rolls_back_when_revision_insert_fails() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        let project = create_project_inner(
            directory.path().join("rollback-feature.realmmap"),
            "Rollback",
        )
        .unwrap();
        project
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_test_revision
                 BEFORE INSERT ON feature_revisions
                 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
            )
            .unwrap();
        *state.project.lock().unwrap() = Some(project);
        let error = create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::Town,
                name: "Town".into(),
                valid_from_year: 0,
                geometry: geometry_for(FeatureType::Town),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "storage_constraint");
        let project = state.project.lock().unwrap();
        let feature_count: i64 = project
            .as_ref()
            .unwrap()
            .connection
            .query_row("SELECT COUNT(*) FROM features", [], |row| row.get(0))
            .unwrap();
        assert_eq!(feature_count, 0);
    }

    #[test]
    fn close_and_get_open_project_are_safe_when_empty() {
        let state = direct_state();
        assert!(get_open_project_in_state(&state).unwrap().is_none());
        close_project_in_state(&state).unwrap();
    }
}
