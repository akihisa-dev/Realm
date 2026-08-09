# Release operations

Realm releases are owner-led and explicit. The repository does not use GitHub Actions. A successful local gate does not authorize a Git operation, Draft Release creation, or public publication.

## Before a tag

- Confirm the exact semver in `app/package.json`, `Cargo.toml`, `tauri.conf.json`, and the committed SBOM.
- Confirm schema compatibility notes and migration tests are current.
- Run `pnpm verify:local:push` from `app/` and inspect the complete diff.
- Run `pnpm verify:local:release` on Apple Silicon. It builds the Tauri `.app`, creates the DMG directly with the system disk-image tool without mounting a Finder volume, verifies the arm64 executable and bundle metadata, launches the package for a bounded smoke, generates a checksum, and stages notices and the committed SBOM under `release-assets/`.
- Confirm there are no user map files, credentials, or unrelated changes.

`release-assets/` must not already exist when staging a release. The staging command refuses to delete or overwrite an earlier evidence set; inspect and move that directory explicitly before another run.

The initial artifact is intentionally unsigned and unnotarized. A Developer ID identity, hardened-runtime signing design, notarization credentials, and Gatekeeper validation are separate high-impact work and must not be inferred from a build request.

## Git and GitHub boundaries

Branch push, tag creation, tag push, Draft Release creation, and Release publication each require a separate explicit owner instruction. The pre-push hook fails closed and reruns the corresponding local gate. No tag or push triggers an automated workflow.

When the owner explicitly requests a Draft Release after the exact `MAJOR.MINOR.PATCH` tag exists on GitHub:

1. verify that the tag equals the application version and points at the locally verified commit;
2. use only the four files already staged by `pnpm verify:local:release` under `release-assets/`;
3. create a GitHub Draft Release without overwriting an existing asset or a published Release;
4. keep the Release as a draft until the owner separately authorizes publication.

The expected files are `Realm-<version>-macOS-arm64.dmg`, its `.sha256` file, `THIRD_PARTY_NOTICES.md`, and `realm-dependencies.cdx.json`. Do not rebuild or mutate them during Draft Release creation.

## Rollback

If an artifact or migration is wrong, stop publication, preserve the evidence, and issue a corrected version. Do not overwrite Release assets, rewrite published Git history, or modify a user's `.realmmap` in place.
