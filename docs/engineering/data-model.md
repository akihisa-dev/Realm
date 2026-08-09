# Data model

## File contract

Each map project is one SQLite file ending in `.realmmap`. The file is the portable project artifact. SQLite journal/WAL sidecars may exist while the project is open and are not separate user documents.

Schema version 1 records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Version 1 is the first supported format, so no implicit version-0 migration exists. A read-only preflight rejects newer versions, partial SQLite files, integrity failures, and schema objects whose columns, declared types, nullability, keys, indexes, foreign keys, checks, or append-only triggers do not preserve the version-1 invariants before opening a read/write connection. Future migrations must use an explicit old-version fixture and leave the source untouched on failure.

## Identity and time

- A feature has a stable identifier that survives geometry and name changes.
- A feature revision is valid from a calendar year, inclusive, until the next revision for that feature.
- Same-year revisions have an explicit monotonic order inside a transaction; query results never depend on SQLite's incidental row order.
- A view year selects the revision with the greatest `valid_from_year` not greater than the view year.
- An era has a stable identifier, a name, and an inclusive start/end year (or an explicitly open end). It labels the year axis and never duplicates feature revisions.
- A timeline event has a stable identifier, title, optional description, inclusive start/end year, and explicit same-start-year ordering. It records chronology independently from map geometry and named eras.

## Feature classes

The initial classes are `terrain`, `forest`, `river`, `coastline`, `country`, `region`, `boundary`, `city`, and `town`. Geometry representation and coordinate reference system must be documented in the schema migration and validated at the command boundary. No class is populated by a generator in the 0.1 series.

Timeline-event storage is part of schema version 1 because chronology is confirmed product scope. The initial repository baseline does not expose event editing yet; later commands must extend the same coarse Rust boundary rather than storing chronology in React.

## Edit behavior

Manual edits append or supersede revisions inside a transaction. Database triggers prevent updates and deletes of revision rows; deletion is a new revision with a deleted state, not an immediate loss of historical rows. A user can inspect earlier years after later edits. Geometry is JSON validated by SQLite and is documented as GeoJSON in EPSG:4326. Image import is outside the product boundary.

## Compatibility

Schema changes require: a migration, fixtures for an old and new database, a rollback-safe failure test, and an update to the release checklist if the file compatibility policy changes.
