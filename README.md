# Realm

Realm is a local terrain-drawing application for macOS on Apple Silicon. It keeps the current editable terrain of each world in an app-managed library rather than a cloud account or a generated dataset.

> Status: initial 0.1 series development

## What Realm stores

Realm uses one SQLite database per world inside its app-managed library. Each database contains the terrain map's editable source data, including:

- manually drawn terrain polygons and their bounded display metadata;
- project-local canvas, palette, grid, and export settings;
- compatibility rows from older Realm versions, which are preserved but are not shown or edited by the terrain-only editor.

The database remains local. Normal terrain editing is automatically saved without asking the user to manage a project file. A terrain map can be exported as PNG, JPEG, or PDF, while a dedicated `.realmmap` transfer export carries editable data to another Mac. Realm does not generate geography, create settlements or political objects, synchronize to a cloud service, or require a hosted account.

## Platform and stack

- macOS on Apple Silicon (arm64) only;
- Tauri 2 with Rust for the desktop boundary;
- React with strict TypeScript for the interface;
- OpenLayers for map rendering;
- SQLite through `rusqlite`, with one app-managed database per world.

The 0.1 series scope is intentionally local-first. Network access, cloud storage, generated content, and multi-platform packaging are out of scope until a separate decision is recorded in the engineering documents.

## Repository map

- `app/`: Tauri/Rust/React application code and its reproducible verification scripts.
- `docs/`: product, architecture, data, testing, and release source of truth. Start at [docs/INDEX.md](docs/INDEX.md).
- `.githooks/`: local secret and publication guards.
- `.agents/skills/`: repository-owned Codex workflows localized for Realm.
- `.github/`: issue templates, ownership rules, pull-request guidance, and the manual Release checklist. Realm does not use GitHub Actions.
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

Realmは、Apple Silicon搭載macOS向けのローカル地形描画アプリです。扱う編集対象は手動で描く地形ポリゴンだけです。地形はアプリ内ライブラリへ自動保存し、成果物はPNG・JPEG・PDF、別Macへの移行は専用`.realmmap`データとして書き出します。森林、水系、道路、政治領域、集落、記号、ラベル、地理の自動生成、クラウド同期は編集機能として提供しません。

詳細な正本は[文書索引](docs/INDEX.md)から参照してください。Realmはowner-ledで運用し、AGPL-3.0-or-laterで公開します。
