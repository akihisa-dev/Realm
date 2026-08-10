use crate::error::AppError;
use rusqlite::{Connection, Error as SqlError, Transaction, params};

pub(crate) const CURRENT_SCHEMA_VERSION: i32 = 6;
pub(crate) const PREVIOUS_SCHEMA_VERSION: i32 = 5;
pub(crate) const SCHEMA_VERSION_V3: i32 = 3;
pub(crate) const SCHEMA_VERSION_V4: i32 = 4;
pub(crate) const SETTINGS_MAX_BYTES: usize = 32 * 1024;
pub(crate) const DEFAULT_SETTINGS_JSON: &str =
    r#"{"themeId":"ink","showGrid":true,"exportScale":1,"exportExtent":"world"}"#;
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
const WORLD_COLUMNS_V5: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("name", "TEXT", true, false),
];
const WORLD_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("name", "TEXT", true, false),
    column("settings_json", "TEXT", true, false),
];
const FEATURE_COLUMNS_V3: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("feature_type", "TEXT", true, false),
    column("name", "TEXT", true, false),
    column("geometry_json", "TEXT", true, false),
];
const FEATURE_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("feature_type", "TEXT", true, false),
    column("name", "TEXT", true, false),
    column("geometry_json", "TEXT", true, false),
    column("properties_json", "TEXT", true, false),
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
const ASSET_COLUMNS: &[ColumnExpectation] = &[
    column("id", "TEXT", true, true),
    column("sha256", "TEXT", true, false),
    column("mime", "TEXT", true, false),
    column("bytes", "BLOB", true, false),
    column("width", "INTEGER", true, false),
    column("height", "INTEGER", true, false),
    column("metadata_json", "TEXT", true, false),
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
    transaction
        .execute_batch(
            "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS world (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            settings_json TEXT NOT NULL CHECK (json_valid(settings_json)
                AND json_type(settings_json) = 'object'
                AND length(settings_json) <= 32768
            )
        );
        CREATE TABLE IF NOT EXISTS features (
            id TEXT PRIMARY KEY NOT NULL,
            feature_type TEXT NOT NULL CHECK (feature_type IN
                ('terrain','forest','river','coastline','country','region','boundary','city','town',
                 'road','lake','mountain','tree','symbol','label','overlay','frame','scale')),
            name TEXT NOT NULL,
            geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
            properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')
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
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY NOT NULL,
            sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
            mime TEXT NOT NULL,
            bytes BLOB NOT NULL,
            width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),
            height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),
            metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
        );
        CREATE INDEX IF NOT EXISTS assets_sha256_lookup ON assets(sha256);
        INSERT OR IGNORE INTO cell_grid(id, grid_version, grid_columns, grid_rows)
            VALUES (1, 1, 512, 256);
        ",
        )
        .map_err(AppError::from)
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
            "INSERT INTO world(id, name, settings_json) VALUES (?1, ?2, ?3)",
            params![world_id, world_name.trim(), DEFAULT_SETTINGS_JSON],
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

fn verify_feature_schema(
    connection: &Connection,
    expected_columns: &[ColumnExpectation],
    feature_types: &[&str],
    has_properties: bool,
) -> Result<(), AppError> {
    verify_table(connection, "features", expected_columns)?;
    let feature_sql = normalized_object_sql(connection, "table", "features")?;
    for feature_type in feature_types {
        if !feature_sql.contains(feature_type) {
            return Err(corrupt_schema());
        }
    }
    if !feature_sql.contains("check (json_valid(geometry_json))") {
        return Err(corrupt_schema());
    }
    if has_properties
        && (!feature_sql.contains("check (json_valid(properties_json)")
            || !feature_sql.contains("json_type(properties_json) = 'object'"))
    {
        return Err(corrupt_schema());
    }
    Ok(())
}

fn verify_common_schema(
    connection: &Connection,
    world_columns: &[ColumnExpectation],
    feature_columns: &[ColumnExpectation],
    feature_types: &[&str],
    has_properties: bool,
) -> Result<(), AppError> {
    for (table, expected) in [
        ("schema_migrations", SCHEMA_MIGRATION_COLUMNS),
        ("cell_grid", CELL_GRID_COLUMNS),
        ("cell_attributes", CELL_ATTRIBUTE_COLUMNS),
    ] {
        verify_table(connection, table, expected)?;
    }
    verify_table(connection, "world", world_columns)?;
    verify_feature_schema(connection, feature_columns, feature_types, has_properties)?;
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

pub(crate) fn verify_schema_v3(connection: &Connection) -> Result<(), AppError> {
    verify_common_schema(
        connection,
        WORLD_COLUMNS_V5,
        FEATURE_COLUMNS_V3,
        &[
            "'terrain'",
            "'forest'",
            "'river'",
            "'coastline'",
            "'country'",
            "'region'",
            "'boundary'",
            "'city'",
            "'town'",
        ],
        false,
    )
}

fn verify_schema_shape(connection: &Connection) -> Result<(), AppError> {
    verify_common_schema(
        connection,
        WORLD_COLUMNS_V5,
        FEATURE_COLUMNS,
        &[
            "'terrain'",
            "'forest'",
            "'river'",
            "'coastline'",
            "'country'",
            "'region'",
            "'boundary'",
            "'city'",
            "'town'",
            "'road'",
            "'lake'",
            "'mountain'",
            "'tree'",
            "'symbol'",
            "'label'",
            "'overlay'",
            "'frame'",
            "'scale'",
        ],
        true,
    )?;
    Ok(())
}

fn verify_schema_shape_current(connection: &Connection) -> Result<(), AppError> {
    verify_common_schema(
        connection,
        WORLD_COLUMNS,
        FEATURE_COLUMNS,
        &[
            "'terrain'",
            "'forest'",
            "'river'",
            "'coastline'",
            "'country'",
            "'region'",
            "'boundary'",
            "'city'",
            "'town'",
            "'road'",
            "'lake'",
            "'mountain'",
            "'tree'",
            "'symbol'",
            "'label'",
            "'overlay'",
            "'frame'",
            "'scale'",
        ],
        true,
    )
}

pub(crate) fn verify_schema_v4(connection: &Connection) -> Result<(), AppError> {
    verify_schema_shape(connection)?;
    if object_exists(connection, "table", "assets")?
        || object_exists(connection, "index", "assets_sha256_lookup")?
        || object_exists(connection, "trigger", "assets_sha256_lookup")?
    {
        return Err(corrupt_schema());
    }
    Ok(())
}

fn verify_assets_schema(connection: &Connection) -> Result<(), AppError> {
    verify_table(connection, "assets", ASSET_COLUMNS)?;
    let asset_sql = normalized_object_sql(connection, "table", "assets")?;
    for invariant in [
        "unique",
        "check (length(sha256) = 64)",
        "check (width > 0",
        "check (height > 0",
        "check (json_valid(metadata_json)",
        "json_type(metadata_json) = 'object'",
    ] {
        if !asset_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    if index_columns(connection, "assets_sha256_lookup")? != ["sha256"] {
        return Err(corrupt_schema());
    }
    Ok(())
}

fn verify_schema_v5(connection: &Connection) -> Result<(), AppError> {
    verify_schema_shape(connection)?;
    verify_assets_schema(connection)
}

pub(crate) fn verify_schema(connection: &Connection) -> Result<(), AppError> {
    verify_schema_shape_current(connection)?;
    let world_sql = normalized_object_sql(connection, "table", "world")?;
    for invariant in [
        "check (json_valid(settings_json)",
        "json_type(settings_json) = 'object'",
        "length(settings_json) <= 32768",
    ] {
        if !world_sql.contains(invariant) {
            return Err(corrupt_schema());
        }
    }
    verify_assets_schema(connection)
}

fn read_schema_version(connection: &Connection) -> Result<i32, AppError> {
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
    Ok(user_version)
}

fn verify_world(connection: &Connection) -> Result<(), AppError> {
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

pub(crate) fn validate_existing_schema_for_preflight(
    connection: &Connection,
) -> Result<i32, AppError> {
    let version = read_schema_version(connection)?;
    match version {
        SCHEMA_VERSION_V3 => verify_schema_v3(connection)?,
        SCHEMA_VERSION_V4 => verify_schema_v4(connection)?,
        PREVIOUS_SCHEMA_VERSION => verify_schema_v5(connection)?,
        CURRENT_SCHEMA_VERSION => verify_schema(connection)?,
        _ => {
            return Err(AppError::new(
                "unsupported_schema",
                "This project uses a legacy Realm format that is no longer supported.",
            ));
        }
    }
    verify_world(connection)?;
    Ok(version)
}

pub(crate) fn validate_existing_schema(connection: &Connection) -> Result<(), AppError> {
    let version = read_schema_version(connection)?;
    if version != CURRENT_SCHEMA_VERSION {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema(connection)?;
    verify_world(connection)
}

pub(crate) fn migrate_v3_to_v4(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != SCHEMA_VERSION_V3 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v3(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "
            ALTER TABLE features RENAME TO features_v3;
            CREATE TABLE features (
                id TEXT PRIMARY KEY NOT NULL,
                feature_type TEXT NOT NULL CHECK (feature_type IN
                    ('terrain','forest','river','coastline','country','region','boundary','city','town',
                     'road','lake','mountain','tree','symbol','label','overlay','frame','scale')),
                name TEXT NOT NULL,
                geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
                properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')
            );
            INSERT INTO features(id, feature_type, name, geometry_json, properties_json)
                SELECT id, feature_type, name, geometry_json, '{}' FROM features_v3;
            DROP TABLE features_v3;
            INSERT INTO schema_migrations(version) VALUES (4);
            PRAGMA user_version = 4;
            ",
        )
        .map_err(AppError::from)?;
    verify_schema_v4(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}

pub(crate) fn migrate_v3_to_v5(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != SCHEMA_VERSION_V3 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v3(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "
            ALTER TABLE features RENAME TO features_v3;
            CREATE TABLE features (
                id TEXT PRIMARY KEY NOT NULL,
                feature_type TEXT NOT NULL CHECK (feature_type IN
                    ('terrain','forest','river','coastline','country','region','boundary','city','town',
                     'road','lake','mountain','tree','symbol','label','overlay','frame','scale')),
                name TEXT NOT NULL,
                geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
                properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')
            );
            INSERT INTO features(id, feature_type, name, geometry_json, properties_json)
                SELECT id, feature_type, name, geometry_json, '{}' FROM features_v3;
            DROP TABLE features_v3;
            INSERT INTO schema_migrations(version) VALUES (4);
            PRAGMA user_version = 4;
            ",
        )
        .map_err(AppError::from)?;
    verify_schema_v4(&transaction)?;
    verify_world(&transaction)?;
    transaction
        .execute_batch(
            "
            CREATE TABLE assets (
                id TEXT PRIMARY KEY NOT NULL,
                sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
                mime TEXT NOT NULL,
                bytes BLOB NOT NULL,
                width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),
                height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),
                metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
            );
            CREATE INDEX assets_sha256_lookup ON assets(sha256);
            INSERT INTO schema_migrations(version) VALUES (5);
            PRAGMA user_version = 5;
            ",
        )
        .map_err(AppError::from)?;
    verify_schema_v5(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}

pub(crate) fn migrate_v4_to_v5(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != SCHEMA_VERSION_V4 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v4(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "
            CREATE TABLE assets (
                id TEXT PRIMARY KEY NOT NULL,
                sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
                mime TEXT NOT NULL,
                bytes BLOB NOT NULL,
                width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),
                height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),
                metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
            );
            CREATE INDEX assets_sha256_lookup ON assets(sha256);
            INSERT INTO schema_migrations(version) VALUES (5);
            PRAGMA user_version = 5;
            ",
        )
        .map_err(AppError::from)?;
    verify_schema_v5(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}

fn rebuild_world_for_v6(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(&format!(
            "ALTER TABLE world RENAME TO world_v5;
             CREATE TABLE world (
                 id TEXT PRIMARY KEY NOT NULL,
                 name TEXT NOT NULL,
                 settings_json TEXT NOT NULL CHECK (json_valid(settings_json)
                     AND json_type(settings_json) = 'object'
                     AND length(settings_json) <= {SETTINGS_MAX_BYTES}
                 )
             );
             INSERT INTO world(id, name, settings_json)
                 SELECT id, name, '{DEFAULT_SETTINGS_JSON}';
             DROP TABLE world_v5;
             INSERT INTO schema_migrations(version) VALUES (6);
             PRAGMA user_version = 6;"
        ))
        .map_err(AppError::from)
}

pub(crate) fn migrate_v5_to_v6(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != PREVIOUS_SCHEMA_VERSION {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v5(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    rebuild_world_for_v6(&transaction)?;
    verify_schema(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}

pub(crate) fn migrate_v4_to_v6(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != SCHEMA_VERSION_V4 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v4(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "CREATE TABLE assets (
                id TEXT PRIMARY KEY NOT NULL,
                sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
                mime TEXT NOT NULL,
                bytes BLOB NOT NULL,
                width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),
                height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),
                metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
            );
            CREATE INDEX assets_sha256_lookup ON assets(sha256);
            INSERT INTO schema_migrations(version) VALUES (5);
            PRAGMA user_version = 5;",
        )
        .map_err(AppError::from)?;
    verify_schema_v5(&transaction)?;
    verify_world(&transaction)?;
    rebuild_world_for_v6(&transaction)?;
    verify_schema(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}

pub(crate) fn migrate_v3_to_v6(connection: &mut Connection) -> Result<(), AppError> {
    if read_schema_version(connection)? != SCHEMA_VERSION_V3 {
        return Err(AppError::new(
            "unsupported_schema",
            "This project uses a legacy Realm format that is no longer supported.",
        ));
    }
    verify_schema_v3(connection)?;
    verify_world(connection)?;
    let transaction = connection.transaction().map_err(AppError::from)?;
    transaction
        .execute_batch(
            "ALTER TABLE features RENAME TO features_v3;
             CREATE TABLE features (
                 id TEXT PRIMARY KEY NOT NULL,
                 feature_type TEXT NOT NULL CHECK (feature_type IN
                     ('terrain','forest','river','coastline','country','region','boundary','city','town',
                      'road','lake','mountain','tree','symbol','label','overlay','frame','scale')),
                 name TEXT NOT NULL,
                 geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json)),
                 properties_json TEXT NOT NULL CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object')
             );
             INSERT INTO features(id, feature_type, name, geometry_json, properties_json)
                 SELECT id, feature_type, name, geometry_json, '{}' FROM features_v3;
             DROP TABLE features_v3;
             INSERT INTO schema_migrations(version) VALUES (4);
             PRAGMA user_version = 4;",
        )
        .map_err(AppError::from)?;
    verify_schema_v4(&transaction)?;
    verify_world(&transaction)?;
    transaction
        .execute_batch(
            "CREATE TABLE assets (
                id TEXT PRIMARY KEY NOT NULL,
                sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
                mime TEXT NOT NULL,
                bytes BLOB NOT NULL,
                width INTEGER NOT NULL CHECK (width > 0 AND width <= 32768),
                height INTEGER NOT NULL CHECK (height > 0 AND height <= 32768),
                metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object')
            );
            CREATE INDEX assets_sha256_lookup ON assets(sha256);
            INSERT INTO schema_migrations(version) VALUES (5);
            PRAGMA user_version = 5;",
        )
        .map_err(AppError::from)?;
    verify_schema_v5(&transaction)?;
    verify_world(&transaction)?;
    rebuild_world_for_v6(&transaction)?;
    verify_schema(&transaction)?;
    verify_world(&transaction)?;
    transaction.commit().map_err(AppError::from)
}
