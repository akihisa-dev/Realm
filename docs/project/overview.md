# Project overview

## Purpose

Realm is a local editor for fictional maps built from three independent editing layers:

1. `terrain` — the current terrain itself.
2. `region` — named or colored areas laid over the terrain; a region is not an object.
3. `object` — things placed above the other layers, such as cities, text, forests, and mountains.

The editor is manual. It does not infer geography from images, generate maps, synchronize to a service, or reinterpret terrain as a catalogue of surface or water types.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. Terrain and region shapes are grid-snapped polygons over a fixed 128 by 73 odd-row-offset hexagonal editing grid. Objects are stored separately with a kind, label, geometry, properties, order, and lock state. Initial object kinds are `city` and `text` points, `mountain` points, and `forest` polygons.

Realm enters the editor directly. It restores the open world when available, otherwise opens the first existing library world, or creates `無題の世界` when the library is empty. Valid layer edits save automatically. The renderer draws terrain first, region second, and objects last.

The left sidebar shows operations for the selected layer. “Draw” can be a common visual entry, but terrain drawing uses hex-cell painting and region drawing uses freehand enclosure selection; their handlers and saved results remain different. The eraser is explicitly layer-specific: terrain eraser, region eraser, or object eraser. Pan and zoom gestures are common to all layers.

The right `レイヤー管理` panel has three tabs. The selected tab is the active editing layer; non-selected layers remain visible but cannot be selected or changed on the canvas. Switching tabs cancels an in-progress gesture, selection, and preview. The terrain tab reports terrain shapes, the region tab manages logical regions and disconnected polygon parts, and the object tab manages object kinds, labels, placement, selection, movement, and deletion.

The header contains icon controls for renderer preview, `戻す`, `進む`, and the layer-panel toggle. Preview is read-only for all three layers while pan and zoom remain available.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current three-layer map state. |
| Terrain layer | The current terrain polygons. It has no surface, water-system, biome, or terrain-kind subtypes. |
| Region layer | Regions and their grid-snapped polygon parts. It is independent of terrain and is not an object layer. |
| Object layer | Objects placed above terrain and regions. Initial kinds are city, text, mountain, and forest. |
| Object | A persisted object-layer record with a kind, label, geometry, properties, order, and lock state. |
| Cell ID | A temporary `x:y` identifier used only during grid interaction; it is never saved. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |

## Product boundaries

Realm is a three-layer map authoring tool, not a GIS exchange service or hosted collaboration system. Additional object kinds, asset placement workflows, procedural geography, chronology, political simulation, external network requests, remote storage, and multi-platform support require a separate product decision and synchronized updates to the object registry, geometry validator, renderer, UI, tests, and documentation.

## Functional acceptance

- Launch enters the editor without a startup screen, opening an existing library world before creating a blank one.
- The right panel exposes exactly three layer tabs. The selected tab becomes `activeLayer`; the other layers remain visible but cannot receive primary-pointer selection or mutation.
- The left sidebar exposes only the active layer's operations. Common-looking draw and erase entries dispatch to layer-specific handlers and storage commands.
- Terrain draw and terrain eraser modify only terrain polygons. Region draw and region eraser modify only regions and region polygons. Object placement, movement, selection, and eraser modify only objects.
- Objects can be created and rendered as city, text, forest, and mountain; they can be selected, moved, and deleted, and object overlap is allowed.
- The render order is terrain → region → object. Same-layer terrain or region polygon overlap is rejected; cross-layer overlap is allowed.
- Middle-button, right-button, Space, and wheel pan/zoom work in every layer. Escape, pointercancel, blur, lost capture, and layer switching do not save an incomplete gesture.
- Preview disables all editing controls and canvas mutation for all layers while retaining navigation.
- Valid edits save automatically. Three-layer state survives save, reopen, undo, and redo. A failed validation or transaction leaves the previous state intact.
- Schema 11 and earlier files, old generic tables, retired tables, corrupt files, and future schemas are rejected during read-only inspection without changing the source bytes.

The current editor intentionally keeps transfer and raster-export commands behind compatibility infrastructure without adding extra toolbars or settings panels. There is no required account, hosted backend, cloud synchronization, procedural map generation, or image-to-geography conversion.
