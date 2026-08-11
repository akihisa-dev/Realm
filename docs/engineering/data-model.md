# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source read-only, publishes a new UUID-named copy inside the library, and opens that copy. PNG, JPEG, and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 8 is the current single-state format. It records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Exact version 3 through 7 databases are accepted by read-only preflight and upgraded transactionally. The staged migration path performs the feature-properties rebuild, asset addition, project-settings addition, canvas-size addition, and version 8 terrain-cell-layer rebuild in one transaction, so a later-stage failure cannot leave a partially upgraded source. Existing rows are preserved, version markers are recorded last, and every failure rolls back completely. Formats from the retired chronology model are rejected without opening a read/write connection or changing the source. Realm does not silently discard chronology data or choose one historical snapshot on the user's behalf. A newer version, partial SQLite file, integrity failure, or schema whose columns, declared types, nullability, keys, indexes, foreign keys, or checks do not preserve its declared version is also rejected during read-only preflight.

## Identity and current state

- A world has one stable identifier, one current name, and one bounded project-settings object.
- An editable terrain cell has one stable `x:y` identifier and one current `terrain` cell-attribute value. Its bounded polygon is derived from the fixed grid and is not persisted as geometry.
- Painting or clearing terrain validates and deduplicates the complete selected cell set before changing its current rows transactionally in one undo step.
- Project settings preserve only the selected renderer theme, bounded project-local color overrides, grid visibility/kind/color/width/spacing, raster export scale and extent, and integer canvas width and height from 512 through 8192 pixels. Theme overrides accept only the documented palette keys and `#RRGGBB` values; grid kind is geographic, square, or hexagonal. The command boundary accepts exactly the documented keys and values. Viewport, zoom, active tool, selection, drawing gesture, and per-class visibility remain transient.
- Undo and redo are session state, not persisted map history. They restore the complete before or after state of one edit operation while the project remains open.
- Reopening a project clears the undo and redo stacks without changing the saved map.

Realm does not persist years, named eras, timeline events, feature revisions, deletion revisions, or same-year ordering. These concepts require a new product decision before they can return.

## Terrain cells and compatibility features

The active editor creates, displays, selects, and edits only the following cell layer:

| Derived geometry | Editable cell layer |
| --- | --- |
| bounded odd-row-offset hexagonal cell | `terrain` |

The version 8 SQLite `features` table still recognizes the following compatibility classes so existing projects can open without destructive migration:

| Geometry | Feature classes |
| --- | --- |
| `Point` | `city`, `town`, `mountain`, `tree`, `symbol`, `label`, `scale` |
| `LineString` | `river`, `coastline`, `boundary`, `road` |
| `Polygon` | `terrain`, `forest`, `country`, `region`, `lake`, `overlay`, `frame` |

Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two distinct consecutive positions, and polygon rings contain at least four positions with equal first and last positions. New writes are limited to 4096 coordinates and 512 KiB of encoded geometry; zero-area or self-intersecting rings are rejected. Polygon holes must be strictly inside the outer ring and may not touch, intersect, or contain one another. The legacy read validator remains compatible with already stored version 6 geometry while every create or revise command uses the strict write validator. No class is populated by a generator.

The active terrain is a single cell layer. Realm does not store flat-land, mountain, biome, or another terrain-kind value. Feature rows remain byte-for-byte current-state compatibility data when terrain cells are edited. The hex terrain editor excludes them from renderer input, selection, counts, mutation callbacks, and creation controls.

## Legacy embedded assets

Version 5 introduced validated image assets in an `assets` table inside the same database. The hex terrain editor has no asset import, placement, management, rendering, or deletion entry. Existing rows remain local compatibility data and are preserved during terrain edits and transfer.

Project snapshots expose only bounded asset manifests. Bytes cross the command boundary only through an explicit single-asset read. Identical bytes deduplicate by SHA-256. A feature refers to an asset by identifier in its validated properties; deletion and undo refuse to remove an asset while any feature still references it. Absolute paths and network locations are never persisted.

A bounded asset-pack import validates 1 through 256 images and at most 64 MiB before one transaction. Newly inserted assets receive a generated pack identifier, the user-supplied pack name, and a stable zero-based ordinal in reserved metadata fields. Existing SHA-identical assets are reused without rewriting their metadata. Pack deletion validates every identifier and reference before one transaction; import and deletion are each one undoable operation.

## Hexagonal cell grid and attributes

The active editor uses a fixed 64 by 37 EPSG:4326 odd-row-offset grid of regular point-topped hexagons. Active cell identity remains `x:y`, with `x` from 0 through 63 and `y` from 0 through 36. Every active cell derives to the same regular six-sided polygon; boundary cells are not stretched or clipped to imitate a rectangular cell. A dedicated renderer displays the complete editing grid from the empty state, while semantic cell objects are created only for persistent terrain or transient brush selection. Neither representation persists OpenLayers or GeoJSON geometry.

The version 8 SQLite schema retains its original 512 by 256 coordinate envelope so projects written by earlier builds remain structurally valid. Rows outside the active 64 by 37 editor grid are compatibility data: they remain stored unchanged but are excluded from active rendering, selection, reads, and new mutations.

The `terrain` layer is present when a cell belongs to the drawn map and absent when it does not. A pointer stroke applies or clears the complete selected set transactionally. Existing `forest`, `country`, and `region` cell rows are preserved unchanged but hidden from the active editor. There is no `terrain_kind` value, and the editor does not reinterpret compatibility rows as terrain.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, fixtures for every accepted source version, source-preservation tests for rejected versions, and rollback-safe failure tests. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
