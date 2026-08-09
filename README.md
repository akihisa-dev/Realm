# Realm

Realm is a local, editable world-map application for macOS on Apple Silicon. It is designed for people who want to maintain a geographic world as a durable file, with deliberate historical revisions rather than a cloud account or a generated dataset.

> Status: initial 0.1 series development

## What Realm stores

Realm uses one SQLite database file with the `.realmmap` extension as the project artifact. The file contains the map's editable source data, including:

- terrain, forests, rivers, coastlines, countries, regions, boundaries, cities, and towns;
- hand-edited geometry and metadata for every feature;
- a year-based revision history, chronology events, and named eras;
- feature changes that can be inspected at any supported year.

The database is local and portable. Realm does not generate map content, import images, synchronize to a cloud service, or require a hosted account.

## Platform and stack

- macOS on Apple Silicon (arm64) only;
- Tauri 2 with Rust for the desktop boundary;
- React with strict TypeScript for the interface;
- OpenLayers for map rendering;
- SQLite through `rusqlite`, with one `.realmmap` database per map project.

The 0.1 series scope is intentionally local-first. Network access, cloud storage, generated content, and multi-platform packaging are out of scope until a separate decision is recorded in the engineering documents.

## Repository map

- `app/`: Tauri/Rust/React application code and its reproducible verification scripts.
- `docs/`: product, architecture, data, testing, and release source of truth. Start at [docs/INDEX.md](docs/INDEX.md).
- `.githooks/`: local secret and publication guards.
- `.github/`: least-privilege CI, issue templates, ownership, package verification, and Draft Release automation.
- `sbom/`: deterministic CycloneDX inventory generated from both lockfiles.
- `AGENTS.md`: rules for AI agents and other automated contributors.

## Development

Development is performed on an Apple Silicon Mac. Before choosing a command, read [docs/development.md](docs/development.md) and the scripts declared by `app/package.json`.

The normal loop is:

1. make a small local change;
2. run the documented formatter, type checks, Rust checks, and tests;
3. run the local publication gate before any push;
4. inspect the diff and keep user data, secrets, and unrelated work out of the commit.

## Governance and licensing

Realm is an owner-led open source project. Issues and pull requests may be read but are not a promise of response, review, acceptance, or merge; see [CONTRIBUTING.md](CONTRIBUTING.md). Realm is licensed under [AGPL-3.0-or-later](LICENSE).

Security reports must not contain secrets or exploit details in a public issue. Follow [SECURITY.md](SECURITY.md). Community participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Japanese

Realmは、Apple Silicon搭載macOS向けのローカル世界地図アプリです。地形、森林、河川、海岸線、国境、地域、境界、都市、町を手動で編集し、年単位のリビジョンと名前付き時代で変化を管理します。地図は単一のSQLite `.realmmap`ファイルに保存し、生成、画像取込、クラウド同期は行いません。

詳細な正本は[文書索引](docs/INDEX.md)から参照してください。Realmはowner-ledで運用し、AGPL-3.0-or-laterで公開します。
