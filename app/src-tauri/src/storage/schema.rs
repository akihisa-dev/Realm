use crate::error::AppError;
use rusqlite::{Connection, Error as SqlError, Transaction, params};

pub(crate) const CURRENT_SCHEMA_VERSION: i32 = 3;
pub(crate) const GRID_VERSION: i32 = 1;
pub(crate) const GRID_COLUMNS: i32 = 512;
pub(crate) const GRID_ROWS: i32 = 256;
#[derive(Clone, Copy)]
pub(crate) struct ColumnExpectation {
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    primary_key: bool,
}
pub(crate) const fn column(
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

pub(crate) fn configure_connection(connection: &Connection) -> Result<(), AppError> {
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

pub(crate) fn configure_new_connection(connection: &Connection) -> Result<(), AppError> {
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

pub(crate) fn schema_sql(transaction: &Transaction<'_>) -> Result<(), AppError> {
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

pub(crate) fn initialize_schema_transaction(
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

pub(crate) fn initialize_new_schema(
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

pub(crate) fn corrupt_schema() -> AppError {
    AppError::new("corrupt_project", "The project schema is incomplete.")
}

pub(crate) fn normalized_object_sql(
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

pub(crate) fn index_columns(connection: &Connection, index: &str) -> Result<Vec<String>, AppError> {
    let pragma = format!("PRAGMA index_info({index})");
    let mut statement = connection.prepare(&pragma).map_err(AppError::from)?;
    statement
        .query_map([], |row| row.get::<_, String>(2))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub(crate) fn object_exists(
    connection: &Connection,
    object_type: &str,
    name: &str,
) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type=?1 AND name=?2)",
            params![object_type, name],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

pub(crate) fn verify_table(
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

pub(crate) fn verify_schema(connection: &Connection) -> Result<(), AppError> {
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

pub(crate) fn validate_existing_schema(connection: &Connection) -> Result<(), AppError> {
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
