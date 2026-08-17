# 技術構成

0.1系の技術構成は、意図的に狭く、ローカルに限定します。

| 層 | 採用 | 制約 |
| --- | --- | --- |
| デスクトップシェル | Electron 43 + Electron Forge | main/preloadのIPC境界を使い、ホスト型サービスは使わない |
| ネイティブコード | Node.js 24のmain process | ファイルシステム、Nodeの`node:sqlite`接続、migration、コマンドを所有する |
| UI | React + strict TypeScript | 文書化した境界なしに、新しいコードで`any`へ逃げない |
| 地図 | OpenLayers | 描画と操作はローカルのfeatureデータだけを使う |
| 保存 | Nodeの`node:sqlite`を通じたSQLite | 地図プロジェクトごとに`.realmmap`データベースを1つ持つ |
| プラットフォーム | macOS arm64 | Intelとその他のOSは0.1系の対象外 |

依存関係のversionは`app/package.json`と`app/pnpm-lock.yaml`で定義します。
この文書でversionを推測しません。
リリース通知とCycloneDX SBOMは実際のロックファイルから再生成します。
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)を参照してください。

## 選定時の制約

- UIからnativeへのコマンドは、型付きで検証済みのデータを受け取り、型付きエラーを返す
- SQLite migrationは前方にだけ進み、一時データベースに対してテストする
- 明示的なアーキテクチャ判断なしに、テレメトリ、クラウド同期、ネットワーク依存を持ち込む依存関係を追加しない
