# Technical stack

The 0.1 series stack is intentionally narrow and local:

| Layer | Choice | Constraint |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Native boundary is Rust; no hosted service. |
| Native code | Rust | Owns filesystem, SQLite connection, migrations, and commands. |
| UI | React + strict TypeScript | No `any` escape in new code without a documented boundary. |
| Map | OpenLayers | Rendering and interaction use local feature data only. |
| Storage | SQLite via `rusqlite` | One `.realmmap` database per map project. |
| Platform | macOS arm64 | Intel and other operating systems are out of the 0.1 series scope. |

Dependency versions are defined by `app/package.json`, JavaScript lockfiles, and `Cargo.lock` when those files exist. This document does not invent versions. Release notices must be regenerated from the actual lockfiles; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Selection constraints

- UI-to-native commands accept typed, validated data and return typed errors.
- SQLite migrations are forward-only and tested against a temporary database.
- No dependency may introduce telemetry, cloud sync, or a network requirement without an explicit architecture decision.
