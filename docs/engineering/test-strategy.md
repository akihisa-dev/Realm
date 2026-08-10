# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and in-memory or temporary SQLite databases. Keep fixtures synthetic and free of personal locations.

| Layer | Main evidence |
| --- | --- |
| Pure Rust/model | world-name validation, geometry-class validation, cell ID/value validation, and stable identifiers |
| SQLite integration | every feature class, bounded properties and project settings, atomic feature batches, embedded asset validation/reference restrictions, static cell-layer coexistence, v3/v4/v5 migration to the current schema, schema invariants, transactions, rollback, session undo/redo, legacy-format rejection without source mutation, and library reopen |
| Tauri command boundary | app-data library isolation, UUID/path restrictions, read-only transfer preflight, atomic export, artifact size/extension bounds, typed errors, coarse command permissions |
| React/UI | library create/open/import, serialized automatic save, newer-draft preservation, PNG/JPEG/PDF and transfer actions, persisted theme/grid/export settings, feature tools and appearance controls, seeded scatter, embedded asset management, brush attribute/size/paint/erase controls, project-identity selection reset, stale request rejection, and undo/redo state |
| OpenLayers adapter | bounded and finite EPSG:4326 geometry, smoothed/simplified drawing, snapshot replacement, themed point/line/polygon and embedded-symbol rendering, lazy cell creation, round brush stamps, gap-free thick paths, world-edge rejection, cached property-sensitive styles, cancellation, pan/zoom, grid visibility, bounded high-resolution raster export, listener cleanup, and idempotent disposal |
| Repository | Markdown links, `git diff --check`, secret guard self-test, commit-by-commit version policy |
| macOS package | release-only static arm64 bundle, metadata, DMG, and checksum inspection; never launch the packaged app for testing |

Before a local push, run the formatter, Rust checks, strict TypeScript checks, and test scripts declared by the current app package, followed by the repository guards. Before a release tag, also build and statically inspect the arm64 package using the exact local release command documented by the app package.

Tests that require Realm to be running must be separately named, explicitly authorized for the current task, and performed through `Realmをテスト起動.command` or `script/build_and_run.sh`. Never launch a built, packaged, or installed `.app` for testing. GUI tests must not be silently included in the normal unit-test command.
