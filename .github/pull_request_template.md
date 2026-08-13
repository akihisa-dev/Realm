## Summary

-

## Scope and data impact

- [ ] No `.realmmap` user data, secrets, credentials, or personal data is included.
- [ ] If storage, map features, or cell attributes changed, the engineering source of truth is updated.
- [ ] Network, cloud, generation, and image-to-map behavior remain outside the 0.1 series unless explicitly approved.

## Verification

- [ ] Strict TypeScript checks and tests declared by the current app package.
- [ ] `git diff --check`
- [ ] `.githooks/secret-guard.sh --self-test`
- [ ] The required local verification commands passed.

## Publication

- [ ] This PR does not imply permission to push, tag, or publish a Release.
