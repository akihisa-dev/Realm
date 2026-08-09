# Release checklist

Release operations are explicit approvals. A commit does not authorize a branch push or tag. An authorized release-tag push also authorizes automated Draft Release creation, but never signing, notarization, or publication.

## Before a tag

- [ ] Version sources agree on the intended semver.
- [ ] Schema migrations and `.realmmap` compatibility notes are current.
- [ ] `verify:local:push` passed on Apple Silicon.
- [ ] `verify:local:release` passed, including arm64 build, bundle inspection, and launch smoke.
- [ ] The DMG checksum, notices, and committed CycloneDX SBOM exist under `release-assets/`.
- [ ] Any earlier `release-assets/` evidence was inspected and moved explicitly; the staging command did not overwrite it.
- [ ] The complete diff, secret guard, and untracked files were reviewed.
- [ ] The unsigned/unnotarized status is acceptable for this Draft Release.

## Before pushing

- [ ] Owner explicitly authorized this exact branch or tag push.
- [ ] `.githooks/secret-guard.sh --range <outgoing-range>` passed.
- [ ] The ref points at the locally verified commit.
- [ ] The corresponding local gate was rerun immediately before push.

## Draft Release workflow

- [ ] The tag is exact `MAJOR.MINOR.PATCH` and equals `app/package.json`.
- [ ] The pinned macOS arm64 workflow and release gate passed.
- [ ] The Draft contains only the verified DMG, SHA-256 file, notices, and SBOM.
- [ ] No existing or published asset was overwritten.
- [ ] The Release remains a draft.

## Publication

- [ ] Signing and notarization were handled under a separately approved credential process.
- [ ] Gatekeeper validation passed on the final notarized artifact.
- [ ] Owner explicitly authorized public GitHub Release publication.
