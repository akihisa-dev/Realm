# 第三者提供物に関する通知

Realm本体は[AGPL-3.0-or-later](LICENSE)で公開しています。
このファイルは、現在のアプリケーション構成に含まれる依存関係を確認するための入口です。
リリースで使う正確なロックファイルとライセンス本文の確認に代わるものではありません。

| コンポーネント | 用途 | ライセンスまたは出典 |
| --- | --- | --- |
| Electron | デスクトップシェルとmain/preloadのIPC境界 | MIT; <https://www.electronjs.org/> |
| Electron Forge | macOS向けのパッケージ作成とmaker | MIT; <https://www.electronforge.io/> |
| Vite | main、preload、rendererのbuildツール | MIT; <https://vite.dev/> |
| React | ユーザーインターフェース | MIT; <https://github.com/facebook/react> |
| Phosphor Icons | インターフェース用アイコンセット | MIT; <https://github.com/phosphor-icons/react> |
| TypeScript | UIのstrictな型付けとbuildツール | Apache-2.0; <https://github.com/microsoft/TypeScript> |
| OpenLayers | インタラクティブな地図描画 | BSD-2-Clause; <https://github.com/openlayers/openlayers> |
| Node.js `node:sqlite` | main processが使う組み込みデータベースAPI | MIT; <https://nodejs.org/> |
| SQLite | Node.jsが公開する組み込みデータベースエンジン | Public domain; <https://sqlite.org/copyright.html> |
| SQLite host extension | HAS_MOVED検証とhost online-backup拡張を同梱するもの | Public domainのSQLiteコード。`app/native/vendor/SQLITE_LICENSE.txt`を参照 |
| Realm atomic publication helper | macOS arm64向けの置き換えなし保存ヘルパー | Realm source; AGPL-3.0-or-later |

各リリースの前にライセンスゲートを実行し、pnpmロックファイルから[CycloneDX SBOM](sbom/realm-dependencies.cdx.json)を再生成してください。
SBOMには本番依存関係、Electronランタイム、Electron ForgeとViteのビルド依存関係が含まれます。
この通知と検査済みのSBOMをDraft Releaseへ添付してください。
ロックファイルに存在し、ゲートで確認されるまで、ここでversionやライセンスを断定してはいけません。
