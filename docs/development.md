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
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix rustup)/bin:$PATH"
rustup show
cd app
pnpm install --frozen-lockfile
```

Do not commit global configuration or machine-specific paths. Each developer is responsible for using the pinned environment locally; this repository does not use GitHub Actions.

All Rust-dependent package scripts enter through `script/with_rust_toolchain.sh`.
The resolver keeps a `cargo` already present on `PATH` as the first choice. If
Cargo is not visible, it asks the active `rustup` override (including the
repository's `rust-toolchain.toml`) for Cargo and adds that toolchain's `bin`
directory to the child process `PATH`, so Node SBOM and license checks see the
same toolchain. It changes only the current process; it never edits shell
dotfiles. If neither Cargo nor rustup can provide a complete Cargo/Rust toolchain,
the command fails before verification starts.

## Development and verification

From `app/`:

```sh
pnpm start
pnpm verify
pnpm skills:check
pnpm verify:full
```

`verify` covers strict TypeScript, frontend tests with enforced coverage thresholds, Rust formatting, Clippy with warnings denied, and Rust tests. `skills:check` validates the repository-owned Realm Skills, their routing metadata, and stale cross-project assumptions. `verify:full` adds that Skill gate plus source-boundary, documentation, transitive-license, committed-SBOM, web-build, and Node runtime resolver checks. Commit-to-commit version sequencing is checked by the pre-push hook because it requires the outgoing Git range. `verify:ci` is a reusable strict local command that additionally runs production dependency advisories; it is not connected to GitHub Actions.

The public verification scripts (`verify`, `verify:full`, `verify:ci`, and both
`verify:local:*` gates) enter through `script/with_node_runtime.sh`. If the
interactive shell currently exposes another Node version, the resolver checks
the repository's `.node-version`, then validates an explicitly supplied local
runtime, configured version-manager locations, Homebrew's discovered prefix,
and any later PATH entry. It never downloads or changes a tool installation.
Every candidate must report the exact pinned version; if none is available the
gate stops with the required version and a local setup instruction. The inner
scripts are intentionally separate so verification cannot perform its first
dependency or test command under an unpinned Node process. Run
`pnpm node:runtime:test` to exercise normal, mismatch, argument/exit-status,
and missing-runtime cases in isolation.

### Finder shortcuts

From Finder, use the executable shortcuts at the repository root:

- Double-click [`Realmをテスト起動.command`](../Realmをテスト起動.command) to start the Tauri application in development mode. It does not open a `.realmmap` automatically.
- Double-click [`Realmをビルド.command`](../Realmをビルド.command) to build and inspect the Apple Silicon `.app` and DMG without launching the packaged application.

Both shortcuts use the pinned local environment and the already-installed dependencies under `app/`; they never install tools or packages automatically. Before starting, Realm compares the committed `pnpm-lock.yaml` with pnpm's installed lock snapshot. A dependency change fails closed and asks for `pnpm install --frozen-lockfile`, while an application-version-only change does not invalidate an otherwise current installation. When the Homebrew setup above is present, the shortcuts resolve its pinned Node.js and Rust paths even if Finder did not inherit the interactive shell's `PATH`. The Terminal window waits for Return after completion so that errors remain visible. Their reusable shell entrypoints are `script/build_and_run.sh` and `script/build_macos.sh`; the Codex Run action uses the former.

Any test that requires Realm to be running must use `Realmをテスト起動.command` or its `script/build_and_run.sh` entrypoint. Do not test with a built, packaged, or installed `.app`. Package verification is static and may inspect the bundle, executable architecture, metadata, signatures, DMG, and checksums without launching it.

`cargo-deny` rejects vulnerable, unsound, yanked, and unmaintained Rust dependencies by default. Its configuration contains only narrowly documented unmaintained-advisory exceptions for dependencies currently inherited through Tauri; every exception must retain a reason, and an unused exception fails the gate so that it is removed when the dependency graph changes.

The SBOM is deterministic after normalization and must be refreshed whenever either lockfile changes:

```sh
pnpm sbom:generate
pnpm sbom:check
```

To exercise the resolver's normal-PATH, rustup-fallback, and fail-closed cases:

```sh
pnpm rust:toolchain:test
```

## Version updates

`app/package.json` is the application-version source of truth. The package version, Rust package version, Tauri bundle version, CycloneDX application version, and Git tag use `MAJOR.MINOR.PATCH`.

Every committed change advances the version. Without an explicit MAJOR direction from the owner, `feat` increments MINOR and every other approved commit type increments PATCH. A MAJOR update additionally requires `Version-Impact: major` in the commit message. A commit marked with `!` or `BREAKING CHANGE:` must not be created without that explicit MAJOR direction.

Independent objectives are separate commits, and each commit advances the version in sequence. The version update belongs in the same commit as its change; do not create a version-only commit. Calculate the next value from `app/` with:

```sh
pnpm version:next -- <current-version> <type>
```

### Commit timing

Finish the complete requested task, synchronize its source-of-truth documents, and run the required verification before creating any commit. Create the planned commit or sequence of independent commits immediately before the final result report to the owner. Intermediate progress reports do not authorize or trigger a commit.

Immediately before staging, re-read the current working tree because other work may have arrived concurrently. Stage only the files for the corresponding objective, verify the staged version artifacts, create each planned commit in order, and then report the resulting commits. If a commit cannot be created, leave the work uncommitted and report the reason instead of claiming completion.

After updating all version artifacts, regenerate the SBOM. The pre-commit hook checks the staged artifacts, while the pre-push hook verifies the subject, type, sequential version, and synchronized artifacts of every outgoing commit.

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
- Update the source-of-truth document when changing `.realmmap`, feature or cell semantics, command permissions, or release behavior.
- Use placeholders such as `example.invalid` and `REDACTED`; never record real tokens, private map data, or private locations.
- Tests create synthetic temporary `.realmmap` files. The secret guard blocks map and database files even when force-added.

## Explicit operation gates

The pre-commit hook checks staged secrets, staged whitespace, and staged version agreement. The pre-push hook scans outgoing commits and runs `verify:local:push` for branch pushes or `verify:local:release` for tag pushes. The release gate additionally builds, inspects, starts, and stages the unsigned arm64 package.

Branch push, tag creation, tag push, Draft Release creation, and public publication remain distinct owner operations. No GitHub Action performs them. Signing and notarization are also separate operations. Follow [release operations](operations/release.md).
