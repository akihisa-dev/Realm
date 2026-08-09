# Project overview

## Purpose

Realm is a local editor for a world map whose geography and political boundaries can change over time. The user edits features manually and can inspect a map at a calendar year or within a named era.

## 0.1 series scope

The first release targets macOS on Apple Silicon and one local `.realmmap` SQLite file per map. Its storage contract covers terrain, forests, rivers, coastlines, countries, regions, boundaries, cities, and towns. Every feature can have year-scoped revisions; eras are names attached to a year range and do not replace the underlying revisions.

The initial repository baseline opens an empty bounded world canvas, moves and zooms it, and round-trips the world name, current year, and named eras through Rust and SQLite. Feature tables, append-only revision invariants, and timeline-event storage are present so manual geometry and chronology tools can be added without moving authority into React or OpenLayers; those editing tools are not presented as available in the baseline UI.

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
