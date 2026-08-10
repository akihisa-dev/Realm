#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Realm 0.1 series supports only Apple Silicon macOS targets.");

mod commands;
mod contract;
mod domain;
mod edit;
mod error;
mod read_model;
mod state;
mod storage;
pub(crate) use commands::{assets::*, cells::*, features::*, library::*, project::*};
pub use contract::*;
pub use error::AppError;
pub use state::AppState;
pub(crate) use storage::write_artifact;

#[cfg(test)]
pub(crate) use domain::geometry::MAX_FEATURE_PROPERTIES_BYTES;
#[cfg(test)]
pub(crate) use read_model::*;
#[cfg(test)]
pub(crate) use state::OpenProject;
#[cfg(test)]
pub(crate) use storage::artifact::MAX_ARTIFACT_BYTES;
#[cfg(test)]
pub(crate) use storage::{atomic::*, path::*, project::*, schema::*};

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
            update_project_settings,
            import_asset,
            read_asset,
            delete_asset,
            save_project,
            apply_cell_attributes,
            view_cell_attributes,
            create_feature,
            create_features_batch,
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
    use rusqlite::Connection;
    use serde_json::Value;
    use std::{fs, path::Path};
    use tempfile::tempdir;
    use uuid::Uuid;

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

    fn create_v3_fixture(path: &Path, name: &str) {
        let mut connection = Connection::open(path).unwrap();
        configure_new_connection(&connection).unwrap();
        let transaction = connection.transaction().unwrap();
        transaction
            .execute_batch(
                "
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE world (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
                CREATE TABLE features (
                    id TEXT PRIMARY KEY NOT NULL,
                    feature_type TEXT NOT NULL CHECK (feature_type IN
                        ('terrain','forest','river','coastline','country','region','boundary','city','town')),
                    name TEXT NOT NULL,
                    geometry_json TEXT NOT NULL CHECK (json_valid(geometry_json))
                );
                CREATE TABLE cell_grid (
                    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
                    grid_version INTEGER NOT NULL CHECK (grid_version = 1),
                    grid_columns INTEGER NOT NULL CHECK (grid_columns = 512),
                    grid_rows INTEGER NOT NULL CHECK (grid_rows = 256)
                );
                CREATE TABLE cell_attributes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    grid_version INTEGER NOT NULL CHECK (grid_version = 1),
                    cell_x INTEGER NOT NULL CHECK (cell_x >= 0 AND cell_x < 512),
                    cell_y INTEGER NOT NULL CHECK (cell_y >= 0 AND cell_y < 256),
                    layer TEXT NOT NULL CHECK (layer IN ('forest','country','region')),
                    value TEXT NOT NULL,
                    UNIQUE (grid_version, cell_x, cell_y, layer)
                );
                CREATE INDEX cell_attributes_lookup
                    ON cell_attributes(grid_version, cell_x, cell_y, layer);
                INSERT INTO schema_migrations(version) VALUES (3);
                INSERT INTO cell_grid(id, grid_version, grid_columns, grid_rows) VALUES (1, 1, 512, 256);
                PRAGMA user_version = 3;
                ",
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO world(id, name) VALUES ('00000000-0000-4000-8000-000000000003', ?1)",
                [name],
            )
            .unwrap();
        transaction.commit().unwrap();
    }

    fn create_v4_fixture(path: &Path, name: &str) {
        create_v3_fixture(path, name);
        let mut connection = Connection::open(path).unwrap();
        migrate_v3_to_v4(&mut connection).unwrap();
    }

    fn create_v5_fixture(path: &Path, name: &str) {
        create_v4_fixture(path, name);
        let mut connection = Connection::open(path).unwrap();
        migrate_v4_to_v5(&mut connection).unwrap();
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
        let jpeg_artifact = directory.path().join("map.jpg");
        let jpeg = b"\xff\xd8\xffsynthetic".to_vec();
        write_artifact(jpeg_artifact.to_string_lossy().into_owned(), jpeg.clone()).unwrap();
        assert_eq!(fs::read(&jpeg_artifact).unwrap(), jpeg);
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
                    .join("wrong.jpg")
                    .to_string_lossy()
                    .into_owned(),
                b"not-jpeg".to_vec(),
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
        assert_eq!(world_columns, vec!["id", "name", "settings_json"]);
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
                properties: serde_json::json!({}),
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
                properties: serde_json::json!({}),
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
                    properties: serde_json::json!({}),
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
    fn v3_migrates_to_v6_without_changing_existing_features() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("v3.realmmap");
        create_v3_fixture(&path, "Legacy");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO features(id, feature_type, name, geometry_json) VALUES (?1, 'city', 'Old City', ?2)",
                rusqlite::params![
                    "00000000-0000-4000-8000-000000000004",
                    serde_json::json!({"type":"Point","coordinates":[1.0,2.0]}).to_string(),
                ],
            )
            .unwrap();
        drop(connection);
        assert_eq!(preflight_existing_project(&path).unwrap().1, 3);
        let migrated = open_connection(&path).unwrap();
        validate_existing_schema(&migrated).unwrap();
        assert_eq!(
            migrated
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        let feature: (String, String) = migrated
            .query_row(
                "SELECT name, properties_json FROM features WHERE id = '00000000-0000-4000-8000-000000000004'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(feature, ("Old City".into(), "{}".into()));
    }

    #[test]
    fn v4_migrates_to_v6_with_empty_asset_store() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("v4.realmmap");
        create_v4_fixture(&path, "Legacy v4");
        assert_eq!(preflight_existing_project(&path).unwrap().1, 4);
        let connection = open_connection(&path).unwrap();
        validate_existing_schema(&connection).unwrap();
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert!(object_exists(&connection, "table", "assets").unwrap());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM assets", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn v5_migrates_to_v6_with_default_settings() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("v5.realmmap");
        create_v5_fixture(&path, "Legacy v5");
        assert_eq!(preflight_existing_project(&path).unwrap().1, 5);
        let connection = open_connection(&path).unwrap();
        validate_existing_schema(&connection).unwrap();
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        let settings: String = connection
            .query_row("SELECT settings_json FROM world", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&settings).unwrap(),
            crate::domain::settings::default_settings()
        );
    }

    #[test]
    fn failed_v5_to_v6_migration_rolls_back_source() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("failed-v5.realmmap");
        create_v5_fixture(&path, "Legacy v5");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER migration_failure_v6 BEFORE INSERT ON schema_migrations
                 WHEN NEW.version = 6 BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;",
            )
            .unwrap();
        drop(connection);
        let before = fs::read(&path).unwrap();
        assert_eq!(
            open_connection(&path).unwrap_err().code,
            "storage_constraint"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        let check = Connection::open(&path).unwrap();
        assert_eq!(
            check
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            5
        );
    }

    #[test]
    fn failed_v4_to_v6_migration_rolls_back_source() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("failed-v4.realmmap");
        create_v4_fixture(&path, "Legacy v4");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER migration_failure_v5 BEFORE INSERT ON schema_migrations
                 WHEN NEW.version = 5 BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;",
            )
            .unwrap();
        drop(connection);
        let before = fs::read(&path).unwrap();
        assert_eq!(
            open_connection(&path).unwrap_err().code,
            "storage_constraint"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        let check = Connection::open(&path).unwrap();
        assert_eq!(
            check
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            4
        );
    }

    #[test]
    fn embedded_asset_import_read_delete_and_undo_are_transactional() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(directory.path().join("assets.realmmap"), "Assets").unwrap());
        let bytes = b"\x89PNG\r\n\x1a\nasset".to_vec();
        let imported = import_asset_in_state(
            &state,
            ImportAssetInput {
                sha256: Some(crate::domain::assets::sha256_hex(&bytes)),
                mime: "image/png".into(),
                bytes: bytes.clone(),
                width: 32,
                height: 16,
                metadata: serde_json::json!({"role": "mountain"}),
            },
        )
        .unwrap();
        assert_eq!(imported.assets.len(), 1);
        let id = imported.assets[0].id.clone();
        assert_eq!(imported.assets[0].byte_length, bytes.len() as i64);
        let read = read_asset_in_state(&state, AssetIdInput { id: id.clone() }).unwrap();
        assert_eq!(read.bytes, bytes);
        undo_project_in_state(&state).unwrap();
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .assets
                .is_empty()
        );
        redo_project_in_state(&state).unwrap();
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .assets
                .len(),
            1
        );
        delete_asset_in_state(&state, AssetIdInput { id: id.clone() }).unwrap();
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .assets
                .is_empty()
        );
        undo_project_in_state(&state).unwrap();
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .assets
                .len(),
            1
        );
        close_project_in_state(&state).unwrap();
        *state.project.lock().unwrap() = Some(OpenProject {
            path: directory.path().join("assets.realmmap"),
            connection: open_connection(&directory.path().join("assets.realmmap")).unwrap(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        });
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .assets
                .len(),
            1
        );
    }

    #[test]
    fn asset_import_rejects_mime_bytes_and_hash_mismatch() {
        assert_eq!(
            crate::domain::assets::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(directory.path().join("asset-validation.realmmap"), "Assets")
                .unwrap(),
        );
        let cases = [
            ("text/plain", b"plain".to_vec(), None),
            (
                "image/png",
                b"not-png".to_vec(),
                Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
            ),
        ];
        for (mime, bytes, sha256) in cases {
            assert_eq!(
                import_asset_in_state(
                    &state,
                    ImportAssetInput {
                        sha256,
                        mime: mime.into(),
                        bytes,
                        width: 1,
                        height: 1,
                        metadata: serde_json::json!({}),
                    },
                )
                .unwrap_err()
                .code,
                "invalid_input"
            );
        }
    }

    #[test]
    fn referenced_asset_cannot_be_deleted() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(directory.path().join("asset-reference.realmmap"), "Assets")
                .unwrap(),
        );
        let bytes = b"\x89PNG\r\n\x1a\nasset".to_vec();
        let snapshot = import_asset_in_state(
            &state,
            ImportAssetInput {
                sha256: None,
                mime: "image/png".into(),
                bytes,
                width: 1,
                height: 1,
                metadata: serde_json::json!({}),
            },
        )
        .unwrap();
        let asset_id = snapshot.assets[0].id.clone();
        create_feature_in_state(
            &state,
            CreateFeatureInput {
                feature_type: FeatureType::Mountain,
                name: "Mountain".into(),
                geometry: geometry_for(FeatureType::Mountain),
                properties: serde_json::json!({"assetId": asset_id}),
            },
        )
        .unwrap();
        assert_eq!(
            delete_asset_in_state(&state, AssetIdInput { id: asset_id })
                .unwrap_err()
                .code,
            "asset_in_use"
        );
    }

    #[test]
    fn failed_v3_migration_rolls_back_and_preserves_source_bytes() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("failed-v3.realmmap");
        create_v3_fixture(&path, "Legacy");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER migration_failure BEFORE INSERT ON schema_migrations
                 WHEN NEW.version = 4 BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;",
            )
            .unwrap();
        drop(connection);
        let before = fs::read(&path).unwrap();
        let error = open_connection(&path).unwrap_err();
        assert_eq!(error.code, "storage_constraint");
        assert_eq!(fs::read(&path).unwrap(), before);
        let check = Connection::open(&path).unwrap();
        assert_eq!(
            check
                .pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))
                .unwrap(),
            3
        );
    }

    #[test]
    fn new_feature_classes_round_trip_geometry_and_properties() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("drawing-classes.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(path.clone(), "Drawing classes").unwrap());
        let types = [
            FeatureType::Road,
            FeatureType::Lake,
            FeatureType::Mountain,
            FeatureType::Tree,
            FeatureType::Symbol,
            FeatureType::Label,
            FeatureType::Overlay,
            FeatureType::Frame,
            FeatureType::Scale,
        ];
        for feature_type in types {
            create_feature_in_state(
                &state,
                CreateFeatureInput {
                    feature_type,
                    name: feature_type.as_str().to_owned(),
                    geometry: geometry_for(feature_type),
                    properties: serde_json::json!({"kind": feature_type.as_str(), "size": 2}),
                },
            )
            .unwrap();
        }
        let snapshot = get_open_project_in_state(&state).unwrap().unwrap();
        assert_eq!(snapshot.features.len(), types.len());
        assert!(
            snapshot
                .features
                .iter()
                .all(|feature| feature.properties.get("kind").is_some())
        );
        close_project_in_state(&state).unwrap();
        *state.project.lock().unwrap() = Some(OpenProject {
            path: path.clone(),
            connection: open_connection(&path).unwrap(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        });
        let reopened = get_open_project_in_state(&state).unwrap().unwrap();
        assert_eq!(reopened.features.len(), types.len());
        assert!(
            reopened
                .features
                .iter()
                .all(|feature| feature.properties.get("kind").is_some())
        );
    }

    #[test]
    fn feature_properties_require_bounded_objects() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(directory.path().join("properties.realmmap"), "Properties")
                .unwrap(),
        );
        for properties in [serde_json::json!(null), serde_json::json!([1, 2, 3])] {
            assert_eq!(
                create_feature_in_state(
                    &state,
                    CreateFeatureInput {
                        feature_type: FeatureType::Mountain,
                        name: "Invalid".into(),
                        geometry: geometry_for(FeatureType::Mountain),
                        properties,
                    },
                )
                .unwrap_err()
                .code,
                "invalid_input"
            );
        }
        let too_large =
            serde_json::json!({ "description": "x".repeat(MAX_FEATURE_PROPERTIES_BYTES) });
        assert_eq!(
            create_feature_in_state(
                &state,
                CreateFeatureInput {
                    feature_type: FeatureType::Mountain,
                    name: "Too large".into(),
                    geometry: geometry_for(FeatureType::Mountain),
                    properties: too_large,
                },
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
    }

    #[test]
    fn feature_batch_is_one_transaction_and_one_undo_step() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(directory.path().join("batch.realmmap"), "Batch").unwrap());
        let input = CreateFeaturesBatchInput {
            features: vec![
                CreateFeatureInput {
                    feature_type: FeatureType::Mountain,
                    name: "A".into(),
                    geometry: geometry_for(FeatureType::Mountain),
                    properties: serde_json::json!({"index": 1}),
                },
                CreateFeatureInput {
                    feature_type: FeatureType::Tree,
                    name: "B".into(),
                    geometry: geometry_for(FeatureType::Tree),
                    properties: serde_json::json!({"index": 2}),
                },
            ],
        };
        create_features_batch_in_state(&state, input).unwrap();
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .len(),
            2
        );
        undo_project_in_state(&state).unwrap();
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .is_empty()
        );
        redo_project_in_state(&state).unwrap();
        assert_eq!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .len(),
            2
        );
    }

    #[test]
    fn feature_batch_validates_all_before_writing_and_has_a_bound() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(directory.path().join("batch-validation.realmmap"), "Batch")
                .unwrap(),
        );
        let mut invalid = vec![CreateFeatureInput {
            feature_type: FeatureType::Mountain,
            name: "Valid".into(),
            geometry: geometry_for(FeatureType::Mountain),
            properties: serde_json::json!({}),
        }];
        invalid.push(CreateFeatureInput {
            feature_type: FeatureType::Road,
            name: "Invalid".into(),
            geometry: geometry_for(FeatureType::Road),
            properties: serde_json::json!(null),
        });
        assert_eq!(
            create_features_batch_in_state(&state, CreateFeaturesBatchInput { features: invalid })
                .unwrap_err()
                .code,
            "invalid_input"
        );
        assert!(
            get_open_project_in_state(&state)
                .unwrap()
                .unwrap()
                .features
                .is_empty()
        );
        let too_many = (0..(MAX_FEATURE_BATCH + 1))
            .map(|index| CreateFeatureInput {
                feature_type: FeatureType::Tree,
                name: format!("Tree {index}"),
                geometry: geometry_for(FeatureType::Tree),
                properties: serde_json::json!({}),
            })
            .collect();
        assert_eq!(
            create_features_batch_in_state(
                &state,
                CreateFeaturesBatchInput { features: too_many },
            )
            .unwrap_err()
            .code,
            "invalid_input"
        );
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
    fn project_settings_replace_undo_redo_and_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("settings.realmmap");
        let state = direct_state();
        *state.project.lock().unwrap() =
            Some(create_project_inner(path.clone(), "Settings").unwrap());
        let replacement = serde_json::json!({
            "themeId": "midnight",
            "showGrid": false,
            "exportScale": 4,
            "exportExtent": "viewport"
        });
        let updated = update_project_settings_in_state(
            &state,
            UpdateProjectSettingsInput {
                settings: replacement.clone(),
            },
        )
        .unwrap();
        assert_eq!(updated.settings, replacement);
        assert_eq!(
            undo_project_in_state(&state).unwrap().settings,
            crate::domain::settings::default_settings()
        );
        assert_eq!(redo_project_in_state(&state).unwrap().settings, replacement);
        close_project_in_state(&state).unwrap();
        *state.project.lock().unwrap() = Some(OpenProject {
            path: path.clone(),
            connection: open_connection(&path).unwrap(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        });
        assert_eq!(
            get_open_project_in_state(&state).unwrap().unwrap().settings,
            replacement
        );
    }

    #[test]
    fn project_settings_reject_unknown_or_invalid_keys() {
        let directory = tempdir().unwrap();
        let state = direct_state();
        *state.project.lock().unwrap() = Some(
            create_project_inner(
                directory.path().join("settings-validation.realmmap"),
                "Settings",
            )
            .unwrap(),
        );
        let invalid = [
            serde_json::json!({"themeId":"ink","showGrid":true,"exportScale":1,"exportExtent":"world","zoom":2}),
            serde_json::json!({"themeId":"ink","showGrid":true,"exportScale":3,"exportExtent":"world"}),
            serde_json::json!({"themeId":"ink","showGrid":true,"exportScale":1}),
            serde_json::json!("viewport"),
        ];
        for settings in invalid {
            assert_eq!(
                update_project_settings_in_state(&state, UpdateProjectSettingsInput { settings })
                    .unwrap_err()
                    .code,
                "invalid_input"
            );
        }
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
                properties: serde_json::json!({}),
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
                properties: serde_json::json!({}),
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
