# Test strategy

Tests must prove behavior without requiring a real user map or a network. Use temporary directories and in-memory or temporary SQLite databases. Keep fixtures synthetic and free of personal locations.

| Layer | Main evidence |
| --- | --- |
| Pure Rust/model | world/era validation, stable identifiers, year selection, same-year ordering |
| SQLite integration | schema invariants, atomic no-replace creation, transactions, rollback, append-only history, JSON validity, one-file reopen |
| Tauri command boundary | project input validation, path restrictions, typed errors, coarse command permissions |
| React/UI | tool state, edit forms, view-year changes, stale request rejection |
| OpenLayers adapter | bounded EPSG:4326 canvas, pan/zoom behavior, and disposal without persistence side effects |
| Repository | Markdown links, `git diff --check`, secret guard self-test, commit-by-commit version policy |
| macOS package | release-only arm64 bundle inspection and bounded launch smoke; never part of the unit-test command |

Before a local push, run the formatter, Rust checks, strict TypeScript checks, and test scripts declared by the current app package, followed by the repository guards. Before a release tag, also build and smoke-test the arm64 package using the exact local release command documented by the app package.

Tests that require GUI access, a display server, external network, or a packaged app must be separately named and never silently included in the normal unit test command.
