# Project overview

## Purpose

Realm is a local editor for drawing fictional terrain. The user manually creates and edits terrain polygons without configuring a chronology, terrain variants, political objects, settlements, or symbols.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. The editor exposes exactly one persistent drawing class: a `terrain` polygon without land, mountain, biome, or other terrain-kind values.

The editor creates and opens worlds from that library and automatically saves valid edits. It moves and zooms the bounded canvas and edits the world name. Its map tools manually draw, select, rename, reshape, move, copy, cut, paste, duplicate, scale, rotate, mirror, order, lock, and delete terrain polygons. Shift-click toggles a terrain and a modifier-drag polygon lasso selects intersecting terrain. A grouped transform, paste, or deletion is one undoable operation and excludes locked terrain. Terrain may be drawn freehand or as connected vertices with configurable smoothing and angle snapping. A selected terrain polygon can receive a manually drawn inner ring. Undo and redo restore the previous or next current state while a project remains open.

PNG, JPEG, and PDF are presentation artifacts and cannot be reopened for editing. A project stores a 512–8192-pixel canvas width and height. Raster export supports bounded 1x, 2x, and 4x output for either the full world or the current view, configurable JPEG/PDF quality, optional transparent PNG background, and rejection of unsafe total pixel counts. Selection handles and editor chrome are excluded. Moving editable work to another Mac uses the dedicated `.realmmap` transfer export and import actions; normal editing never asks the user to choose a database path.

There is no required account, hosted backend, cloud synchronization, procedural geography generation, symbol placement, settlement editing, political editing, or image-to-geography conversion. Terrain is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current editable terrain. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Terrain | One manually edited `terrain` polygon with a stable identifier, name, geometry, and bounded display properties. |
| Legacy compatibility row | A non-terrain row created by an older Realm version. It is retained in SQLite but is not displayed, selected, edited, or newly created by the terrain-only editor. |

## Product boundaries

Realm is a terrain authoring tool, not a general map-object editor or GIS data exchange service. Forests, rivers, lakes, roads, borders, countries, regions, settlements, mountains, trees, symbols, labels, overlays, frames, scale objects, cell painting, external network requests, remote storage, generated geography, and multi-platform support require a separate product decision and updated architecture record.

## Functional acceptance

- The primary rail exposes only move, draw terrain, and erase terrain. It has no non-terrain creation entry, cell brush, or asset manager.
- Freehand terrain polygons are simplified at the current view resolution, remain inside the bounded world, and reject degenerate or self-intersecting results before saving. Vertex mode connects clicks, optionally snaps every segment to a bounded angle step, finishes on right-click or double-click, and keeps polygon closure valid. The active terrain tool remains selected for consecutive strokes; Escape cancels an unfinished stroke.
- A selected terrain polygon accepts a manually drawn inner ring only when it is strictly inside the shell and does not intersect or contain another hole. The change remains one editable terrain and one undoable operation.
- Valid edits are automatically saved, and reopening a world preserves the current world metadata, terrain, project presentation settings, and untouched legacy compatibility rows.
- The map has selectable renderer themes, deterministic original paper texture, a bounded project-local terrain palette, geographic/square/hex grid appearance, canvas dimensions, export scale, and export extent settings that survive reopening. Screen and opaque raster export use the same theme texture family. Viewport, zoom, selection, drawing gesture, and active tool remain transient.
- Terrain properties preserve visibility, lock, opacity, and relative drawing order. The area inspector explicitly reports the editor's flat longitude/latitude approximation.
- Multi-terrain copy, paste, cut, transform, reorder, and deletion validate the whole set and commit as one undoable operation.
- A world exports as a PNG, JPEG, or single-page PDF terrain artifact at its configured bounded canvas size and output scale. PNG may omit the paper background; JPEG/PDF quality is bounded from 50 through 100 percent. A transfer export can be imported as an independently editable library world on another Mac.
- Existing non-terrain rows from older projects are never deleted or rewritten merely by opening or editing terrain. They are excluded from editor rendering, selection, counts, and mutation callbacks.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete terrain edit operations during the open session.
