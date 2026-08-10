# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source read-only, publishes a new UUID-named copy inside the library, and opens that copy. PNG, JPEG, and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 7 is the current single-state format. It records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Exact version 3, 4, 5, and 6 databases are accepted by read-only preflight and upgraded transactionally. The version 3 path performs the version 4 feature-properties rebuild, the version 5 asset addition, the version 6 project-settings addition, and the version 7 canvas-size addition in one transaction, so a later-stage failure cannot leave a partially upgraded source. Existing rows are preserved, version markers are recorded last, and every failure rolls back completely. Formats from the retired chronology model are rejected without opening a read/write connection or changing the source. Realm does not silently discard chronology data or choose one historical snapshot on the user's behalf. A newer version, partial SQLite file, integrity failure, or schema whose columns, declared types, nullability, keys, indexes, foreign keys, or checks do not preserve its declared version is also rejected during read-only preflight.

## Identity and current state

- A world has one stable identifier, one current name, and one bounded project-settings object.
- A feature has one stable identifier, one feature class, one current name, one current geometry, and one current JSON properties object.
- Creating, revising, deleting, or explicitly locking a feature changes its current row transactionally. Bounded multi-feature revisions, deletions, and lock changes validate the complete request before one transaction and one undo step.
- A bounded multi-feature create validates every feature first and commits the complete batch as one undoable transaction. It is used for explicit symbol scatter; generated candidates do not remain an implicit renderer layer.
- Feature properties hold bounded renderer-independent values such as line width, symbol scale, or rotation. The command boundary accepts only JSON objects of at most 32 KiB; OpenLayers objects, viewport state, and external paths are never stored there.
- Project settings preserve only the selected renderer theme, bounded project-local color overrides, grid visibility/kind/color/width/spacing, raster export scale and extent, and integer canvas width and height from 512 through 8192 pixels. Theme overrides accept only the documented palette keys and `#RRGGBB` values; grid kind is geographic, square, or hexagonal. The command boundary accepts exactly the documented keys and values. Viewport, zoom, active tool, selection, drawing gesture, and per-class visibility remain transient.
- Undo and redo are session state, not persisted map history. They restore the complete before or after state of one edit operation while the project remains open.
- Reopening a project clears the undo and redo stacks without changing the saved map.

Realm does not persist years, named eras, timeline events, feature revisions, deletion revisions, or same-year ordering. These concepts require a new product decision before they can return.

## Feature classes

The feature classes and their required GeoJSON geometry are:

| Geometry | Feature classes |
| --- | --- |
| `Point` | `city`, `town`, `mountain`, `tree`, `symbol`, `label`, `scale` |
| `LineString` | `river`, `coastline`, `boundary`, `road` |
| `Polygon` | `terrain`, `forest`, `country`, `region`, `lake`, `overlay`, `frame` |

Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two distinct consecutive positions, and polygon rings contain at least four positions with equal first and last positions. New writes are limited to 4096 coordinates and 512 KiB of encoded geometry; zero-area or self-intersecting rings are rejected. Polygon holes must be strictly inside the outer ring and may not touch, intersect, or contain one another. The legacy read validator remains compatible with already stored version 6 geometry while every create or revise command uses the strict write validator. No class is populated by a generator.

Terrain is a single polygon class. Realm does not store flat-land, mountain, or another terrain-kind value. A `mountain` is a separately placed point feature whose appearance is derived by the renderer. Country and region polygons are independent political overlays on the same world plane as terrain polygons. They do not store a parent terrain identifier and are not clipped to one terrain feature.

## Embedded assets

Version 5 introduced validated image assets in an `assets` table inside the same database. Each row has a stable identifier, unique SHA-256 digest, MIME type, byte length, dimensions, metadata JSON object, and bytes. Import accepts PNG, JPEG, or WebP only, with an 8 MiB byte limit and a 32768-pixel limit per dimension. SVG is not accepted because safe offline rendering would require complete active-content and external-reference sanitization.

Project snapshots expose only bounded asset manifests. Bytes cross the command boundary only through an explicit single-asset read. Identical bytes deduplicate by SHA-256. A feature refers to an asset by identifier in its validated properties; deletion and undo refuse to remove an asset while any feature still references it. Absolute paths and network locations are never persisted.

A bounded asset-pack import validates 1 through 256 images and at most 64 MiB before one transaction. Newly inserted assets receive a generated pack identifier, the user-supplied pack name, and a stable zero-based ordinal in reserved metadata fields. Existing SHA-identical assets are reused without rewriting their metadata. Pack deletion validates every identifier and reference before one transaction; import and deletion are each one undoable operation.

## Cell grid and attributes

The schema contains a fixed EPSG:4326 grid of 512 columns by 256 rows. A cell has no stored GeoJSON: its stable `x:y` identifier and grid version derive its center coordinate and bounds. The brush converts pointer coordinates into grid coordinates and includes every cell center within the selected radius of each stroke segment. This produces a zoom-independent round stamp for a click and a continuous thick path for a drag.

Cell attributes are current independent layers. `forest`, `country`, and `region` may coexist on one cell; changing or clearing one layer does not replace the others. There is no `terrain_kind` cell layer. Each completed brush stroke upserts or deletes the affected current rows in one transaction. Undo and redo restore the complete before or after cell set for the stroke.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, fixtures for every accepted source version, source-preservation tests for rejected versions, and rollback-safe failure tests. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
