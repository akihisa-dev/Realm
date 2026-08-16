/**
 * Characterization inventory for the Electron storage boundary.
 *
 * The references intentionally name the existing legacy/React tests instead of
 * importing implementation details.  An Electron storage test can add its
 * own suite name while retaining the same requirement id and comparison
 * fixture. This keeps the characterization gate about observable behaviour
 * rather than a one-to-one module rewrite.
 */
export type MigrationRequirement = {
  id: string;
  area: "storage" | "ui" | "renderer";
  observable: string;
  baselineEvidence: readonly string[];
  electronSuite: string;
};

export const migrationInventory = [
  {
    id: "schema12-layer-storage",
    area: "storage",
    observable: "Schema versions before 12 are rejected without mutation; schema 12 stores terrain, region, and object layers in separate tables.",
    baselineEvidence: [
      "schema_11_creates_map_shapes_without_cell_attributes",
      "schema_11_round_trips_polygon_geometry_and_shape_ids",
      "legacy_schema_rejection_preserves_source_bytes",
    ],
    electronSuite: "migration-tests/electronStorage.test.ts :: creates, mutates, reopens and restores one undoable current-state transaction",
  },
  {
    id: "schema-rejection",
    area: "storage",
    observable: "Corrupt, partial, legacy, retired, and future schemas are rejected before mutation.",
    baselineEvidence: [
      "rejects_mismatch_partial_and_weakened_schema_without_writing",
      "corrupt_sqlite_source_remains_unchanged",
      "legacy_schema_is_rejected_without_mutating_source",
      "future_schema_is_rejected_without_changing_journal_mode",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: rejects unsupported, future, corrupt, partial, and retired schemas without mutation",
  },
  {
    id: "source-identity",
    area: "storage",
    observable: "Source content hash, inode identity, and SQLite sidecar set stay unchanged during import or rejection.",
    baselineEvidence: [
      "snapshot_rejects_same_size_mtime_restored_in_place_mutation_and_cleans_private_copy",
      "sqlite_snapshot_import_includes_uncheckpointed_wal_rows_and_preserves_source",
      "copy_synced_file_leaves_source_unchanged",
      "transfer_services_round_trip_wal_without_source_mutation",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: rejects path replacement before writable open and same-inode content mutation",
  },
  {
    id: "wal-snapshot",
    area: "storage",
    observable: "A snapshot includes committed WAL pages while leaving the source database and sidecars untouched.",
    baselineEvidence: [
      "sqlite_snapshot_import_includes_uncheckpointed_wal_rows_and_preserves_source",
      "transfer_services_round_trip_wal_without_source_mutation",
      "sqlite_snapshot_failure_cleans_staging_and_does_not_publish_destination",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: round-trips an uncheckpointed WAL through transfer while source bytes and sidecars stay immutable",
  },
  {
    id: "path-safety",
    area: "storage",
    observable: "Wrong extension, missing parent, symlink, path replacement, and parent replacement fail closed.",
    baselineEvidence: [
      "path_validation_rejects_wrong_extension_missing_parent_directory_and_symlink",
      "open_rejects_path_replacement_before_writable_open",
      "open_rejects_same_inode_content_mutation_before_migration",
      "parent_replacement_is_rejected_without_publishing_to_new_directory",
      "staging_foreign_replacement_is_rejected_and_preserved_without_destination",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: rejects sidecar content replacement and source-parent replacement without publishing",
  },
  {
    id: "atomic-publication",
    area: "storage",
    observable: "Publication is no-replace and durable; fsync failure reports an error without deleting the published file.",
    baselineEvidence: [
      "atomic_publication_never_replaces_existing_file",
      "parent_sync_failure_reports_durability_error_without_removing_published_file",
      "validated_snapshot_drop_does_not_remove_foreign_replacement",
    ],
    electronSuite: "migration-tests/electronStorage.test.ts :: retains a published destination on parent sync failure and never deletes a foreign staging replacement",
  },
  {
    id: "migration-rollback",
    area: "storage",
    observable: "Legacy schema rejection preserves every source byte; current layer replacements roll back transactionally.",
    baselineEvidence: [
      "unsupported_schema_rejection_preserves_source_bytes",
      "shape_replacement_rolls_back_when_sqlite_rejects_map_shapes",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: rejects a legacy v%d source and preserves source bytes",
  },
  {
    id: "crud-transaction",
    area: "storage",
    observable: "Object/shape/asset CRUD batches validate before writing and commit as one transaction.",
    baselineEvidence: [
      "static_feature_crud_reopen_and_undo_redo",
      "feature_batch_is_one_transaction_and_one_undo_step",
      "feature_edit_batch_rolls_back_when_storage_fails",
      "static_map_shapes_round_trip_and_undo",
      "embedded_asset_import_read_delete_and_undo_are_transactional",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: rolls back object, Polygon-shape, and asset writes when SQLite rejects a transaction",
  },
  {
    id: "undo-redo",
    area: "storage",
    observable: "Successful edits expose one undo step, restore persisted shapes, and can be redone after reopen.",
    baselineEvidence: [
      "static_feature_crud_reopen_and_undo_redo",
      "map_shape_replacement_undo_redo_and_reopen",
      "project_settings_replace_undo_redo_and_reopen",
      "save_name_is_transactional_and_undoable",
    ],
    electronSuite: "migration-tests/storageParity.test.ts :: keeps one undo step per edit, restores state across undo/redo, and reopens persisted current state",
  },
  {
    id: "ui-editor-state",
    area: "ui",
    observable: "Editor opens directly, hides compatibility controls, and preserves loading/error/dirty state during async saves.",
    baselineEvidence: [
      "removes_the_duplicate_rail_while_keeping_the_map_editor",
      "shows_painted_terrain_while_the_save_IPC_is_still_pending",
      "shows_a_localized_drawing_error_from_the_message_catalog",
      "restores_persisted_terrain_after_a_painted_save_fails",
    ],
    electronSuite: "migration-tests/ui-editor-state",
  },
  {
    id: "ui-terrain-gestures",
    area: "ui",
    observable: "Paint/erase gestures use transient cell selection, commit canonical Polygon rows for the active layer, cancel safely, and never expose legacy rows as editable state.",
    baselineEvidence: [
      "applies_terrain_to_selected_hex_cells",
      "edits_terrain_directly_on_the_canvas_while_hiding_legacy_objects",
      "erases_terrain_cells_through_an_already_registered_map_callback_without_deleting_legacy_polygons",
      "removes_an_erased_cell_from_the_map_before_save_completes_and_restores_it_on_failure",
    ],
    electronSuite: "migration-tests/ui-terrain-gestures",
  },
  {
    id: "ui-undo-selection",
    area: "ui",
    observable: "Keyboard/click undo-redo and project selection reset transient selections while restoring canonical shapes.",
    baselineEvidence: [
      "returns_and_reapplies_the_latest_terrain_edit",
      "keeps_terrain_and_eraser_keyboard_shortcuts_without_a_rail",
      "clears_the_controlled_cell_selection_when_an_empty_paint_selection_arrives",
    ],
    electronSuite: "migration-tests/ui-undo-selection",
  },
  {
    id: "renderer-geometry",
    area: "renderer",
    observable: "OpenLayers produces bounded hex geometry, paint/erase footprints, styles, and finite world coordinates.",
    baselineEvidence: [
      "MapAdapter odd-row-offset centers and closed six-sided cells",
    "MapAdapter shows bounded cell erase footprints and transient previews",
      "drawingGeometry refines the paint footprint",
      "geoJsonGeometry guards bounded EPSG:4326 geometry",
      "styles excludes compatibility feature classes",
    ],
    electronSuite: "migration-tests/renderer-geometry",
  },
  {
    id: "renderer-lifecycle",
    area: "renderer",
    observable: "Map adapter handles pointer cancellation, wheel zoom, middle- and right-button pan, resize, and idempotent disposal.",
    baselineEvidence: [
      "MapAdapter pointer-exit/external-release/lost-capture/blur cancellation",
      "MapAdapter wheel zoom and middle- and right-button drag pan",
      "MapAdapter grid-fill recomputation on resize",
      "MapAdapter listener cleanup and idempotent disposal",
    ],
    electronSuite: "migration-tests/renderer-lifecycle",
  },
] as const satisfies readonly MigrationRequirement[];

export const migrationRequirementIds = migrationInventory.map(({ id }) => id);
