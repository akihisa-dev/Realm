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
 app library / export       rusqlite connection
                                    │
                                    ▼
                      one internal SQLite file per world
```

## State ownership

- Rust owns the app-data library path, opened database, SQLite transaction, migration state, stable identifiers, persisted revision data, and session undo/redo stacks.
- React owns transient selection, viewport, tool mode, and form drafts awaiting the short automatic-save debounce.
- OpenLayers owns only rendering and interaction objects derived from the current view year; map objects are not an additional source of truth. Completed feature draw and modify gestures cross the renderer boundary as GeoJSON geometry. A completed brush stroke crosses as stable cell IDs, while its pointer path and preview remain transient React/OpenLayers state.
- A view-year change reads a consistent snapshot and replaces derived layers atomically from the UI's perspective.

The coarse IPC surface lists, creates, opens, saves, closes, imports, and exports library worlds; writes validated PNG/PDF artifact bytes; reads a complete feature snapshot for a view year; creates, revises, and deletes one completed feature edit; applies one cell-attribute batch; reads active cell attributes for a year and optional grid viewport; and performs undo or redo. Automatic save replaces the editable world fields and complete era and timeline-event lists in one Rust transaction and returns the authoritative snapshot, including Rust-generated IDs. Feature commands accept complete validated GeoJSON geometry, while cell commands accept bounded stable IDs rather than SQL-shaped or per-coordinate calls.

Tauri imports are isolated in `app/src/backend/tauriRealmBackend.ts`. The browser-only memory backend implements the same interface for deterministic UI tests without pretending to be a second persistence format.

OpenLayers imports are isolated in `app/src/map/MapAdapter.ts`. `RealmMapRenderer` is the UI-facing contract and its factory is injected into the canvas, so a later viewing style or renderer can be selected without moving project state out of Rust.

## Safety invariants

- Resolve the app-data directory in Rust, address library entries by validated UUID, and validate user-selected import/export paths; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for revision writes.
- Never write half a database or export: create schema and initial world data in one SQLite transaction, synchronize hidden sibling staging files, and publish them with macOS's atomic no-replace rename. Later writes remain transactional and preserve the journal/WAL semantics selected by the storage implementation.
- PNG/PDF bytes originate from the current OpenLayers rendering and are size- and extension-bounded at the Rust write boundary. Transfer imports are inspected read-only before being copied into the library; the selected source is never modified.
- Do not send database contents or telemetry over the network in the 0.1 series; image import is not a product capability.
- Existing files are inspected through a read-only connection before any read/write connection is opened. Future versions, mismatched version markers, incomplete schema, and failed integrity checks leave the original file and its journal mode untouched.

## Decision records

Changes to storage shape, year ordering, feature identity, or command permissions require an update to [data-model.md](data-model.md) and this document, plus a regression test. UI-only changes may remain in code and tests when these invariants are unchanged.
