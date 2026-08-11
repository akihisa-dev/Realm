# Project overview

## Purpose

Realm is a local editor for drawing fictional terrain. The user manually paints terrain on a fixed hexagonal grid without configuring a chronology, terrain variants, political objects, settlements, or symbols.

## Current 0.x scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database. The editor exposes exactly one persistent drawing layer: the `terrain` attribute on a fixed 64 by 37 odd-row-offset grid of regular point-topped hexagons, without land, mountain, biome, or other terrain-kind values.

Realm enters the editor directly. It restores the open world when available, otherwise opens the first existing library world, or creates `無題の世界` when the library is empty. The fixed hexagonal editing grid is visible from the initial empty state at an editing scale where individual cells are clearly distinguishable. Valid terrain edits save automatically. The visible terrain rail contains only move, draw terrain, and erase terrain. A minimal top row contains only `戻す` and `進む`. Drawing paints every hexagonal cell touched by one pointer stroke; erase clears the same terrain layer and reveals the unchanged editing grid without leaving a cell outline trail. There is no startup screen, file toolbar, world-name editor, terrain list, new-terrain form, brush settings, presentation-settings sidebar, floating map controls, or bottom zoom bar.

The current editor deliberately exposes no import, raster export, or transfer export controls. Existing bounded rendering and transfer data remain compatibility infrastructure without a visible entry.

There is no required account, hosted backend, cloud synchronization, procedural geography generation, symbol placement, settlement editing, political editing, or image-to-geography conversion. Terrain is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current editable terrain. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Terrain cell | One stable `x:y` hexagonal grid cell whose `terrain` layer is present. Its polygon is derived by the renderer and is not stored as GeoJSON. |
| Legacy compatibility row | A feature row or non-terrain cell row created by an older Realm version. It is retained in SQLite but is not displayed, selected, edited, or newly created by the hex terrain editor. |

## Product boundaries

Realm is a terrain authoring tool, not a general map-object editor or GIS data exchange service. Forests, rivers, lakes, roads, political borders, countries, regions, settlements, mountains, trees, symbols, labels, overlays, frames, scale objects, external network requests, remote storage, generated geography, and multi-platform support require a separate product decision and updated architecture record.

## Functional acceptance

- Launch enters the terrain editor without a startup screen, opening an existing library world before creating a blank one.
- The primary rail exposes exactly move, draw terrain, and erase terrain. It has no non-terrain creation entry, terrain list, new-terrain form, brush-settings panel, presentation-settings panel, or asset manager.
- The top row exposes exactly `戻す` and `進む`; the editor has no file toolbar, export controls, world-name field, floating map controls, or bottom zoom bar.
- The complete fixed 64 by 37 regular-hexagon editing grid spans the bounded world and is visible before any terrain is drawn without deforming its boundary cells. The world origin and focus axes remain centered independently from persistent terrain cells and transient brush selection.
- Drawing or erasing applies the complete set of valid hexagonal cells touched by one pointer stroke in one transaction and one undo step. The active terrain tool remains selected for consecutive strokes; Escape cancels the current selection.
- Valid edits are automatically saved, and reopening a world preserves the current world metadata, terrain, project presentation settings, and untouched legacy compatibility rows.
- The renderer uses the bounded project settings already stored in the world, but the terrain editor does not expose a settings sidebar. Viewport, zoom, selection, and active tool remain transient.
- Terrain cell painting and clearing validate the complete operation and commit atomically.
- Existing feature rows and non-terrain cell rows from older projects are never deleted or rewritten merely by opening or editing terrain. They are excluded from editor rendering, selection, counts, and mutation callbacks.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete terrain edit operations during the open session.
