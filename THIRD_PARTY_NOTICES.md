# Third-party notices

Realm itself is licensed under [AGPL-3.0-or-later](LICENSE). This file is the starting notice for dependencies that are part of the current application stack. It is not a substitute for reviewing the exact lockfiles and license texts used in a release.

| Component | Use | License / source |
| --- | --- | --- |
| Tauri 2 | Desktop shell and IPC boundary | Apache-2.0 / MIT; <https://github.com/tauri-apps/tauri> |
| Rust | Native implementation language and toolchain | Apache-2.0 / MIT; <https://www.rust-lang.org/> |
| React | User interface | MIT; <https://github.com/facebook/react> |
| Phosphor Icons | Interface icon set | MIT; <https://github.com/phosphor-icons/react> |
| TypeScript | Strict UI typing and build tooling | Apache-2.0; <https://github.com/microsoft/TypeScript> |
| OpenLayers | Interactive map rendering | BSD-2-Clause; <https://github.com/openlayers/openlayers> |
| rusqlite | Rust SQLite binding | MIT; <https://github.com/rusqlite/rusqlite> |
| SQLite | Embedded database engine | Public domain; <https://sqlite.org/copyright.html> |

Before each release, run the license gate and regenerate [the combined CycloneDX SBOM](sbom/realm-dependencies.cdx.json) from `Cargo.lock` and the JavaScript lockfile. Attach this notice and the checked SBOM to the Draft Release. Do not claim a version or license here until it is present in the lockfiles and checked by the gate.
