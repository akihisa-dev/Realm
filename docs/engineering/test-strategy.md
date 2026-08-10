# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and in-memory or temporary SQLite databases. Keep fixtures synthetic and free of personal locations.

| Layer | Main evidence |
| --- | --- |
| Pure Rust/model | world/era/event validation, geometry-class validation, cell ID/value validation, stable identifiers, year selection, same-year ordering |
| SQLite integration | all nine feature classes, version-1 to version-2 migration, cell-layer coexistence and batch history, schema invariants, transactions, rollback, append-only deletion and undo history, one-file reopen |
| Tauri command boundary | project input validation, path restrictions, typed errors, coarse command permissions |
| React/UI | feature tools, cell-selection inspector, feature and chronology edit forms, view-year changes, stale request rejection, undo/redo state |
| OpenLayers adapter | bounded EPSG:4326 canvas, snapshot replacement, point/line/polygon rendering, fixed-grid center-in-lasso selection, overlapping cell styles, cancellation, pan/zoom, and disposal |
| Repository | Markdown links, `git diff --check`, secret guard self-test, commit-by-commit version policy |
| macOS package | release-only static arm64 bundle, metadata, DMG, and checksum inspection; never launch the packaged app for testing |

Before a local push, run the formatter, Rust checks, strict TypeScript checks, and test scripts declared by the current app package, followed by the repository guards. Before a release tag, also build and statically inspect the arm64 package using the exact local release command documented by the app package.

Tests that require Realm to be running must be separately named, explicitly authorized for the current task, and performed through `Realmをテスト起動.command` or `script/build_and_run.sh`. Never launch a built, packaged, or installed `.app` for testing. GUI tests must not be silently included in the normal unit-test command.
