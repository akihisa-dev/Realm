# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. The internal path is implementation state, not a user document. SQLite journal sidecars may exist while the world is open and are not separate artifacts.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source through one read-only connection, file identity, and SHA-256 content digests for the main/WAL/SHM bundle, takes a SQLite online-backup snapshot (including committed WAL state) from create-new private siblings, synchronizes that staging file, publishes it with no-replace rename relative to a pinned parent directory descriptor, and then synchronizes that descriptor before opening a new UUID-named single-file copy inside the library. A source replacement, digest/content change, sidecar-set change, non-regular sidecar, or SQLite `SQLITE_FCNTL_HAS_MOVED` signal during the snapshot is rejected; the selected source database and any journal sidecars remain unchanged. PNG, JPEG, and PDF exports are derived presentation artifacts and contain no editable Realm database.

Schema version 10 is the current single-state format. It records the same value in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Exact version 3 through 9 databases are accepted by read-only preflight and upgraded transactionally. The staged migration path performs legacy shape rebuilds, the v2 fine-grid cell migration, and the region-ID migration in one transaction, so a later-stage failure cannot leave a partially upgraded source. Existing rows are preserved, version markers are recorded last, and every failure rolls back completely. Legacy color-only region components receive stable generated IDs while their display colors remain unchanged. Formats from the retired chronology model are rejected without opening a read/write connection or changing the source. Realm does not silently discard chronology data or choose one historical snapshot on the user's behalf. A newer version, partial SQLite file, integrity failure, or schema whose columns, declared types, nullability, keys, indexes, foreign keys, or checks do not preserve its declared version is also rejected during read-only preflight.

## Identity and current state

- A world has one stable identifier, one current name, and one bounded project-settings object.
- An editable cell has one stable `x:y` identifier and may have independent current `terrain` and `region` cell attributes. A region attribute stores its display color and a persistent UUID-like region ID; cells with the same ID form one logical region even when their visible components are disconnected. Its bounded polygon is derived from the fixed grid and is not persisted as geometry.
- Painting or clearing terrain or a region validates and deduplicates the complete selected cell set before changing its current rows transactionally in one undo step. Terrain erasure clears the selected terrain and region rows together; region erasure clears only region rows.
- Project settings preserve only the selected renderer theme, bounded project-local color overrides, grid visibility/kind/color/width/spacing, raster export scale and extent, and integer canvas width and height from 512 through 8192 pixels. Theme overrides accept only the documented palette keys and `#RRGGBB` values; grid kind is geographic, square, or hexagonal. The command boundary accepts exactly the documented keys and values. Viewport, zoom, active tool, selection, draw-paint range, drawing gesture, and per-class visibility remain transient.
- Undo and redo are session state, not persisted map history. They restore the complete before or after state of one edit operation while the project remains open.
- Reopening a project clears the undo and redo stacks without changing the saved map.

Realm does not persist years, named eras, timeline events, feature revisions, deletion revisions, or same-year ordering. These concepts require a new product decision before they can return.

## Terrain cells and compatibility features

The active editor creates, displays, selects, and edits the following current map representations:

| Derived geometry | Editable layer |
| --- | --- |
| bounded odd-row-offset hexagonal cell | `terrain` |
| bounded odd-row-offset hexagonal cell | color-valued `region` |

The version 9 SQLite `features` table still recognizes the following compatibility classes so existing projects can open without destructive migration:

| Geometry | Feature classes |
| --- | --- |
| `Point` | `city`, `town`, `mountain`, `tree`, `symbol`, `label`, `scale` |
| `LineString` | `river`, `coastline`, `boundary`, `road` |
| `Polygon` | `terrain`, `forest`, `country`, `region`, `lake`, `overlay`, `frame` |

Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world, lines contain at least two distinct consecutive positions, and polygon rings contain at least four positions with equal first and last positions. New writes are limited to 4096 coordinates and 512 KiB of encoded geometry; zero-area or self-intersecting rings are rejected. Polygon holes must be strictly inside the outer ring and may not touch, intersect, or contain one another. The legacy read validator remains compatible with already stored version 6 geometry while every create or revise command uses the strict write validator. No class is populated by a generator.

The active terrain and region representations are independent cell layers. Realm does not store flat-land, mountain, biome, or another terrain-kind value. Active region edits write the selected `#RRGGBB` color and region ID; opacity remains renderer presentation. Feature rows remain current-state compatibility data when terrain cells or regions are edited. A completed region stroke writes one ID to all selected region cells. Grab mode moves every active region cell with one region ID as one session-undoable operation, including cells without a `terrain` row; the renderer keeps every persisted region cell visible and derives disconnected six-connected components from the same ID-plus-color rows. Pulling a visible terrain or region edge outward or inward updates only the corresponding cell layer in one session-undoable operation, retains region IDs, and uses the current pointer position for the transient preview. Compatibility feature rows remain excluded from renderer input.

## Legacy embedded assets

Version 5 introduced validated image assets in an `assets` table inside the same database. The hex terrain editor has no asset import, placement, management, rendering, or deletion entry. Existing rows remain local compatibility data and are preserved during terrain edits and transfer.

Project snapshots expose only bounded asset manifests. Bytes cross the command boundary only through an explicit single-asset read. Identical bytes deduplicate by SHA-256. A feature refers to an asset by identifier in its validated properties; deletion and undo refuse to remove an asset while any feature still references it. Absolute paths and network locations are never persisted.

A bounded asset-pack import validates 1 through 256 images and at most 64 MiB before one transaction. Newly inserted assets receive a generated pack identifier, the user-supplied pack name, and a stable zero-based ordinal in reserved metadata fields. Existing SHA-identical assets are reused without rewriting their metadata. Pack deletion validates every identifier and reference before one transaction; import and deletion are each one undoable operation.

## Hexagonal cell grid and attributes

The active editor uses a fixed 128 by 73 EPSG:4326 odd-row-offset grid of regular point-topped hexagons. Active cell identity remains `x:y`, with `x` from 0 through 127 and `y` from 0 through 72. Every active cell derives to the same regular six-sided polygon; boundary cells are not stretched or clipped to imitate a rectangular cell. A dedicated renderer displays the complete editing grid from the empty state, while semantic cell objects are created only for persistent terrain or transient paint selection. Neither representation persists OpenLayers or GeoJSON geometry.

The version 10 SQLite schema retains its original 512 by 256 coordinate envelope so projects written by earlier builds remain structurally valid. Rows outside the active 128 by 73 editor grid are compatibility data: they remain stored unchanged but are excluded from active rendering, selection, reads, and new mutations.

The `terrain` layer is present when a cell belongs to the drawn map and absent when it does not. The `region` layer stores the current display color and persistent region ID for a selected cell and may coexist with `terrain` on the same cell. A pointer stroke applies or clears the complete selected set transactionally. Active region writes use `#RRGGBB` plus a valid region ID; an older non-color region value remains readable and uses the renderer's fallback region style until recolored. A grabbed region keeps every translated cell within the fixed grid, including cells without a `terrain` row; those cells remain persisted and visible to the renderer. If a translated cell is occupied by another region, that existing row is preserved and the moving region row is omitted for that cell. A boundary grab extends or clears terrain cells for the six-connected terrain component under the pointer, or region cells for the selected region component, without converting one layer into the other. Derived region geometry groups every region row by ID and color, then splits each group into six-connected display components without intersecting it with terrain. Existing `forest` and `country` cell rows are preserved unchanged but hidden from the active editor. There is no `terrain_kind` value, and the editor does not reinterpret compatibility feature rows as terrain or active regions.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, fixtures for every accepted source version, source-preservation tests for rejected versions, and rollback-safe failure tests. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit tested capability of the receiving release, not the normal document-opening model.
