# Data model

## File contract

Each library world is one SQLite database stored below Realm's macOS application-data directory under a UUID filename. SQLite journal sidecars may exist while the world is open; they are not separate Realm documents.

The same single-database representation is copied to a `.realmmap` file only for explicit transfer export. Import validates the selected source through a read-only connection, file identity, and SHA-256 content digests for the main/WAL/SHM bundle, takes a SQLite online-backup snapshot into private create-new siblings, synchronizes that staging file, publishes it with no-replace rename, and then opens the new library copy. A source replacement, digest/content change, sidecar-set change, non-regular sidecar, or SQLite `SQLITE_FCNTL_HAS_MOVED` signal is rejected; the selected source remains unchanged.

Schema version 12 is the only accepted storage format. It records the same version in `PRAGMA user_version` and `schema_migrations`; disagreement is corruption. Versions 1 through 11 are rejected during read-only preflight without opening a writable connection or changing the source. Realm does not migrate `features`, `map_shapes`, `cell_grid`, or any other older table into schema 12. A newer version, partial SQLite file, integrity failure, retired table, or schema whose columns, keys, indexes, foreign keys, or checks do not preserve the declared format is also rejected before a writable open.

## Identity and current state

- A world has one stable identifier, one current name, and one bounded project-settings object.
- The editable map is split into exactly three layers: `terrain`, `region`, and `object`.
- `terrain` is the current terrain itself. It does not encode surface, water system, biome, mountain type, or another terrain classification.
- `region` is a separate logical layer. A region is not an object and is never stored in the object table.
- `object` contains things placed above terrain and regions. Initial kinds are `city`, `text`, `mountain`, and `forest`.
- The canonical snapshot exposes `layers.terrain`, `layers.regions`, and `layers.objects` separately. Renderer projections such as transient `MapShape[]` and legacy-shaped feature arrays are derived in memory and are not storage rows.
- Undo and redo are session state. Each successful layer replacement or other command records a complete before/after state in one transaction and one history step.
- Reopening a project clears undo and redo without changing the saved current state.

## SQLite tables

| Table | Persistent responsibility |
| --- | --- |
| `world` | One world name and bounded project settings |
| `terrain_shapes` | Terrain grid-snapped `Polygon` rows (`id`, `geometry_json`) |
| `regions` | Region identity, name, and `#RRGGBB` color |
| `region_shapes` | Region polygon parts linked to `regions` by `region_id` |
| `objects` | Object identity, kind, label, geometry, validated properties, `z_index`, lock state, and optional asset reference |
| `assets` | Validated local image bytes and manifests |

There is deliberately no generic `features` table and no table that mixes terrain, regions, and objects. Old `features`, `map_shapes`, `cell_grid`, `cell_attributes`, and history tables are retired names; their presence causes rejection rather than an automatic conversion.

Terrain and region shapes use grid-snapped `Polygon` geometry. Same-layer polygon overlap is rejected. Terrain and region geometry may occupy the same cells because they are independent layers. Region shapes must refer to an existing region. Objects may overlap terrain, regions, and other objects; their `z_index` controls order within the object layer.

Object geometry is validated by kind:

| Kind | Geometry | Meaning |
| --- | --- | --- |
| `city` | `Point` | City or settlement marker |
| `text` | `Point` | Text anchor and label |
| `mountain` | `Point` | Mountain marker |
| `forest` | `Polygon` | Forest area placed above the base layers |

Coordinates are EPSG:4326 longitude/latitude pairs within the bounded world. Lines and polygons use closed, non-self-intersecting rings where applicable; zero-area and malformed geometry is rejected. Object properties are bounded JSON objects. No object kind is generated implicitly from an old feature class. Adding a kind requires its registry, geometry validator, renderer style, UI control, tests, and documentation to change together.

## Layer edits and transient grid data

The active editor uses a fixed 128 by 73 odd-row-offset hexagonal grid. Cell IDs such as `x:y` exist only while rendering, hit testing, and collecting a pointer selection. They are never persisted and are not part of undo state.

Terrain painting and terrain erasing convert the transient selection into complete terrain polygon rows. Region drawing and region erasing perform the equivalent operation against region polygon parts and region identity. The shared toolbar entry may be labelled “draw”, but the terrain handler and region handler have different input modes and storage results. The eraser is likewise layer-specific: terrain eraser changes only `terrain_shapes`, region eraser changes only `regions` and `region_shapes`, and object eraser changes only `objects`.

The layer switch is a hard gesture boundary. In-progress pointer interactions, selection, and previews are cancelled before the new layer becomes active. The selected layer is the only layer that accepts primary-pointer creation, selection, movement, deletion, and shape editing. Other layers remain visible. Middle-button, right-button, Space, and wheel navigation are shared across all layers.

## Assets

Assets remain local rows in the same database. Project snapshots expose bounded manifests; bytes cross the command boundary only through an explicit asset read. Identical bytes deduplicate by SHA-256. An object may refer to an asset by `asset_id`; deletion and undo refuse to remove a referenced asset. Absolute paths and network locations are never persisted.

## Internal schema evolution

Schema changes to app-managed worlds require a declared version, a complete fixture for the accepted format, source-preservation tests for rejected versions, and rollback-safe failure tests. This release intentionally accepts only schema 12 and has no automatic migration path from older `.realmmap` files. Transfer data has no independent long-term compatibility promise; accepting an older transfer is an explicit, separately tested capability rather than the normal opening model.
