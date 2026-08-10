# Project overview

## Purpose

Realm is a local editor for drawing a fictional world map. The user manually creates and edits the current geography and political features without configuring a chronology or terrain variants.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. Its editable objects cover terrain, forests, rivers, lakes, coastlines, roads, countries, regions, boundaries, cities, towns, mountains, trees, general symbols, labels, overlays, frames, and scale marks. A terrain feature remains a single polygon class without land, mountain, or other terrain-kind values; mountain marks are independent point symbols rather than terrain variants.

The editor creates and opens worlds from that library and automatically saves valid edits. It moves and zooms the bounded world canvas and edits the world name. Its map tools manually draw, select, rename, reshape, move, copy, cut, paste, duplicate, scale, rotate, mirror, order, lock, and delete map objects. Shift-click toggles a feature and a modifier-drag polygon lasso selects intersecting features; Arrow nudges the selected set, Alt+Arrow uses a finer step, and Shift+Up or Shift+Down changes drawing order. A grouped transform, paste, or deletion is one undoable operation and excludes locked or hidden features. Lines and areas may be drawn freehand or as connected vertices with configurable smoothing and angle snapping; Alt+Shift temporarily applies 45-degree snapping. A selected polygon can receive a manually drawn inner ring, or a seeded, spacing-aware batch of individually editable tree, mountain, or symbol points. A cell brush paints forest, country, or region attributes across a continuous area of fine map cells; brush size and erase mode are explicit controls. Undo and redo restore the previous or next current state while a project remains open.

PNG, JPEG, and PDF are presentation artifacts and cannot be reopened for editing. A project stores a 512–8192-pixel canvas width and height. Raster export supports bounded 1x, 2x, and 4x output for either the full world or the current view, configurable JPEG/PDF quality, optional transparent PNG background, and rejection of unsafe total pixel counts. Selection handles and editor chrome are excluded. Moving editable work to another Mac uses the dedicated `.realmmap` transfer export and import actions; normal editing never asks the user to choose a database path.

There is no required account, hosted backend, cloud synchronization, or procedural geography generation. Geography is entered and edited manually. User-owned PNG, JPEG, and WebP symbol images may be embedded individually or as named local packs; they are presentation assets and are not converted into geography.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current editable map content. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Feature | A manually edited map object with a class, geometry, name, and bounded style properties. |
| Cell | One stable element of the fixed 512 by 256 world grid, identified by its column and row. |
| Cell attribute | A current forest, country, or region value; different attribute layers may overlap on one cell. |
| Brush stroke | One pointer press, drag, and release that paints or erases every cell reached by the selected brush radius. |
| Embedded asset | A validated image copied into the same `.realmmap` and referenced by editable symbol features without an external path. |

## Product boundaries

The map is an authoring tool, not a GIS data exchange service. External network requests, remote storage, generated geography, and multi-platform support require a separate product decision and an updated architecture record.

## Functional acceptance

- The terrain and forest rail entries draw polygons without a terrain-kind selector. Rivers, coastlines, roads, and boundaries use lines; lakes, countries, regions, overlays, and frames use polygons; cities, towns, mountains, trees, symbols, labels, and scale marks use points. The separate cell brush paints forest, country, or region cell attributes.
- Freehand lines and polygons are simplified at the current view resolution, remain inside the bounded world, and reject degenerate or self-intersecting results before saving. Vertex mode connects clicks, optionally snaps every segment to a bounded angle step, finishes on right-click or double-click, and keeps polygon closure valid. The active drawing tool remains selected for consecutive strokes; Escape cancels an unfinished stroke.
- Country and region polygons can be drawn over terrain to express political and administrative divisions. Each has editable fill color, fill opacity, border color, border pattern, label typeface, visibility, lock, and drawing order; it remains independent of terrain geometry.
- A selected polygon accepts a manually drawn inner ring only when it is strictly inside the shell and does not intersect or contain another hole. The change remains one editable feature and one undoable operation.
- The cell brush has visible small, medium, large, and extra-large radii. A click paints a round stamp; a drag paints the complete thick path without gaps. Releasing the pointer saves that stroke as one undoable batch. Erasing one attribute layer does not remove other layers on the same cells.
- Valid edits are automatically saved, and reopening a world from the app library preserves the current world metadata, project presentation settings, features, embedded assets, and cell attributes.
- The map has selectable renderer themes, deterministic original paper texture, a bounded project-local color palette, geographic/square/hex grid appearance, canvas dimensions, export scale and export extent settings that survive reopening. Screen and opaque raster export use the same theme texture family. Per-class visibility controls remain transient together with viewport, zoom, selection, drawing gesture, and the active tool.
- Feature properties preserve supported line color, casing, dash, width, smooth/rough/angular line profile, line-following label appearance, curved standalone-label paths, symbol scale/rotation/mirroring, territory fill and border appearance, trace-image four-corner geometry/crop/rotation/blend/opacity, frame width/color/style, scale-bar presentation, embedded asset reference, visibility, lock, and relative drawing order. Embedded asset bytes remain inside the `.realmmap`; named packs import and delete atomically, and referenced assets cannot be deleted.
- A seeded scatter inside a selected polygon creates ordinary point features in one transaction and one undo step. Distance and area inspectors explicitly report the editor's flat longitude/latitude approximation.
- A world exports as a PNG, JPEG, or single-page PDF map artifact at its configured bounded canvas size and output scale. PNG may omit the paper background; JPEG/PDF quality is bounded from 50 through 100 percent. A transfer export can be imported as an independently editable library world on another Mac.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete edit operations during the open session.
