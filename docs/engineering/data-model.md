# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal/WAL sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source read-only, publishes a new UUID-named copy inside the library, and opens that copy. PNG and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 2 records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Version 1 is the first supported format, so no implicit version-0 migration exists. Opening a valid version-1 project adds the version-2 cell tables in one transaction without rewriting its feature revisions. A read-only preflight rejects newer versions, partial SQLite files, integrity failures, and schema objects whose columns, declared types, nullability, keys, indexes, foreign keys, checks, or append-only triggers do not preserve the declared version before opening a read/write connection. Migrations use explicit old-version fixtures and leave the source untouched on failure.

## Identity and time

- A feature has a stable identifier that survives geometry and name changes.
- A feature revision is valid from a calendar year, inclusive, until the next revision for that feature.
- Same-year revisions have an explicit monotonic order inside a transaction; query results never depend on SQLite's incidental row order.
- A view year selects the revision with the greatest `valid_from_year` not greater than the view year.
- An era has a stable identifier, a name, and an inclusive start/end year (or an explicitly open end). It labels the year axis and never duplicates feature revisions.
- A timeline event has a stable identifier, title, optional description, inclusive start/end year, and explicit same-start-year ordering. It records chronology independently from map geometry and named eras.

## Feature classes

The initial classes are `terrain`, `forest`, `river`, `coastline`, `country`, `region`, `boundary`, `city`, and `town`. Cities and towns require GeoJSON `Point`; rivers, coastlines, and boundaries require `LineString`; terrain, forests, countries, and regions require `Polygon`. Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two positions, and polygon rings contain at least four positions with equal first and last positions. The Rust command boundary validates these requirements. No class is populated by a generator in the 0.1 series.

Country and region polygons are independent political overlays on the same world plane as terrain polygons. They do not store a parent terrain identifier and are not clipped to one terrain feature, so one area can cross multiple terrain features and one terrain feature can contain multiple areas. Their own year-scoped revisions determine how political divisions change without rewriting physical geography.

Timeline-event storage is part of schema version 1 because chronology is confirmed product scope. The project save command transactionally replaces the complete editable era and timeline-event lists while preserving their stable identifiers. Events with the same start year receive deterministic order from their submitted list order.

## Cell grid and attributes

Schema version 2 adds a fixed EPSG:4326 grid of 512 columns by 256 rows. A cell has no stored GeoJSON: its stable `x:y` identifier and grid version derive its center coordinate and bounds. The brush converts pointer coordinates into grid coordinates and includes every cell center within the selected radius of each stroke segment. This produces a zoom-independent round stamp for a click and a continuous thick path for a drag.

Cell attributes are independent layers. `terrain_kind`, `forest`, `country`, and `region` may coexist on one cell; changing or clearing one layer does not replace the others. `mountain` is a `terrain_kind` value rather than a tenth feature class. Country and region values are local labels and remain independent from legacy country and region polygons.

Each completed brush stroke writes one cell edit operation and a revision for every affected cell in one transaction. Revisions use the same inclusive view-year and deterministic same-year ordering rules as features. Erasing an attribute appends a deleted state. Undo and redo compensate the complete stroke rather than updating or deleting prior rows.

## Edit behavior

Manual edits append or supersede revisions inside a transaction. Database triggers prevent updates and deletes of revision rows; deletion is a new revision with a deleted state, not an immediate loss of historical rows. A user can inspect earlier years after later edits. Geometry is JSON validated by SQLite and is documented as GeoJSON in EPSG:4326. Image import is outside the product boundary.

Feature and cell-batch undo and redo append compensating revisions through the same transaction boundary. Metadata undo and redo restore the prior world, era, and event state transactionally. Undo stacks belong to the open Rust project session and are cleared when a project is opened again; they are not a second persisted history format.

## Internal schema evolution

Schema changes to app-managed worlds require a migration, fixtures for the relevant internal versions, and a rollback-safe failure test. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
