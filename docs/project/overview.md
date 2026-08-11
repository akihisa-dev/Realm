# Project overview

## Purpose

Realm is a local editor for drawing fictional terrain. The user manually creates and edits terrain polygons without configuring a chronology, terrain variants, political objects, settlements, or symbols.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. The editor exposes exactly one persistent drawing class: a `terrain` polygon without land, mountain, biome, or other terrain-kind values.

Realm enters the editor directly. It restores the open world when available, otherwise opens the first existing library world, or creates `無題の世界` when the library is empty. Valid terrain edits save automatically. The visible terrain rail contains only move, draw terrain, and erase terrain. A minimal top row contains only `戻す` and `進む`. Drawing uses one fixed freehand profile; there is no startup screen, file toolbar, world-name editor, terrain list, new-terrain form, drawing configuration, presentation-settings sidebar, floating map controls, or bottom zoom bar. Terrain remains selectable and reshapeable directly on the canvas.

The current editor deliberately exposes no import, raster export, or transfer export controls. Existing bounded rendering and transfer data remain compatibility infrastructure without a visible entry.

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

- Launch enters the terrain editor without a startup screen, opening an existing library world before creating a blank one.
- The primary rail exposes exactly move, draw terrain, and erase terrain. It has no non-terrain creation entry, terrain list, new-terrain form, drawing-settings panel, presentation-settings panel, cell brush, or asset manager.
- The top row exposes exactly `戻す` and `進む`; the editor has no file toolbar, export controls, world-name field, floating map controls, or bottom zoom bar.
- Freehand terrain polygons use the fixed editor smoothing profile, are simplified at the current view resolution, remain inside the bounded world, and reject degenerate or self-intersecting results before saving. The active terrain tool remains selected for consecutive strokes; Escape cancels an unfinished stroke.
- Valid edits are automatically saved, and reopening a world preserves the current world metadata, terrain, project presentation settings, and untouched legacy compatibility rows.
- The renderer uses the bounded project settings already stored in the world, but the terrain editor does not expose a settings sidebar. Viewport, zoom, selection, and active tool remain transient.
- Direct canvas reshape and deletion validate the complete operation and commit atomically.
- Existing non-terrain rows from older projects are never deleted or rewritten merely by opening or editing terrain. They are excluded from editor rendering, selection, counts, and mutation callbacks.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete terrain edit operations during the open session.
