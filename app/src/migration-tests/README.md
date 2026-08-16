# Electron storage characterization

This directory freezes the observable contract that the Electron storage and
renderer must match. `migrationInventory.ts` retains historical test references
as evidence while the current implementation is characterized by the schema 12
SQLite and renderer suites. `migrationSnapshot.ts` provides a deterministic
comparison for synthetic schema-12 golden snapshots; SQLite row order and JSON
object key order do not affect the result. Source hash and sidecar identity are
compared separately so a successful layer comparison cannot hide source mutation.

The baseline is intentionally synthetic and contains no user `.realmmap` data.
Run it without starting Realm or any GUI:

```sh
cd app
pnpm test -- migration-tests
pnpm test
```

Storage tests under this directory create their own temporary database, compare
the current `terrain`/`regions`/`objects` snapshot to the synthetic golden, and assert
`compareSourceIdentity` after import/rejection. GUI startup is not part of this
gate; renderer behavior remains covered by the existing jsdom/OpenLayers unit
tests listed in the inventory.

## Vitest project split

The Electron main process runs in a Node environment while React/OpenLayers tests
remain in jsdom. Vitest projects keep `src/main/**/*.test.ts` and this
directory's filesystem/SQLite characterization tests in the `node` project, and
`src/**/*.test.{ts,tsx}` excluding `src/main/**` in the `renderer` project. This
prevents a renderer test from accidentally opening a native path and prevents a
main-process test from receiving a fake DOM.
