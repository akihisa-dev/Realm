# テスト戦略

テストは、実ユーザーの地図やネットワークを必要とせずに挙動を証明しなければなりません。
一時ディレクトリと、合成したメモリ内または一時SQLiteデータベースを使います。
既存のユーザー`.realmmap`ファイルは決して使いません。

| 層 | 主な証拠 |
| --- | --- |
| 純粋なドメインとモデル | 世界名と設定の検証、レイヤーとオブジェクト種類の検証、種類ごとのオブジェクトジオメトリ、範囲を限定したプロパティ、安定した識別子、グリッドポリゴン変換、同一レイヤーの重複拒否、レイヤーをまたぐ重複の許可 |
| SQLite統合 | schema 12の作成、`terrain_shapes` / `regions` / `region_shapes` / `objects`の分離した書き込みと往復、オブジェクト種類とz順、レイヤー置き換えトランザクション、アセット参照、undo/redo、再オープン、現在schemaの不正データ拒否、ソースを変更しないschema 1から11の拒否、将来または廃止済みschemaの拒否、Nodeの`node:sqlite`によるライブラリ再オープン |
| Electron IPC境界 | アプリデータライブラリの隔離、UUIDとパスの制限、読み取り専用の転送事前検査、アトミック出力、成果物のサイズと拡張子の制限、型付きエラー、sender/origin allow-list、レイヤー固有の置き換えチャンネル、rendererロード前のIPC登録、認証済みsmoke readiness |
| React/UI | 右パネルの3タブ、active layer状態、非active layerの編集ロック、レイヤー固有の挙動を持つ共通の描画入口、レイヤー固有のサイドバー操作とactive layerに応じた消しゴム対象、共有パンとズーム、読み取り専用プレビュー状態、オブジェクト種類・ラベル・配置操作、オブジェクト一覧の選択と削除、領域管理、ロック済みオブジェクト操作、楽観的保存と失敗回復、古い要求の拒否、undo/redo状態 |
| OpenLayers adapter | 地形、領域、オブジェクトのsourceとz順の分離、正規ポリゴン描画、オブジェクトの点とポリゴン描画、active layerのヒットテストゲート、非active layerの選択拒否、レイヤー切り替え時のキャンセル、地形と領域のセルジェスチャー、オブジェクトの配置・移動・消去、プレビューナビゲーション、Escape/pointercancel/blur/キャプチャ喪失のキャンセル、ホイールズーム、中ボタンと右ボタンのパン、Spaceによるパン、右クリックメニュー抑止、範囲を限定した出力、listenerの後片付け、べき等な破棄 |
| 境界引っ張り操作 | 頂点、辺、内部の優先順位を持つ正確な正規Polygonヒットテスト、pointermoveでIPCを呼ばない範囲を限定したプレビュー、pointerupで1回だけ行う正規化済みコミット、レイヤー固有の形状挙動、キャンセル、重複拒否 |
| リポジトリ | Markdownリンク、`git diff --check`、stage/add/modify/type-change/merge-resolutionと既存および新規refの範囲を対象にしたsecret guard行列、安全な削除の検査、アーキテクチャ検査、コミットごとのversion方針 |
| Electronランタイムsmoke | 明示的に許可した開発版起動、空の一時`userData`、main window作成、rendererロード、preload API、空ライブラリのJSON証拠、自動終了 |
| macOSパッケージ | リリース専用の静的arm64 bundle、metadata、DMG、checksum、パッケージsmokeの非起動検査。テストで配布パッケージを起動しない |

ローカルpushの前には、strict TypeScript、NodeとrendererのVitestプロジェクト、全Vitestスイート、アーキテクチャ検査、文書検査、現在のapp packageに定義されたスクリプトを実行し、その後にリポジトリguardを実行します。
リリースタグの前には、app packageに記載された正確なローカルリリースコマンドでElectron Forgeのarm64パッケージをbuildし、静的に検査します。

Realmの起動を必要とするテストは、別の名前を付け、今回の作業で明示的に許可されている場合だけ、`Realmをテスト起動.command`または`script/build_and_run.sh`を通じて実行します。
build済み、package済み、インストール済みの`.app`はテストに使いません。
GUIテストを通常の単体テストコマンドへ暗黙に含めてはいけません。
