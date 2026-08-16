# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and synthetic in-memory or temporary SQLite databases. Never use an existing user `.realmmap` file.

| Layer | Main evidence |
| --- | --- |
| Pure domain/model | world-name and settings validation, layer/object kind validation, object geometry by kind, bounded properties, stable identifiers, grid polygon conversion, same-layer overlap rejection, and cross-layer overlap allowance |
| SQLite integration | schema 12 creation, separate `terrain_shapes` / `regions` / `region_shapes` / `objects` writes and round trips, object kinds and z-order, layer replacement transactions, asset references, undo/redo, reopen, malformed current-schema rejection, schema 1 through 11 rejection without source mutation, future/retired schema rejection, and library reopen through Node `node:sqlite` |
| Electron IPC boundary | app-data library isolation, UUID/path restrictions, read-only transfer preflight, atomic export, artifact size/extension bounds, typed errors, sender/origin allow-lists, layer-native replacement channels, IPC registration before renderer load, and authenticated smoke readiness |
| React/UI | three right-panel tabs, active-layer state, non-active-layer editing lock, layer-specific sidebar operations and eraser labels, shared pan/zoom controls, preview read-only state, object kind/label/placement controls, object list selection/deletion, region management, optimistic save/failure recovery, stale request rejection, and undo/redo state |
| OpenLayers adapter | separate terrain/region/object sources and z-order, canonical polygon rendering, object point/polygon rendering, active-layer hit-test gate, non-active selection rejection, layer-switch cancellation, terrain and region cell gestures, object placement/movement/erase, preview navigation, Escape/pointercancel/blur/lost-capture cancellation, wheel zoom, middle/right-button pan, Space pan, right-button context-menu suppression, bounded export, listener cleanup, and idempotent disposal |
| Boundary pull affordance | exact canonical Polygon hit testing with vertex-over-edge-over-interior priority, bounded preview without IPC on pointermove, one normalized commit on pointerup, layer-specific shape behavior, cancellation, and overlap rejection |
| Repository | Markdown links, `git diff --check`, secret guard staged/add/modify/type-change/merge-resolution and existing/new-ref range matrix with safe deletion coverage, architecture checks, and commit-by-commit version policy |
| Electron runtime smoke | explicitly authorized development launch with fresh temporary `userData`, JSON evidence for main-window creation, renderer load, preload API, and empty library, followed by automatic shutdown |
| macOS package | release-only static arm64 bundle, metadata, DMG, checksum, and non-launching package-smoke inspection; never launch the packaged app for testing |

Before a local push, run strict TypeScript, Node and renderer Vitest projects, the full Vitest suite, architecture and documentation checks, and the scripts declared by the current app package, followed by repository guards. Before a release tag, also build and statically inspect the Electron Forge arm64 package using the exact local release command documented by the app package.

Tests that require Realm to be running must be separately named, explicitly authorized for the current task, and performed through `Realmをテスト起動.command` or `script/build_and_run.sh`. Never launch a built, packaged, or installed `.app` for testing. GUI tests must not be silently included in the normal unit-test command.
