# Architecture

## Boundary

The Tauri webview is the presentation and interaction layer. Rust commands are the only authority for filesystem paths, SQLite connections, schema validation, and writes. React does not open a database or reach arbitrary paths directly.

```text
React / OpenLayers
        │ typed Tauri command
        ▼
Rust command boundary ── validation ── current-state service
        │                         │
        ▼                         ▼
 app library / export       rusqlite connection
                                    │
                                    ▼
                      one internal SQLite file per world
```

## State ownership

- Rust owns the app-data library path, opened database, SQLite transactions, schema state, stable identifiers, current persisted map data, project presentation settings, and session undo/redo stacks.
- React owns transient selection, viewport, tool mode, per-class visibility, and form drafts awaiting the short automatic-save debounce.
- OpenLayers owns only rendering and interaction objects derived from the current snapshot; map objects are not an additional source of truth. Completed feature draw and modify gestures cross the renderer boundary as GeoJSON geometry. A completed brush stroke crosses as stable cell IDs, while its pointer path and preview remain transient React/OpenLayers state.

The coarse IPC surface lists, creates, opens, saves, closes, imports, and exports library worlds; writes validated PNG/JPEG/PDF artifact bytes; reads the current project snapshot; updates bounded project presentation settings; creates, revises, deletes, or batch-creates validated features; imports, reads, and deletes project-embedded image assets; applies one cell-attribute batch; reads current cell attributes for an optional grid viewport; and performs undo or redo. Automatic save replaces the editable world name in one Rust transaction. Feature commands accept complete validated GeoJSON geometry, while cell commands accept bounded stable IDs rather than SQL-shaped or per-coordinate calls. Project snapshots contain asset manifests only; one explicit read command returns one bounded asset's bytes.

Tauri imports are isolated in `app/src/backend/tauriRealmBackend.ts`. The browser-only memory backend implements the same interface for deterministic UI tests without pretending to be a second persistence format.

OpenLayers imports are isolated below `app/src/map/`. `contracts.ts` is the UI-facing renderer contract, while drawing refinement, seeded symbol scatter, measurement, geometry transforms, grid geometry, and world-bound checks remain pure modules. `MapAdapter.ts` owns the OpenLayers map, layers, interactions, and lifecycle; its factory is injected into the canvas. Theme definitions remain renderer-owned, while the selected theme identifier and grid/export preferences are persisted as bounded project settings. Cell features are created lazily only for persisted, touched, or selected cells; selecting brush mode does not instantiate the complete fixed grid.

React coordinates library operations through `app/src/state/useRealmOperations.ts`. Operation generations reject stale project and library responses. The editor serializes automatic save, mutations, exports, and close so a delayed response cannot replace a newer draft or snapshot.

Rust keeps `lib.rs` as the composition root and command registry. IPC data contracts, domain validation, open-session state, read models, edit application, command handlers, and storage concerns live in separate modules. Within storage, schema verification, path validation, atomic publication, library lookup, project connection setup, and artifact output are separate dependencies. Storage modules do not depend on command handlers.

## Safety invariants

- Resolve the app-data directory in Rust, address library entries by validated UUID, and validate user-selected import/export paths; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for current-state writes.
- Never write half a database or export: create schema and initial world data in one SQLite transaction, synchronize hidden sibling staging files, and publish them with macOS's atomic no-replace rename. Later writes remain transactional and preserve the journal semantics selected by the storage implementation.
- PNG/JPEG/PDF bytes originate from the current OpenLayers rendering and are size- and extension-bounded at the Rust write boundary. Transfer imports are inspected read-only before being copied into the library; the selected source is never modified.
- Do not send database contents, embedded assets, or telemetry over the network. Imported symbol images are validated and copied into the current database; they are never geography input and never remain external file references.
- Existing files are inspected through a read-only connection before any read/write connection is opened. Retired, future, mismatched, incomplete, and failed-integrity schemas leave the original file and its journal mode untouched.

## Decision records

Changes to storage shape, feature identity, terrain semantics, or command permissions require an update to [data-model.md](data-model.md) and this document, plus a regression test. UI-only changes may remain in code and tests when these invariants are unchanged.
