# Development

## Start here

1. Work on Apple Silicon macOS 14 or later.
2. Read [AGENTS.md](../AGENTS.md), [docs/INDEX.md](INDEX.md), and the source-of-truth document related to the change.
3. Keep test databases in temporary directories. Never point a test at a personal `.realmmap`.
4. Inspect `git status --short`, the lockfiles, and current target files before writing.

## Pinned environment

Realm requires the exact Node.js version in `.node-version`, the exact pnpm version in `app/package.json`, and the exact Rust toolchain in `rust-toolchain.toml`. It also requires cargo-deny 0.20.2. The runtime gate rejects another OS, architecture, or pinned tool version.

A Homebrew-based local setup is:

```sh
brew install node@24 pnpm rustup cargo-deny
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/rustup/bin:$PATH"
rustup show
cd app
pnpm install --frozen-lockfile
```

Do not commit global configuration or machine-specific paths. CI installs the pinned Node.js, pnpm, Rust, and cargo-deny versions afresh.

## Development and verification

From `app/`:

```sh
pnpm start
pnpm verify
pnpm verify:full
```

`verify` covers strict TypeScript, frontend tests with enforced coverage thresholds, Rust formatting, Clippy with warnings denied, and Rust tests. `verify:full` adds source-boundary, documentation, workflow/YAML, version, transitive-license, committed-SBOM, and web-build checks. `verify:ci` additionally runs production dependency advisories.

`cargo-deny` rejects vulnerable, unsound, yanked, and unmaintained Rust dependencies by default. Its configuration contains only narrowly documented unmaintained-advisory exceptions for dependencies currently inherited through Tauri; every exception must retain a reason, and an unused exception fails the gate so that it is removed when the dependency graph changes.

The SBOM is deterministic after normalization and must be refreshed whenever either lockfile changes:

```sh
pnpm sbom:generate
pnpm sbom:check
```

Repository checks also include:

```sh
git diff --check
.githooks/secret-guard.sh --self-test
```

Enable the repository hooks once per clone:

```sh
git config core.hooksPath .githooks
```

## Write and review rules

- Preserve concurrent and unrelated changes.
- Update the source-of-truth document when changing `.realmmap`, year semantics, command permissions, or release behavior.
- Use placeholders such as `example.invalid` and `REDACTED`; never record real tokens, private map data, or private locations.
- Tests create synthetic temporary `.realmmap` files. The secret guard blocks map and database files even when force-added.

## Explicit operation gates

The pre-commit hook checks staged secrets, staged whitespace, and staged version agreement. The pre-push hook scans outgoing commits and runs `verify:local:push` for branch pushes or `verify:local:release` for tag pushes. The release gate additionally builds, inspects, starts, and stages the unsigned arm64 package.

Branch push and tag creation remain distinct owner operations. An explicitly authorized release-tag push also authorizes the automated Draft Release described in [release operations](operations/release.md). Signing, notarization, and public publication remain separate operations.
