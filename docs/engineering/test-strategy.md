# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and in-memory or temporary SQLite databases. Keep fixtures synthetic and free of personal locations.

| Layer | Main evidence |
| --- | --- |
| Pure Rust/model | world-name validation, geometry-class validation, cell ID/value validation, and stable identifiers |
| SQLite integration | terrain-cell writes, compatibility-feature round trips, strict write-geometry bounds, bounded palette/grid/canvas project settings, atomic terrain-cell batches, preservation of legacy assets and non-terrain cell layers, v3 through v7 migration to the current schema, schema invariants, transactions, rollback, session undo/redo, legacy-format rejection without source mutation, and library reopen |
| Tauri command boundary | app-data library isolation, UUID/path restrictions, read-only transfer preflight, atomic export, artifact size/extension bounds, typed errors, coarse command permissions |
| React/UI | direct editor launch with existing-world open or empty-library creation, absence of the startup/import surface, move/draw rail and palette eraser placement, accessible `描画範囲` and `消しゴム` flyouts with mode/thickness controls, four-direction non-overlapping palette anchoring, range changes without map click-through, top-row `戻す`/`進む`, absence of file/export/world-name/zoom/sidebar controls, discrete hex-cell paint/erase gestures, radial-palette outside-action dismissal without map click-through, project-identity selection reset, preservation and exclusion of compatibility rows, stale request rejection, and undo/redo state |
| OpenLayers adapter | odd-row-offset centers, closed six-sided interior cells, complete-world fit at relative zoom 1, fit recomputation on resize, draw paint footprint, grid and connected-cluster erase footprints with bounded thickness, bounded and finite EPSG:4326 geometry, terrain-cell fill and selection styles, compatibility feature exclusion, pointer-exit/external-release/lost-capture/blur cancellation, wheel zoom, always-available middle-button drag pan, bounded configured raster export and state restoration, listener cleanup, and idempotent disposal |
| Repository | Markdown links, `git diff --check`, secret guard self-test, commit-by-commit version policy |
| macOS package | release-only static arm64 bundle, metadata, DMG, and checksum inspection; never launch the packaged app for testing |

Before a local push, run the formatter, Rust checks, strict TypeScript checks, and test scripts declared by the current app package, followed by the repository guards. Before a release tag, also build and statically inspect the arm64 package using the exact local release command documented by the app package.

Tests that require Realm to be running must be separately named, explicitly authorized for the current task, and performed through `Realmをテスト起動.command` or `script/build_and_run.sh`. Never launch a built, packaged, or installed `.app` for testing. GUI tests must not be silently included in the normal unit-test command.
