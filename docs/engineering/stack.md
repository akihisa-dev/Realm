# Technical stack

The 0.1 series stack is intentionally narrow and local:

| Layer | Choice | Constraint |
| --- | --- | --- |
| Desktop shell | Electron 43 + Electron Forge | Main/preload IPC boundary; no hosted service. |
| Native code | Node.js 24 main process | Owns filesystem, Node `node:sqlite` connections, migrations, and commands. |
| UI | React + strict TypeScript | No `any` escape in new code without a documented boundary. |
| Map | OpenLayers | Rendering and interaction use local feature data only. |
| Storage | SQLite via Node `node:sqlite` | One `.realmmap` database per map project. |
| Platform | macOS arm64 | Intel and other operating systems are out of the 0.1 series scope. |

Dependency versions are defined by `app/package.json` and `app/pnpm-lock.yaml`. This document does not invent versions. Release notices and the CycloneDX SBOM must be regenerated from the actual lockfile; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Selection constraints

- UI-to-native commands accept typed, validated data and return typed errors.
- SQLite migrations are forward-only and tested against a temporary database.
- No dependency may introduce telemetry, cloud sync, or a network requirement without an explicit architecture decision.
