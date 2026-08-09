# Security Policy

Realm is a local-first application and a public repository. Do not put secrets, credentials, private map data, or personal information into Git, issues, pull requests, logs, fixtures, or screenshots.

## Do not disclose publicly

- `.env` files, authenticated `.npmrc` files, cloud credentials, signing keys, or certificates;
- API tokens, HTTP authorization headers, database URLs with passwords, or private keys;
- private locations, personal data, or a user's `.realmmap` database;
- an exploitable vulnerability with enough detail to enable immediate abuse.

If a secret was committed, revoke or rotate it first and contact the owner through a private GitHub Security Advisory or another private maintainer-provided channel. Removing a file from a later commit does not make the old secret safe.

## Reporting

For vulnerabilities or leaked secrets, use GitHub Security Advisories where available. Do not open a public issue with the details. Include affected commit or version, impact, reproduction at a safe level, and a suggested mitigation; omit real credentials and private map data.

For ordinary defects without sensitive details, use a public issue only when you accept the owner-led response policy in [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository defense

- `.githooks/secret-guard.sh` checks staged files and outgoing commit ranges for credential-like names and high-confidence token patterns.
- The pre-commit and pre-push hooks are advisory safeguards; run the guard explicitly when hooks are disabled or when reviewing an outgoing range.
- CI uses least-privilege read permissions and disables checkout credential persistence.
- A push or release is never authorized merely because CI is green. Run the local publication gate on Apple Silicon, inspect the diff, and obtain explicit owner approval.

The guard intentionally favors high-confidence patterns to avoid hiding secrets in an allowlist. If it reports a false positive, rewrite the fixture or documentation to a safe placeholder rather than weakening the rule without a documented security review.
