# Electron migration characterization

This directory freezes the observable contract that the Electron storage and
renderer must match. `migrationInventory.ts` maps each migration requirement to
the existing legacy/React/OpenLayers test names and reserves a suite name for the
new implementation. `migrationSnapshot.ts` provides a deterministic comparison
for synthetic golden snapshots; SQLite row order and JSON object key order do not
affect the result. Source hash and sidecar identity are compared separately so a
successful data comparison cannot hide source mutation.

The baseline is intentionally synthetic and contains no user `.realmmap` data.
Run it without starting Realm or any GUI:

```sh
cd app
pnpm test -- migration-tests
pnpm test
```

When an Electron storage API is available, add tests under this directory using
the corresponding `electronSuite` id. Each test should create its own temporary
database, compare a `MigrationSnapshot` to the legacy baseline/golden, and assert
`compareSourceIdentity` after import/rejection. GUI startup is not part of this
gate; renderer behavior remains covered by the existing jsdom/OpenLayers unit
tests listed in the inventory.

## Vitest project split (migration plan)

The Electron main process must run in a Node environment while React/OpenLayers
tests remain in jsdom. Once the main-process modules land, configure Vitest
projects with a `node` project for `src/main/**/*.test.ts` and this directory's
filesystem/SQLite characterization tests, and a `renderer` project for
`src/**/*.test.{ts,tsx}` excluding `src/main/**` (jsdom plus the existing setup
file). Keeping the projects explicit prevents a renderer test from accidentally
opening a native path and prevents a main-process test from receiving a fake DOM.
