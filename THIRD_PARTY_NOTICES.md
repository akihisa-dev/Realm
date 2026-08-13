# Third-party notices

Realm itself is licensed under [AGPL-3.0-or-later](LICENSE). This file is the starting notice for dependencies that are part of the current application stack. It is not a substitute for reviewing the exact lockfiles and license texts used in a release.

| Component | Use | License / source |
| --- | --- | --- |
| Electron | Desktop shell and main/preload IPC boundary | MIT; <https://www.electronjs.org/> |
| Electron Forge | macOS packaging and makers | MIT; <https://www.electronforge.io/> |
| Vite | Main, preload, and renderer build tooling | MIT; <https://vite.dev/> |
| React | User interface | MIT; <https://github.com/facebook/react> |
| Phosphor Icons | Interface icon set | MIT; <https://github.com/phosphor-icons/react> |
| TypeScript | Strict UI typing and build tooling | Apache-2.0; <https://github.com/microsoft/TypeScript> |
| OpenLayers | Interactive map rendering | BSD-2-Clause; <https://github.com/openlayers/openlayers> |
| Node.js `node:sqlite` | Embedded database API used by the main process | MIT; <https://nodejs.org/> |
| SQLite | Embedded database engine exposed by Node.js | Public domain; <https://sqlite.org/copyright.html> |
| SQLite host extension | Bundled HAS_MOVED verification and host online-backup extension | Public domain SQLite code; see `app/native/vendor/SQLITE_LICENSE.txt` |
| Realm atomic publication helper | Bundled macOS arm64 no-replace storage helper | Realm source; AGPL-3.0-or-later |

Before each release, run the license gate and regenerate [the CycloneDX SBOM](sbom/realm-dependencies.cdx.json) from the pnpm lockfile. The SBOM includes the production graph, Electron runtime, and Electron Forge/Vite build dependencies. Attach this notice and the checked SBOM to the Draft Release. Do not claim a version or license here until it is present in the lockfile and checked by the gate.
