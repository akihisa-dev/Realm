# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source through one read-only connection, file identity, and SHA-256 content digests for the main/WAL/SHM bundle, takes a SQLite online-backup snapshot (including committed WAL state) from create-new private siblings, synchronizes that staging file, publishes it with no-replace rename relative to a pinned parent directory descriptor, and then synchronizes that descriptor before opening a new UUID-named single-file copy inside the library. A source replacement, digest/content change, sidecar-set change, non-regular sidecar, or SQLite `SQLITE_FCNTL_HAS_MOVED` signal during the snapshot is rejected; the selected source database and any journal sidecars remain unchanged. PNG, JPEG, and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 11 is the current single-state format. It records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Version 11 is the only accepted version. Versions 3 through 10 are rejected during read-only preflight without opening a writable connection or changing the source; Realm does not provide an automatic migration path for the new shape-based format. A newer version, partial SQLite file, integrity failure, or schema whose columns, declared types, nullability, keys, indexes, foreign keys, or checks do not preserve its declared version is also rejected during read-only preflight.

## Identity and current state

- A world has one stable identifier, one current name, and one bounded project-settings object.
- The canonical editable map consists of `map_shapes` rows. Each row stores one grid-snapped `Polygon` for one six-connected part. Terrain rows use `layer = 'terrain'` and `value = 'terrain'`; region rows use `layer = 'region'`, a persistent UUID-like `region_id`, and a `#RRGGBB` display color. Disconnected parts of one logical region share the same `region_id` while retaining separate shape IDs.
- The object manager derives one region object from each persistent region ID and derives its parts from the shape rows associated with that ID. The object manager is an editor view, not an additional SQLite entity. Its grid cell IDs are reconstructed transiently for selection, hit testing, and pointer previews; they are not stored as map geometry.
- Painting or clearing terrain or a region validates the complete selected cell set, converts it to grid-snapped polygons, and replaces the affected `map_shapes` rows transactionally in one undo step. Terrain erasure clears selected terrain and region shapes together; region erasure clears only region shapes. Shape IDs are retained when a resulting connected part can be matched to an existing part, and new IDs are created for new parts.
- Project settings preserve only the selected renderer theme, bounded project-local color overrides, grid visibility/kind/color/width/spacing, raster export scale and extent, and integer canvas width and height from 512 through 8192 pixels. Theme overrides accept only the documented palette keys and `#RRGGBB` values; grid kind is geographic, square, or hexagonal. The command boundary accepts exactly the documented keys and values. Viewport, zoom, active tool, selection, draw-paint range, drawing gesture, and per-class visibility remain transient.
- Undo and redo are session state, not persisted map history. They restore the complete before or after state of one edit operation while the project remains open.
- Reopening a project clears the undo and redo stacks without changing the saved map.

Realm does not persist years, named eras, timeline events, feature revisions, deletion revisions, or same-year ordering. These concepts require a new product decision before they can return.

## Map shapes and compatibility features

The active editor creates, displays, selects, and edits the following current map representations:

| Canonical geometry | Editable layer |
| --- | --- |
| grid-snapped `Polygon`, one six-connected part per row | `terrain` |
| grid-snapped `Polygon`, one six-connected part per row | color-valued `region` |

The schema 11 SQLite `features` table recognizes the following compatibility classes as inactive current-state data:

| Geometry | Feature classes |
| --- | --- |
| `Point` | `city`, `town`, `mountain`, `tree`, `symbol`, `label`, `scale` |
| `LineString` | `river`, `coastline`, `boundary`, `road` |
| `Polygon` | `terrain`, `forest`, `country`, `region`, `lake`, `overlay`, `frame` |

Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two distinct consecutive positions, and polygon rings contain at least four positions with equal first and last positions. New writes are limited to 4096 coordinates and 512 KiB of encoded geometry; zero-area or self-intersecting rings are rejected. Polygon holes must be strictly inside the outer ring and may not touch, intersect, or contain one another. The legacy read validator remains compatible with already stored version 6 geometry while every create or revise command uses the strict write validator. No class is populated by a generator.

The active terrain and region representations are independent polygon layers. Realm does not store flat-land, mountain, biome, or another terrain-kind value. Active region edits write the selected `#RRGGBB` color and region ID; opacity remains renderer presentation. Feature rows remain current-state compatibility data and are not rewritten when terrain shapes or regions are edited. A completed region stroke converts its selected grid cells to one or more grid-snapped polygons with one region ID. Grab mode hit-tests those saved polygons directly, previews continuous movement or edge/vertex changes in the renderer, and normalizes one complete replacement on pointerup; every polygon part with one region ID moves together, including disconnected parts. If the destination overlaps another shape in the same layer, the replacement is rejected and the source remains unchanged. Shaping intersects a logical region with the terrain union using transient grid calculations and retains region IDs. Compatibility feature rows remain excluded from renderer input.

## Legacy embedded assets

Version 5 introduced validated image assets in an `assets` table inside the same database. The hex terrain editor has no asset import, placement, management, rendering, or deletion entry. Existing rows remain local compatibility data and are preserved during terrain edits and transfer.

Project snapshots expose only bounded asset manifests. Bytes cross the command boundary only through an explicit single-asset read. Identical bytes deduplicate by SHA-256. A feature refers to an asset by identifier in its validated properties; deletion and undo refuse to remove an asset while any feature still references it. Absolute paths and network locations are never persisted.

A bounded asset-pack import validates 1 through 256 images and at most 64 MiB before one transaction. Newly inserted assets receive a generated pack identifier, the user-supplied pack name, and a stable zero-based ordinal in reserved metadata fields. Existing SHA-identical assets are reused without rewriting their metadata. Pack deletion validates every identifier and reference before one transaction; import and deletion are each one undoable operation.

## Hexagonal snap grid and transient selections

The active editor uses a fixed 128 by 73 EPSG:4326 odd-row-offset grid of regular point-topped hexagons. Transient cell identity is `x:y`, with `x` from 0 through 127 and `y` from 0 through 72. Paint and enclosure selections are converted to the exposed boundary rings of their hex cells and saved as grid-snapped `Polygon` rows; boundary cells are clipped to the bounded world. Grab edits begin with exact saved Polygon geometry, remain continuous during pointer movement, and are snapped back to these rings only when released. The dedicated grid and cell IDs are renderer/editor aids only. OpenLayers objects and transient cell rows are never the storage source of truth.

The version 11 SQLite schema records the active 128 by 73 snap grid in `cell_grid`. The `map_shapes` geometry rows carry `geometry_version = 1` and `snap_grid_version = 2`, and every stored polygon must round-trip to the same transient cell set. Arbitrary polygons, polygons outside the bounded world, self-intersections, same-layer overlaps, and invalid region identity/color combinations are rejected. The schema has no `cell_attributes` table.

The `terrain` layer is present when a shape covers the corresponding transient grid cells and the `region` layer stores a display color and persistent region ID; the two layers may coexist over the same cells. A pointer stroke applies or clears a complete selected set transactionally by rewriting `map_shapes`. A grabbed region keeps every translated part within the fixed grid and rejects any overlap with another region. The read-only cell view is derived from polygons for existing pointer and object-manager code, then discarded; it is not saved or included as an independent undo state. There is no `terrain_kind` value, and the editor does not reinterpret compatibility feature rows as terrain or active regions.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, a complete fixture for the accepted format, source-preservation tests for rejected versions, and rollback-safe failure tests. This release intentionally accepts only schema 11 and does not migrate earlier `.realmmap` files. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
