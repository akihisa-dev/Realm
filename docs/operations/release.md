# Release operations

Realm releases are owner-led and explicit. A successful local gate or GitHub workflow does not authorize another Git operation or public publication.

## Before a tag

- Confirm the exact semver in `app/package.json`, `Cargo.toml`, and `tauri.conf.json`.
- Confirm schema compatibility notes and migration tests are current.
- Run `pnpm verify:local:push` from `app/` and inspect the complete diff.
- Run `pnpm verify:local:release` on Apple Silicon. It builds the Tauri `.app`, creates the DMG directly with the system disk-image tool without mounting a Finder volume, verifies the arm64 executable and bundle metadata, launches the package for a bounded smoke, generates a checksum, and stages notices and the committed SBOM under `release-assets/`.
- Confirm there are no user map files, credentials, or unrelated changes.

`release-assets/` must not already exist when staging a release. The staging command refuses to delete or overwrite an earlier evidence set; inspect and move that directory explicitly before another run.

The initial artifact is intentionally unsigned and unnotarized. A Developer ID identity, hardened-runtime signing design, notarization credentials, and Gatekeeper validation are separate high-impact work and must not be inferred from a build request.

## Push and Draft Release boundary

Branch push, tag creation, and tag push each require an explicit owner instruction. The pre-push hook fails closed and reruns the corresponding local gate. Authorizing a release-tag push also authorizes the workflow to create its Draft Release; it does not authorize publication.

Pushing an exact `MAJOR.MINOR.PATCH` tag is also the explicit trigger for `.github/workflows/draft-release.yml`. That workflow:

1. requires the tag to equal the package version;
2. rebuilds and verifies on a pinned Apple Silicon runner and pinned toolchains;
3. uploads `Realm-<version>-macOS-arm64.dmg`, its SHA-256 file, `THIRD_PARTY_NOTICES.md`, and `realm-dependencies.cdx.json` as immutable workflow evidence;
4. creates a GitHub Draft Release with only those verified files and refuses to overwrite an existing asset or a published Release.

The workflow has `contents: write` only in the final Draft Release job. CI and pre-release verification remain read-only. A Draft Release is not public publication; publication requires a later explicit owner action after signing/notarization policy is settled.

## Manual evidence run

`pre-release-verification.yml` is a manually dispatched, read-only workflow. It runs the same release gate and uploads short-lived workflow artifacts without creating a GitHub Release.

## Rollback

If an artifact or migration is wrong, stop publication, preserve the evidence, and issue a corrected version. Do not overwrite Release assets, rewrite published Git history, or modify a user's `.realmmap` in place.
