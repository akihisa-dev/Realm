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

- The Electron main process owns the app-data library path, opened `node:sqlite` database, SQLite transactions, schema state, stable terrain, region, object, asset, and world identifiers, current persisted layer contents, bounded project settings, and session undo/redo stacks.
- React owns the active layer, active operation, transient hex-cell selection, object draft label/kind, viewport, preview state, shared drawing range, right-panel tab state, selected objects/regions, expanded region rows, and serialized mutation state. It keeps an optimistic layer draft until the main-process replacement completes.
- OpenLayers owns only rendering and interaction objects derived from the three canonical layers and transient grid selections. It is never the storage source of truth.

## Three-layer editor

The right-side `LayerManager` contains three tabs: `terrain`, `region`, and `object`. Selecting a tab sets `activeLayer`. The selected layer is the only layer that accepts primary-pointer creation, selection, movement, deletion, and shape editing. The other two layers remain visible but their rendered geometry is not selectable or editable. Switching tabs cancels any active pointer sequence, selection, and preview before activating the new layer.

The left sidebar is generated from the active layer. Shared entrances may use the same visual pattern, but their handlers remain layer-specific:

- Terrain exposes terrain drawing, terrain erasing, grid grab, and terrain shaping.
- Region exposes region enclosure drawing, region erasing, grid grab, and region shaping.
- Object exposes object placement, kind selection (`city`, `text`, `mountain`, `forest`), object selection/movement, and object erasing.

The eraser never chooses a cross-layer target: its label and handler are derived from `activeLayer`. Middle-button, right-button, Space, and wheel navigation remain available in every layer. Presentation preview changes the adapter to read-only navigation and disables all layer mutation controls.

## Renderer boundary

OpenLayers imports are isolated below `app/src/map/`. `contracts.ts` is the UI-facing renderer contract. `MapAdapter.ts` owns the map, interaction state, active-layer gate, primary-pointer lifecycle, pan/zoom, and cancellation. `mapLayerRegistry.ts` owns separate terrain, region, and object sources/layers, styles, grid replacement, preview visibility, and visual-resource cleanup.

Canonical rendering uses three persistent-layer projections in this order:

```text
terrain  →  region  →  object
```

Terrain and region use the exact grid-snapped Polygon geometry for editing and renderer-only smoothed geometry for presentation preview. Objects use their geometry, kind, label, properties, lock state, and `z_index`; object overlap is allowed. Transient cell polygons and cell IDs support paint, erase, hit testing, and previews only. They are discarded and never enter SQLite or undo history.

Completed terrain and region gestures cross the renderer boundary as bounded cell selections or normalized polygon edits. The renderer does not write to SQLite. Main-process commands validate the complete target layer, reject same-layer polygon overlaps, perform one transactional replacement, and create one history checkpoint. Object placement, movement, deletion, and lock changes use a complete object-layer replacement with the same transaction boundary.

Pointercancel, Escape, blur, lost pointer capture, and layer switching are cancellation boundaries. A layer switch also clears controlled selection and returns the adapter to pan before the new operation is installed. Middle/right-button pan and Space temporarily suspend the current primary-pointer operation without changing the active layer.

## Main, preload, and memory backend

Electron keeps `app/src/main/main.ts` as the process composition root and `app/src/main/ipc/registerIpcHandlers.ts` as the IPC registry. The typed preload exposes layer-native commands:

- `realm:replaceTerrainLayer`
- `realm:replaceRegionLayer`
- `realm:replaceObjectLayer`

The renderer uses these commands through `RealmBackend`; only the three layer-replacement commands cross the persistence boundary for map editing. The browser-only memory backend implements the same layer contract for deterministic UI tests without becoming a second persistence format. `MapShape[]` remains an in-memory editor projection and is not an IPC or storage API.

Within main, `layerCommands.ts` validates terrain and region replacement, `objectCommands.ts` validates object kinds, geometry, properties, locks, order, and assets, `snapshot.ts` reads the split model, and `operations.ts` captures/restores all persistent tables for undo/redo. Storage schema verification and path/atomic-publication code remain below the command boundary.

## Safety invariants

- Resolve the app-data directory in the Electron main process, address library entries by validated UUID, and validate user-selected import/export paths; never concatenate user input into SQL or filesystem paths.
- Use parameterized queries and transactions for current-state writes. A failed validation or storage trigger leaves every layer unchanged.
- Create the schema and initial world data in one SQLite transaction. The schema is version 12 and contains separate terrain, region, object, and asset tables.
- Inspect existing files through a read-only connection before any writable connection is opened. Versions before 12, future versions, retired tables, malformed geometry, mismatched schema metadata, incomplete files, and failed integrity checks leave the source bytes and journal mode untouched.
- Never send database contents or telemetry over the network. Assets and project data remain local.
- PNG/JPEG/PDF output is derived from the current renderer and is bounded at the main-process write boundary; it is not editable project storage.

## Decision records

Changes to layer identity, object kinds, terrain semantics, storage shape, or IPC permissions require updates to [data-model.md](data-model.md) and this document, plus regression tests. UI-only changes may remain in code and tests when these invariants are unchanged.
