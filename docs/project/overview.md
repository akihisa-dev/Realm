# Project overview

## Purpose

Realm is a local editor for a world map whose geography and political boundaries can change over time. The user edits features manually and can inspect a map at a calendar year or within a named era.

## 0.1 series scope

The first release targets macOS on Apple Silicon and an app-managed local library. Each world remains one SQLite database and covers terrain, forests, rivers, coastlines, countries, regions, boundaries, cities, and towns. Every feature can have year-scoped revisions; eras are names attached to a year range and do not replace the underlying revisions.

The editor creates and opens worlds from that library and automatically saves valid edits. It moves and zooms the bounded world canvas and edits the world name, current year, named eras, and timeline events. Its map tools manually draw, select, rename, reshape, and delete every initial feature class. A cell brush paints a continuous area of fine map cells with flat land, mountain, forest, country, or region attributes; brush size and erase mode are explicit controls. A year change reconstructs the visible map from the latest revision at or before that year. Undo and redo are available while a project remains open and create compensating revisions instead of erasing history.

PNG and PDF are presentation artifacts and cannot be reopened for editing. Moving editable work to another Mac uses the dedicated `.realmmap` transfer export and import actions; normal editing never asks the user to choose a database path.

There is no required account, hosted backend, cloud synchronization, procedural generation, or image import. Geography is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| World | One app-managed SQLite database and its year-scoped editable content. |
| Transfer data | A `.realmmap` copy used only to move or back up editable data outside the app library. |
| Feature | A manually edited map object such as a river, boundary, or city. |
| Cell | One stable element of the fixed 512 by 256 world grid, identified by its column and row. |
| Cell attribute | A year-scoped terrain, forest, country, or region value; different attribute layers may overlap on one cell. |
| Brush stroke | One pointer press, drag, and release that paints or erases every cell reached by the selected brush radius. |
| Revision | A feature's valid state at a year, with deterministic ordering for same-year edits. |
| Era | A user-named interval over the year axis; it is metadata, not a second timeline. |
| Timeline event | A dated or ranged occurrence shown in the chronology independently from map geometry. |
| View year | The year used to select the latest applicable revision for each feature. |

## Product boundaries

The map is an authoring tool, not a GIS data exchange service. External network requests, remote storage, generated geography, and multi-platform support require a separate product decision and an updated architecture record.

## Functional acceptance

- The terrain and forest rail entries activate their cell-brush presets, so a press-and-drag paints a thick continuous area and a click paints a round stamp. Rivers, coastlines, boundaries, countries, and regions retain their manual line or polygon gestures; cities and towns use points. Existing vector terrain and forest features remain visible and editable.
- Country and region polygons can be drawn over terrain to express political and administrative divisions. They remain independent of terrain geometry so that either physical geography or political areas can change on its own year-scoped history.
- The cell brush has visible small, medium, large, and extra-large radii. A click paints a round stamp; a drag paints the complete thick path without gaps. Releasing the pointer saves that stroke as one undoable batch. Erasing one attribute layer does not remove other layers on the same cells.
- Valid edits are automatically saved, and reopening a world from the app library preserves world metadata, eras, timeline events, and all feature revisions.
- A world exports as a PNG or single-page PDF map artifact, and a transfer export can be imported as an independently editable library world on another Mac.
- Moving before and after a revision or deletion deterministically reconstructs the corresponding visible state, including negative years and the full signed 32-bit year range.
- A failed validation or transaction leaves the prior project state intact. Undo and redo never update or delete an existing feature revision row.
