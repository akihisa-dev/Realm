## Summary

-

## Scope and data impact

- [ ] No `.realmmap` user data, secrets, credentials, or personal data is included.
- [ ] If storage, years, eras, or feature revisions changed, the engineering source of truth is updated.
- [ ] Network, cloud, generation, and image-to-map behavior remain outside 0.1.0 unless explicitly approved.

## Verification

- [ ] App formatter, Rust checks, strict TypeScript checks, and tests declared by the current app package.
- [ ] `git diff --check`
- [ ] `.githooks/secret-guard.sh --self-test`
- [ ] GitHub checks passed.

## Publication

- [ ] This PR does not imply permission to push, tag, or publish a Release.
