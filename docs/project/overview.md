# Project overview

## Purpose

Realm is a local editor for a world map whose geography and political boundaries can change over time. The user edits features manually and can inspect a map at a calendar year or within a named era.

## 0.1 series scope

The first release targets macOS on Apple Silicon and one local `.realmmap` SQLite file per map. Its storage contract covers terrain, forests, rivers, coastlines, countries, regions, boundaries, cities, and towns. Every feature can have year-scoped revisions; eras are names attached to a year range and do not replace the underlying revisions.

The editor creates, opens, saves, and closes map projects; moves and zooms the bounded world canvas; and edits the world name, current year, named eras, and timeline events. Its map tools manually draw, select, rename, reshape, and delete every initial feature class. A year change reconstructs the visible map from the latest revision at or before that year. Undo and redo are available while a project remains open and create compensating feature revisions instead of erasing history.

There is no required account, hosted backend, cloud synchronization, procedural generation, or image import. Geography is entered and edited manually.

## Terminology

| Term | Meaning |
| --- | --- |
| Map project | One `.realmmap` SQLite file and its local lock/journal state. |
| Feature | A manually edited map object such as a river, boundary, or city. |
| Revision | A feature's valid state at a year, with deterministic ordering for same-year edits. |
| Era | A user-named interval over the year axis; it is metadata, not a second timeline. |
| Timeline event | A dated or ranged occurrence shown in the chronology independently from map geometry. |
| View year | The year used to select the latest applicable revision for each feature. |

## Product boundaries

The map is an authoring tool, not a GIS data exchange service. External network requests, remote storage, generated geography, and multi-platform support require a separate product decision and an updated architecture record.

## Functional acceptance

- Each initial feature class can be drawn manually with its required geometry: a click places a point, while a press-and-drag gesture traces a line or polygon. The resulting feature can then be selected, renamed, reshaped, and deleted at the view year.
- Country and region polygons can be drawn over terrain to express political and administrative divisions. They remain independent of terrain geometry so that either physical geography or political areas can change on its own year-scoped history.
- Saving and reopening the single project file preserves world metadata, eras, timeline events, and all feature revisions.
- Moving before and after a revision or deletion deterministically reconstructs the corresponding visible state, including negative years and the full signed 32-bit year range.
- A failed validation or transaction leaves the prior project state intact. Undo and redo never update or delete an existing feature revision row.
