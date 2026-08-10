# Project overview

## Purpose

Realm is a local editor for drawing a fictional world map. The user manually creates and edits the current geography and political features without configuring a chronology or terrain variants.

## 0.1 series scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database and covers terrain, forests, rivers, coastlines, countries, regions, boundaries, cities, and towns. A terrain feature is a single polygon class without land, mountain, or other terrain-kind values.

The editor creates and opens worlds from that library and automatically saves valid edits. It moves and zooms the bounded world canvas and edits the world name. Its map tools manually draw, select, rename, reshape, and delete every initial feature class. Terrain is drawn as a polygon. A cell brush paints forest, country, or region attributes across a continuous area of fine map cells; brush size and erase mode are explicit controls. Undo and redo restore the previous or next current state while a project remains open.

PNG and PDF are presentation artifacts and cannot be reopened for editing. Moving editable work to another Mac uses the dedicated `.realmmap` transfer export and import actions; normal editing never asks the user to choose a database path.

There is no required account, hosted backend, cloud synchronization, procedural generation, or image import. Geography is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its current editable map content. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Feature | A manually edited map object such as a river, boundary, or city. |
| Cell | One stable element of the fixed 512 by 256 world grid, identified by its column and row. |
| Cell attribute | A current forest, country, or region value; different attribute layers may overlap on one cell. |
| Brush stroke | One pointer press, drag, and release that paints or erases every cell reached by the selected brush radius. |

## Product boundaries

The map is an authoring tool, not a GIS data exchange service. External network requests, remote storage, generated geography, and multi-platform support require a separate product decision and an updated architecture record.

## Functional acceptance

- The terrain rail entry draws one terrain polygon class without a terrain-kind selector. The forest rail entry activates its cell-brush preset. Rivers, coastlines, boundaries, countries, and regions use manual line or polygon gestures; cities and towns use points.
- Country and region polygons can be drawn over terrain to express political and administrative divisions. They remain independent of terrain geometry.
- The cell brush has visible small, medium, large, and extra-large radii. A click paints a round stamp; a drag paints the complete thick path without gaps. Releasing the pointer saves that stroke as one undoable batch. Erasing one attribute layer does not remove other layers on the same cells.
- Valid edits are automatically saved, and reopening a world from the app library preserves the current world metadata, features, and cell attributes.
- A world exports as a PNG or single-page PDF map artifact, and a transfer export can be imported as an independently editable library world on another Mac.
- A failed validation or transaction leaves the prior project state intact. Undo and redo restore complete edit operations during the open session.
