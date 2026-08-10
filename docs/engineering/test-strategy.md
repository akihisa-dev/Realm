# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and in-memory or temporary SQLite databases. Keep fixtures synthetic and free of personal locations.

| Layer | Main evidence |
| --- | --- |
| Pure Rust/model | world-name validation, geometry-class validation, cell ID/value validation, and stable identifiers |
| SQLite integration | every feature class, strict write-geometry bounds, bounded palette/grid/canvas project settings, atomic create/revise/delete/lock feature batches, atomic asset-pack import/delete and reference restrictions, static cell-layer coexistence, v3/v4/v5/v6 migration to the current schema, schema invariants, transactions, rollback, session undo/redo, legacy-format rejection without source mutation, and library reopen |
| Tauri command boundary | app-data library isolation, UUID/path restrictions, read-only transfer preflight, atomic export, artifact size/extension bounds, typed errors, coarse command permissions |
| React/UI | library create/open/import, serialized automatic save, newer-draft preservation, PNG transparency/JPEG quality/PDF and transfer actions, persisted palette/grid/canvas/export settings, feature tools and appearance controls, polygon-hole and curved-label editing, multi-selection group/clipboard/layer edits, trace crop/frame/scale/territory controls, seeded scatter, grouped embedded asset management, brush attribute/size/paint/erase controls, project-identity selection reset, stale request rejection, and undo/redo state |
| OpenLayers adapter | bounded and finite EPSG:4326 geometry, freehand/vertex drawing, smoothing, configured and modifier angle snapping, lasso/keyboard nudge/layer order and locked-feature exclusion, snapshot replacement, palette-aware textured point/line/polygon presentation, four-corner trace/frame/scale, mirrored embedded-symbol and territory rendering, geographic/square/hex grids, lazy cell creation, pressure-aware brush preview, round brush stamps, gap-free thick paths, world-edge rejection, cached property-sensitive styles, cancellation, Command/Ctrl-wheel pan/zoom conventions, bounded configured raster export and state restoration, listener cleanup, and idempotent disposal |
| Repository | Markdown links, `git diff --check`, secret guard self-test, commit-by-commit version policy |
| macOS package | release-only static arm64 bundle, metadata, DMG, and checksum inspection; never launch the packaged app for testing |

Before a local push, run the formatter, Rust checks, strict TypeScript checks, and test scripts declared by the current app package, followed by the repository guards. Before a release tag, also build and statically inspect the arm64 package using the exact local release command documented by the app package.

Tests that require Realm to be running must be separately named, explicitly authorized for the current task, and performed through `Realmをテスト起動.command` or `script/build_and_run.sh`. Never launch a built, packaged, or installed `.app` for testing. GUI tests must not be silently included in the normal unit-test command.
