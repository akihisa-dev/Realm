# Development

## Start here

1. Work on Apple Silicon macOS 14 or later.
2. Read [AGENTS.md](../AGENTS.md), [docs/INDEX.md](INDEX.md), and the source-of-truth document related to the change.
3. Keep test databases in temporary directories. Never point a test at a personal `.realmmap`.
4. Inspect `git status --short`, the lockfiles, and current target files before writing.

## Pinned environment

Realm requires the exact Node.js version in `.node-version` and the exact Node.js and pnpm versions in `app/package.json`. The runtime gate rejects another OS, architecture, or pinned tool version. Node.js 24 supplies the main-process `node:sqlite` API used for local persistence.

A Homebrew-based local setup is:

```sh
brew install node@24 pnpm
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
cd app
pnpm install --frozen-lockfile
```

Do not commit global configuration or machine-specific paths. Each developer is responsible for using the pinned environment locally; this repository does not use GitHub Actions.

Electron Forge owns the development and packaging lifecycle. Vite builds the
main process, preload bridge, and renderer as separate targets. The main process
uses Node's built-in `node:sqlite`; no additional native toolchain or hosted
service is required. The runtime resolver changes only the current process and never edits
shell dotfiles.

## Development and verification

From `app/`:

```sh
pnpm start
pnpm verify
pnpm skills:check
pnpm verify:full
```

`verify` covers strict TypeScript and the automated test suite. `skills:check`
validates the repository-owned Realm Skills, their routing metadata, and stale
cross-project assumptions. `verify:full` adds that Skill gate plus source-boundary,
documentation, transitive-license, committed-SBOM, renderer production-build,
package-content, and Node runtime checks. `verify:ci` is a reusable strict local
command that additionally runs production dependency advisories; it is not
connected to GitHub Actions.

The standard `verify` command also runs the secret-guard regression matrix, so
staged, commit-range, new-ref, file-type-change, merge-resolution, and safe
deletion behavior is checked during development rather than only immediately
before a push.

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

- Double-click [`Realmをテスト起動.command`](../Realmをテスト起動.command) to start the Electron application in development mode. It does not open a `.realmmap` automatically.
- Double-click [`Realmをビルド.command`](../Realmをビルド.command) to build and inspect the Apple Silicon `.app` and DMG without launching the packaged application.

Both shortcuts use the pinned local environment and the already-installed dependencies under `app/`; they never install tools or packages automatically. Before starting, Realm compares the committed `pnpm-lock.yaml` with pnpm's installed lock snapshot. A dependency change fails closed and asks for `pnpm install --frozen-lockfile`, while an application-version-only change does not invalidate an otherwise current installation. When the Homebrew setup above is present, the shortcuts resolve its pinned Node.js path even if Finder did not inherit the interactive shell's `PATH`. The development launcher uses a repository-specific directory under the system temporary area for Electron `userData`; it rejects symlinks, another owner, non-directories, and permissions other than `0700`. Development worlds therefore never share the packaged application's user-data directory. The test launcher exits automatically after Realm finishes, preserving its diagnostic message and exit code. Their reusable shell entrypoints are `script/build_and_run.sh` and `script/build_macos.sh`; the Codex Run action uses the former.

Any test that requires Realm to be running must use `Realmをテスト起動.command` or its `script/build_and_run.sh` entrypoint. Do not test with a built, packaged, or installed `.app`. Package verification is static and may inspect the bundle, executable architecture, metadata, signatures, DMG, and checksums without launching it.

With explicit permission to launch the development application, `pnpm smoke:electron`
starts Electron with a fresh temporary `userData` directory, authenticates a fixed
preload readiness channel, verifies the main window, renderer, preload API, and empty
library, writes a JSON report, and exits. `pnpm smoke:package` is intentionally static
in normal and release gates: it records executable and platform evidence without
launching the packaged app.

The dependency and license checks inspect the pnpm lockfile and packaged
Electron/Vite graph. They fail closed on stale package artifacts, missing
licenses, unexpected package contents, or a stale SBOM.

The SBOM is deterministic after normalization and must be refreshed whenever either lockfile changes:

```sh
pnpm sbom:generate
pnpm sbom:check
```

To exercise the resolver's normal-PATH, mismatch, and fail-closed cases:

```sh
pnpm node:runtime:test
```

## Version updates

`app/package.json` is the application-version source of truth. The Electron Forge
package metadata, CycloneDX application version, and Git tag use
`MAJOR.MINOR.PATCH`.

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

The secret-guard self-test exercises staged content and both existing-branch
and new-branch push ranges. It must cover additions, modifications, renames or
copies as destination additions, file-type changes, and merge resolutions.
Deletions are intentionally excluded from blob reads because the deleted path
does not exist in the resulting tree; the commit that originally introduced
the content remains part of the outgoing range and is checked separately.

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

The pre-commit hook checks staged secrets, staged whitespace, and staged version agreement. The pre-push hook scans outgoing commits and runs `verify:local:push` for branch pushes or `verify:local:release` for tag pushes. The release gate additionally builds, inspects, and stages the unsigned arm64 package; it never launches the packaged app.

Branch push, tag creation, tag push, Draft Release creation, and public publication remain distinct owner operations. No GitHub Action performs them. Signing and notarization are also separate operations. Follow [release operations](operations/release.md).
