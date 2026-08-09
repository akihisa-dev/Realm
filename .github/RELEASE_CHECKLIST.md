# Release checklist

Release operations are explicit approvals. This repository does not use GitHub Actions. A commit does not authorize a branch push, tag creation, tag push, Draft Release creation, or publication.

## Before a tag

- [ ] Version sources and the committed SBOM agree on the intended semver.
- [ ] Schema migrations and `.realmmap` compatibility notes are current.
- [ ] `verify:local:push` passed on Apple Silicon.
- [ ] `verify:local:release` passed, including the arm64 build and static bundle inspection without launching the built package.
- [ ] The DMG checksum, notices, and committed CycloneDX SBOM exist under `release-assets/`.
- [ ] Any earlier `release-assets/` evidence was inspected and moved explicitly; the staging command did not overwrite it.
- [ ] The complete diff, secret guard, and untracked files were reviewed.
- [ ] The unsigned and unnotarized status is acceptable for this release candidate.

## Before pushing

- [ ] Owner explicitly authorized this exact branch or tag push.
- [ ] `.githooks/secret-guard.sh --range <outgoing-range>` passed.
- [ ] The ref points at the locally verified commit.
- [ ] The corresponding local gate was rerun immediately before push.

## Before creating a Draft Release

- [ ] Owner explicitly authorized Draft Release creation after the tag push.
- [ ] The tag is exact `MAJOR.MINOR.PATCH`, equals `app/package.json`, and points at the verified commit.
- [ ] The Draft contains only the staged DMG, SHA-256 file, notices, and SBOM.
- [ ] No artifact was rebuilt, changed, or overwritten during upload.
- [ ] No existing or published asset was overwritten.
- [ ] The Release remains a draft.

## Publication

- [ ] Signing and notarization were handled under a separately approved credential process.
- [ ] Gatekeeper validation passed on the final notarized artifact.
- [ ] Owner explicitly authorized public GitHub Release publication.
