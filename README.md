# Realm

Realm is a local three-layer map editor for macOS on Apple Silicon. It keeps each world's current terrain, regions, and objects in an app-managed library rather than a cloud account or a generated dataset.

> Status: initial 0.1 series development

## What Realm stores

Realm uses one SQLite database per world inside its app-managed library. Each database contains the map's editable source data, including:

- manually painted terrain polygons on a fixed hexagonal grid;
- independent region polygons and their colors;
- objects such as cities, text, forests, and mountains placed above the terrain and regions;
- project-local canvas, palette, grid, and export settings;

The database remains local. Layer edits are automatically saved without asking the user to manage a project file. The current interface has no startup or transfer-import screen. Realm does not generate geography, synchronize to a cloud service, or require a hosted account. Older `.realmmap` formats are rejected without automatic migration.

## Platform and stack

- macOS on Apple Silicon (arm64) only;
- Electron with a typed main/preload IPC boundary;
- React with strict TypeScript for the interface;
- OpenLayers for map rendering;
- SQLite through Node's built-in `node:sqlite` API, with one app-managed database per world.

The 0.1 series scope is intentionally local-first. Network access, cloud storage, generated content, and multi-platform packaging are out of scope until a separate decision is recorded in the engineering documents.

## Repository map

- `app/`: Electron main/preload/React application code, Node SQLite storage, and reproducible verification scripts.
- `docs/`: product, architecture, data, testing, and release source of truth. Start at [docs/INDEX.md](docs/INDEX.md).
- `.githooks/`: local secret and publication guards.
- `.agents/skills/`: repository-owned Codex workflows localized for Realm.
- `.github/`: issue templates, ownership rules, pull-request guidance, and the manual Release checklist. Realm does not use GitHub Actions.
- `sbom/`: deterministic CycloneDX inventory generated from the pnpm lockfile and bundled native storage helpers.
- `AGENTS.md`: rules for AI agents and other automated contributors.

## Development

Development is performed on an Apple Silicon Mac. Before choosing a command, read [docs/development.md](docs/development.md) and the scripts declared by `app/package.json`.

The normal loop is:

1. make a small local change;
2. run the documented TypeScript, Node, renderer, storage, and test checks;
3. run the local publication gate before any push;
4. inspect the diff and keep user data, secrets, and unrelated work out of the commit.

## Governance and licensing

Realm is an owner-led open source project. Issues and pull requests may be read but are not a promise of response, review, acceptance, or merge; see [CONTRIBUTING.md](CONTRIBUTING.md). Realm is licensed under [AGPL-3.0-or-later](LICENSE).

Security reports must not contain secrets or exploit details in a public issue. Follow [SECURITY.md](SECURITY.md). Community participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Japanese

Realmは、Apple Silicon搭載macOS向けのローカル3層地図エディタです。地形、領域、地形や領域の上に置く都市・テキスト・森・山を別々に編集し、アプリ内ライブラリへ自動保存します。地理の自動生成、クラウド同期、旧形式からの自動移行は行いません。

詳細な正本は[文書索引](docs/INDEX.md)から参照してください。Realmはowner-ledで運用し、AGPL-3.0-or-laterで公開します。
