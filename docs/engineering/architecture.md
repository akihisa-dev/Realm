# Architecture

## Boundary

The Electron renderer is the presentation and interaction layer. The Electron main process is the only authority for filesystem paths, SQLite connections, schema validation, and writes. React does not open a database or reach arbitrary paths directly.

```text
React / OpenLayers
        │ typed preload IPC
        ▼
Electron main boundary ── validation ── current-state service
        │                         │
        ▼                         ▼
 app library / export       node:sqlite connection
                                    │
                                    ▼
                      one internal SQLite file per world
```

## State ownership

- The Electron main process owns the app-data library path, opened `node:sqlite` database, SQLite transactions, schema state, stable world, feature, region, and map-shape identifiers, current persisted map shapes, bounded canvas and project presentation settings, and session undo/redo stacks.
- React owns the transient hex-cell selection used by paint/erase, region color, viewport, tool mode including grab and shaping, draw-paint range, object-manager open state, selected logical regions, selected region part, expanded object-manager rows, and serialized mutation state. It owns the canonical `MapShape[]` draft until the main-process replacement has completed.
- OpenLayers owns only rendering and interaction objects derived from canonical map shapes and transient grid selections; map objects are not an additional source of truth. Completed paint and enclosure gestures cross the renderer boundary as bounded cell selections, which the renderer converts to `map_shapes` polygons before the main process validates and stores them.

The active editor reads the current project snapshot and derives transient terrain and region cell selections from `map_shapes`; it derives object-manager region objects from persistent region IDs and shape parts. Paint and erase use bounded cell IDs only as an interaction bridge, convert the result to one or more canonical polygons, and send one complete `map_shapes` replacement through coarse IPC. Shaping intersects a logical region with the terrain union while retaining its IDs. Merging, splitting, and whole-region movement also rewrite the complete canonical shape set in one coarse IPC operation. Grab mode hit-tests the saved Polygon directly: pointer movement produces a continuous renderer-only preview, while pointerup normalizes the preview to the snap grid and emits one replacement; pointercancel, Escape, blur, and lost capture restore the original shapes. Every completed operation is one undoable replacement of `map_shapes`. On launch, React restores the open world, opens the first app-library world, or creates `無題の世界` when the library is empty, then enters the editor directly. Import, file export, project-name editing, presentation settings, feature editing, asset commands, and unsupported compatibility layers remain compatibility infrastructure without an active editor entry.

Electron imports are isolated in `app/src/backend/electronRealmBackend.ts`; the preload exposes only the typed `realmApi` contract. The browser-only memory backend implements the same interface for deterministic UI tests without pretending to be a second persistence format.

OpenLayers imports are isolated below `app/src/map/`. `contracts.ts` is the UI-facing renderer contract, while hex center, clipped-cell polygon, grid-snapped ring derivation, Polygon boolean operations, exact hit testing, normalization, polygon validation, six-neighbor component traversal, paint selection, lasso selection, grid generation, cell traversal, measurement, geometry transforms, and world-bound checks remain pure modules. `MapAdapter.ts` owns the OpenLayers map, interaction state, and lifecycle; `mapLayerRegistry.ts` owns the renderer sources, layers, styles, grid replacement, and visual-resource cleanup; the adapter factory is injected into the canvas. Persisted terrain and region `Polygon` shapes remain the source of truth and are never rewritten for display. In normal controlled rendering, terrain is projected through renderer-only `smoothCellBoundaryRings` and regions through `smoothCellBoundaryPolygons`, reconstructed from canonical geometry cell IDs; invalid or empty reconstruction falls back to the canonical Polygon. Transient cell polygons remain available for the editing grid, paint/erase previews, and object-manager projections; they do not replace the canonical polygon sources. Region parts are grouped by persistent region ID and display color, independent of terrain. `MapShapeGrabController` hit-tests canonical polygons, updates raw continuous preview geometry on pointermove, and only emits a normalized replacement on pointerup; the non-null preview path deliberately bypasses smoothing. Other regions remain visible during the preview, and cancellation restores the canonical sources. All derived effects are renderer-only, honor reduced-motion, and never change the snapshot or undo history. `MapCanvas` composes `useRendererSync`, `useMapAdapterLifecycle`, and `usePaletteFlyouts`: the lifecycle hook owns adapter creation, callback bridging, and cleanup, while the palette hook owns the left-sidebar tool controls, inline flyouts, and outside-action dismissal. Controlled props still synchronize through semantic value signatures, so equivalent React rerenders do not rebuild renderer layers or grid sources. `EditorShell` delegates serialized backend writes, stale-project rejection, optimistic shape updates, and failed-save recovery to `useEditorPersistence`; pure region merge/split transformations remain in `editorMapOperations.ts`. Theme definitions remain renderer-owned, while the selected theme identifier and grid/export preferences are persisted as bounded project settings.

In controlled map-shape mode, the grab affordance uses the exact canonical Polygon hit test, prioritizing vertices and edges before the interior. A vertex or edge press edits that Polygon; an interior press moves the selected terrain shape or every Polygon part sharing the pressed region ID. The raw preview remains renderer-only until pointerup normalization, so terrain painting and region enclosure retain their own primary-button gestures. The legacy `GrabHoverController` remains only as a transient fallback for renderer-only cell fixtures that do not supply canonical shapes.

React coordinates launch restoration through `app/src/state/useRealmOperations.ts`. Operation generations reject stale project and library responses. The editor serializes automatic save and mutations so a delayed response cannot replace a newer draft or snapshot. Optimistic `MapShape[]` replacements recover from the authoritative open-project snapshot when storage rejects a write.

Electron keeps `app/src/main/main.ts` as the process composition root and `app/src/main/ipc/registerIpcHandlers.ts` as the IPC registry. IPC data contracts, domain validation, open-session state, read models, edit application, command handlers, and storage concerns live in separate modules. Within storage, schema verification, path validation, atomic publication, library lookup, project connection setup, and artifact output are separate dependencies. Storage modules do not depend on IPC handlers.

Asset bytes are not part of the normal project snapshot path: the first snapshot of an opened session verifies each BLOB, later snapshots expose only validated manifest fields, and bytes cross the command boundary only through an explicit asset read. Undo state keeps bytes only for assets added or removed by that edit; ordinary feature, setting, and map-shape checkpoints retain asset descriptors without copying the full BLOB set.

Map-shape validation derives each shape's grid-cell set once and reuses it for layer-overlap and region-connectivity checks. Cell-center reconstruction first narrows the scan to the Polygon bounding box while retaining the fixed EPSG:4326 grid and canonical Polygon round-trip checks.

Map-shape commands now own their request validation, canonical snapshot lookup, transactional replacement, and history checkpointing in `app/src/main/commands/mapShapeCommands.ts`; `RealmCommands` remains the public backend adapter and session/library owner. UUID normalization is shared by command domains through `app/src/main/domain/identifiers.ts`, so feature, asset, and map-shape IDs use one boundary rule.

## Safety invariants

- Resolve the app-data directory in the Electron main process, address library entries by validated UUID, and validate user-selected import/export paths; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for current-state writes.
- Never write half a database or export: create schema and initial world data in one SQLite transaction, then let the shared atomic publisher synchronize a hidden sibling staging file, publish it with macOS's atomic no-replace rename relative to a pinned parent directory descriptor, and synchronize that descriptor. Import validates the original source identity and SHA-256 content digests, copies its main/WAL/SHM bytes into create-new private siblings, and opens only that private bundle for SQLite online backup; source identity, digest, sidecar-set, replacement, and non-regular-sidecar changes are rejected before publication. Later writes remain transactional and preserve the journal semantics selected by the storage implementation.
- The no-replace rename is the publication point. If the subsequent parent-directory synchronization fails, the command reports a durability error while retaining the already-published destination; cleanup only removes unpublished staging files.
- Node SQLite connections cannot adopt a raw staging fd; each operation therefore combines held path and parent dev-ino checks with a fresh source identity check immediately before writes and publication. A mismatch fails closed and leaves foreign files untouched.
- PNG/JPEG/PDF bytes originate from the current OpenLayers rendering and are size- and extension-bounded at the Electron main write boundary. Transfer imports are inspected read-only before being copied into the library; the selected source is never modified.
- Do not send database contents or telemetry over the network. Compatibility asset rows remain local and are not exposed by the terrain editor.
- Existing files are inspected through a read-only connection before any read/write connection is opened. Retired, legacy, future, mismatched, incomplete, and failed-integrity schemas leave the original file and its journal mode untouched; schema 11 has no automatic migration path from older `.realmmap` files.

## Decision records

Changes to storage shape, feature identity, terrain semantics, or IPC permissions require an update to [data-model.md](data-model.md) and this document, plus a regression test. UI-only changes may remain in code and tests when these invariants are unchanged.
