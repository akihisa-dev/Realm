# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source read-only, publishes a new UUID-named copy inside the library, and opens that copy. PNG and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 3 is the first single-state format. It records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Formats from the retired chronology model are rejected without opening a read/write connection or changing the source. Realm does not silently discard chronology data or choose one historical snapshot on the user's behalf. A newer version, partial SQLite file, integrity failure, or schema whose columns, declared types, nullability, keys, indexes, foreign keys, or checks do not preserve the declared version is also rejected during read-only preflight.

## Identity and current state

- A world has one stable identifier and a current name.
- A feature has one stable identifier, one feature class, one current name, and one current geometry.
- Creating, revising, or deleting a feature changes its current row transactionally.
- Undo and redo are session state, not persisted map history. They restore the complete before or after state of one edit operation while the project remains open.
- Reopening a project clears the undo and redo stacks without changing the saved map.

Realm does not persist years, named eras, timeline events, feature revisions, deletion revisions, or same-year ordering. These concepts require a new product decision before they can return.

## Feature classes

The initial classes are `terrain`, `forest`, `river`, `coastline`, `country`, `region`, `boundary`, `city`, and `town`. Cities and towns require GeoJSON `Point`; rivers, coastlines, and boundaries require `LineString`; terrain, forests, countries, and regions require `Polygon`. Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two positions, and polygon rings contain at least four positions with equal first and last positions. The Rust command boundary validates these requirements. No class is populated by a generator.

Terrain is a single polygon class. Realm does not store flat-land, mountain, or another terrain-kind value. Country and region polygons are independent political overlays on the same world plane as terrain polygons. They do not store a parent terrain identifier and are not clipped to one terrain feature.

## Cell grid and attributes

The schema contains a fixed EPSG:4326 grid of 512 columns by 256 rows. A cell has no stored GeoJSON: its stable `x:y` identifier and grid version derive its center coordinate and bounds. The brush converts pointer coordinates into grid coordinates and includes every cell center within the selected radius of each stroke segment. This produces a zoom-independent round stamp for a click and a continuous thick path for a drag.

Cell attributes are current independent layers. `forest`, `country`, and `region` may coexist on one cell; changing or clearing one layer does not replace the others. There is no `terrain_kind` cell layer. Each completed brush stroke upserts or deletes the affected current rows in one transaction. Undo and redo restore the complete before or after cell set for the stroke.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, fixtures for every accepted source version, source-preservation tests for rejected versions, and rollback-safe failure tests. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
