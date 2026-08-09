# Architecture

## Boundary

The Tauri webview is the presentation and interaction layer. Rust commands are the only authority for filesystem paths, SQLite connections, schema migrations, and writes. React does not open a database or reach arbitrary paths directly.

```text
React / OpenLayers
        │ typed Tauri command
        ▼
Rust command boundary ── validation ── revision service
        │                         │
        ▼                         ▼
  local file path            rusqlite connection
                                    │
                                    ▼
                         one project.realmmap SQLite file
```

## State ownership

- Rust owns the opened project path, SQLite transaction, migration state, stable identifiers, and persisted revision data.
- React owns transient selection, viewport, tool mode, and unsaved form state.
- OpenLayers owns only rendering objects derived from the current view-year snapshot; map objects are not an additional source of truth. React talks to the renderer through zoom, resize, lifecycle, and future snapshot methods rather than OpenLayers objects.
- A view-year change reads a consistent snapshot and replaces derived layers atomically from the UI's perspective.

The initial coarse IPC surface creates, opens, saves, closes, and reads one project snapshot. Save replaces the editable world fields and complete era list in one Rust transaction and returns the authoritative snapshot, including Rust-generated IDs for new eras. Feature-revision, timeline-event, and Rust-owned undo/redo commands will extend this coarse boundary; React must not issue SQL-shaped or per-coordinate IPC calls.

Tauri imports are isolated in `app/src/backend/tauriRealmBackend.ts`. The browser-only memory backend implements the same interface for deterministic UI tests without pretending to be a second persistence format.

OpenLayers imports are isolated in `app/src/map/MapAdapter.ts`. `RealmMapRenderer` is the UI-facing contract and its factory is injected into the canvas, so a later viewing style or renderer can be selected without moving project state out of Rust.

## Safety invariants

- Resolve and validate a project path before opening it; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for revision writes.
- Never write half a `.realmmap`: create schema and initial world data in one SQLite transaction, synchronize a hidden sibling staging file, and publish it with macOS's atomic no-replace rename. Later writes remain transactional and preserve the journal/WAL semantics selected by the storage implementation.
- Do not send database contents or telemetry over the network in 0.1.0; image import is not a product capability.
- Existing files are inspected through a read-only connection before any read/write connection is opened. Future versions, mismatched version markers, incomplete schema, and failed integrity checks leave the original file and its journal mode untouched.

## Decision records

Changes to storage shape, year ordering, feature identity, or command permissions require an update to [data-model.md](data-model.md) and this document, plus a regression test. UI-only changes may remain in code and tests when these invariants are unchanged.
