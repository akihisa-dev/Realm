# Project overview

## Purpose

Realm is a local editor for drawing fictional terrain and coloring user-defined regions over it. The user manually marks which parts of a fixed hexagonal grid belong to terrain or a colored region without configuring a chronology, terrain variants, settlements, or symbols.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. The editor exposes the `terrain` and color-valued `region` attributes on a fixed 128 by 73 odd-row-offset grid of regular point-topped hexagons, without land, mountain, biome, or other terrain-kind values.

Realm enters the editor directly. It restores the open world when available, otherwise opens the first existing library world, or creates `無題の世界` when the library is empty. The fixed hexagonal editing grid is visible from the initial empty state at an editing scale where individual cells are clearly distinguishable. Valid terrain and region edits save automatically. The map tool palette contains the terrain drawing/thickness control, ten fixed circular region-color buttons, and eraser; the eraser switches between terrain deletion and region deletion with toggle buttons, and map navigation remains available through the renderer's natural pan gestures. A minimal top row contains only `戻す` and `進む`. Drawing and erasing apply their selected transient ranges. There is no startup screen, file toolbar, world-name editor, terrain list, new-terrain form, persistent paint-settings panel, presentation-settings sidebar, floating map controls, or bottom zoom bar.

The current editor deliberately exposes no import, raster export, or transfer export controls. Existing bounded rendering and transfer data remain compatibility infrastructure without a visible entry.

There is no required account, hosted backend, cloud synchronization, procedural geography generation, symbol placement, settlement editing, political editing, or image-to-geography conversion. Terrain is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current editable terrain and regions. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Terrain cell | One stable `x:y` hexagonal grid cell whose `terrain` layer is present. Its polygon is derived by the renderer and is not stored as GeoJSON. |
| Region | Hexagonal grid cells carrying the same persistent region ID and display color; each six-connected component is rendered separately while remaining one logical region, whether or not terrain is present. |
| Legacy compatibility row | An inactive feature row or unsupported cell row created by an older Realm version. It is retained in SQLite but is not displayed, selected, edited, or newly created by the editor. |

## Product boundaries

Realm is a terrain and region authoring tool, not a general map-object editor or GIS data exchange service. Forests, rivers, lakes, roads, political borders, countries, settlements, mountains, trees, symbols, labels, overlays, frames, scale objects, external network requests, remote storage, generated geography, and multi-platform support require a separate product decision and updated architecture record.

## Functional acceptance

- Launch enters the terrain editor without a startup screen, opening an existing library world before creating a blank one.
- The map palette exposes terrain drawing and erasing with 1–5 cell thickness controls, erasing with `地形削除` / `領域削除` toggle buttons, region drawing with ten fixed circular color buttons, and an accessible grab action. Each completed region stroke receives one persistent region ID. Grab moves every cell with that ID as one logical region along the fixed grid, including cells without terrain; every six-connected component remains visible as a separate derived shape without splitting the ID. When the destination overlaps another region, the stationary region remains unchanged and only the overlapping cells of the grabbed region are removed. A visible terrain or region edge can be pulled outward to add cells or inward to clear cells, with a live exact-cell preview; region expansion and retraction retain the region ID. World-edge moves remain invalid. Selecting palette items by click, tap, Enter, or Space exposes transient controls; hover alone does not open them. Map navigation uses the renderer's middle-button, Space, and wheel gestures.
- The top row exposes exactly `戻す` and `進む`; the editor has no file toolbar, export controls, world-name field, floating map controls, or bottom zoom bar.
- The complete fixed 128 by 73 regular-hexagon editing grid spans the bounded world and is visible before any terrain is drawn without deforming its boundary cells. Relative zoom 1 fits the complete bounded world inside the available canvas with fit padding equal to 10% of the shorter viewport side and clamped from 40 through 160 CSS pixels on every side. A narrow or wide viewport may leave additional letterbox space on its secondary axis, but cannot zoom out beyond that full-world view. Resizing recomputes the fit and responsive padding while preserving the relative zoom. The editor does not render separate origin or focus axes.
- Drawing or erasing applies the complete set of valid hexagonal cells touched by one pointer stroke in one transaction and one undo step. The eraser defaults to `地形削除`, which clears both `terrain` and `region` rows for the touched cells; its toggle can switch the same stroke to `領域削除`, which clears only the region layer. The 1–5 controls use fine-grid hex distances 0, 2, 4, 6, and 8 so their visible widths remain close to the former coarse grid. Before pressing and while dragging, drawing and deletion footprints are shown as temporary previews at the pointer; previews are never persisted. A completed drawing stroke removes its solid footprint before the outline transition begins, while the hover preview remains available at the pointer. The renderer applies the new cell state immediately and rejects delayed reads from replacing it, so a save wait cannot restore the previous painted-cell fill. The active terrain tool remains selected for consecutive strokes; Escape cancels the current selection.
- Persisted terrain cells are presented as unfilled masses. Shared edges between adjacent terrain cells are omitted, then the exposed edges are assembled into deterministic rings and gently corner-smoothed for the completed outline; the fixed editing grid remains available as the selection guide. When a completed stroke adds cells, the changed outline expands along the fixed grid into its new boundary; when a stroke removes cells, it retracts along the grid into the remaining boundary. Reduced-motion presentation applies the final outline without animation. Transient drawing previews and hit testing retain exact hex geometry.
- Region drawing uses a freehand enclosure to select the valid hexagonal cells inside it, then applies the selected color and one new persistent region ID to that complete cell set in one transaction and one undo step without changing the terrain cells beneath it. The enclosure is transient input only: saved region fills and boundaries use the region ID plus six-connected components as separate derived shapes, combining adjacent cells without exposing internal seams regardless of terrain. Newly added or recolored region cells briefly fade into their final translucent style; reduced-motion presentation applies the final style immediately. The animation is transient renderer state and does not add saved history.
- Valid edits are automatically saved, and reopening a world preserves the current world metadata, terrain, regions, project presentation settings, and untouched legacy compatibility rows.
- The renderer uses the bounded project settings already stored in the world, but the terrain editor does not expose a settings sidebar. Viewport, zoom, selection, and active tool remain transient.
- Terrain and region cell painting, terrain clearing, and region clearing validate the complete operation and commit atomically.
- Existing Polygon region features, other feature rows, and unsupported cell rows from older projects are never deleted or rewritten merely by opening or editing terrain or regions. Those inactive rows are excluded from editor rendering, selection, counts, and mutation callbacks. Existing region-cell values remain readable; active edits write the selected `#RRGGBB` color and persistent region ID.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete terrain and region edit operations during the open session.
