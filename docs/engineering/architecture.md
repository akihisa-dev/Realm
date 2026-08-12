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

- Rust owns the app-data library path, opened database, SQLite transactions, schema state, stable identifiers, current persisted map data, bounded canvas and project presentation settings, and session undo/redo stacks.
- React owns transient hex-cell selection, viewport, tool mode, draw-brush thickness, and serialized mutation state.
- OpenLayers owns only rendering and interaction objects derived from terrain cell rows; map objects are not an additional source of truth. Completed brush gestures cross the renderer boundary as bounded stable cell identifiers, not GeoJSON.

The active editor reads the current project snapshot and terrain cell attributes; paints or clears a validated cell batch; and performs undo or redo. On launch, React restores the open world, opens the first app-library world, or creates `無題の世界` when the library is empty, then enters the editor directly. Import, file export, project-name editing, presentation settings, feature editing, asset commands, and non-terrain cell layers remain compatibility infrastructure without an active editor entry. Terrain cell commands accept complete bounded `x:y` identifier sets.

Tauri imports are isolated in `app/src/backend/tauriRealmBackend.ts`. The browser-only memory backend implements the same interface for deterministic UI tests without pretending to be a second persistence format.

OpenLayers imports are isolated below `app/src/map/`. `contracts.ts` is the UI-facing renderer contract, while hex center, clipped-cell polygon, brush selection, measurement, geometry transforms, and world-bound checks remain pure modules. `MapAdapter.ts` owns the OpenLayers map, layers, interactions, and lifecycle; its factory is injected into the canvas. Theme definitions remain renderer-owned, while the selected theme identifier and grid/export preferences are persisted as bounded project settings.

React coordinates launch restoration through `app/src/state/useRealmOperations.ts`. Operation generations reject stale project and library responses. The editor serializes automatic save and mutations so a delayed response cannot replace a newer draft or snapshot.

Rust keeps `lib.rs` as the composition root and command registry. IPC data contracts, domain validation, open-session state, read models, edit application, command handlers, and storage concerns live in separate modules. Within storage, schema verification, path validation, atomic publication, library lookup, project connection setup, and artifact output are separate dependencies. Storage modules do not depend on command handlers.

## Safety invariants

- Resolve the app-data directory in Rust, address library entries by validated UUID, and validate user-selected import/export paths; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for current-state writes.
- Never write half a database or export: create schema and initial world data in one SQLite transaction, synchronize hidden sibling staging files, and publish them with macOS's atomic no-replace rename. Later writes remain transactional and preserve the journal semantics selected by the storage implementation.
- PNG/JPEG/PDF bytes originate from the current OpenLayers rendering and are size- and extension-bounded at the Rust write boundary. Transfer imports are inspected read-only before being copied into the library; the selected source is never modified.
- Do not send database contents or telemetry over the network. Compatibility asset rows remain local and are not exposed by the terrain editor.
- Existing files are inspected through a read-only connection before any read/write connection is opened. Retired, future, mismatched, incomplete, and failed-integrity schemas leave the original file and its journal mode untouched.

## Decision records

Changes to storage shape, feature identity, terrain semantics, or command permissions require an update to [data-model.md](data-model.md) and this document, plus a regression test. UI-only changes may remain in code and tests when these invariants are unchanged.
