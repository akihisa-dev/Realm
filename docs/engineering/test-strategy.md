# テスト戦略

テストは、実ユーザーの地図やネットワークを必要とせずに挙動を証明しなければなりません。
一時ディレクトリと、合成したメモリ内または一時SQLiteデータベースを使います。
既存のユーザー`.realmmap`ファイルは決して使いません。

| 層 | 主な証拠 |
| --- | --- |
| 純粋なドメインとモデル | 世界名と設定の検証、レイヤーとオブジェクト種類の検証、種類ごとのオブジェクトジオメトリ、範囲を限定したプロパティ、安定した識別子、グリッドポリゴン変換、同一レイヤーの重複拒否、レイヤーをまたぐ重複の許可 |
| SQLite統合 | schema 13の作成、layer treeと`terrain_shapes` / `regions` / `region_shapes` / `objects`の分離した書き込みと往復、共通ProjectStore row codecによるsnapshot・履歴capture/restore、leaf所属・親visibility/lock・cycle/order検証、オブジェクト種類とz順、レイヤー置き換えトランザクション、アセット参照、undo/redo、再オープン、現在schemaの不正データ拒否、ソースを変更しないschema 1から12の拒否、将来または廃止済みschemaの拒否、同一inodeの外部更新をmutation直前に拒否する競合回帰、Nodeの`node:sqlite`によるライブラリ再オープン |
| Electron IPC境界 | アプリデータライブラリの隔離、UUIDとパスの制限、読み取り専用の転送事前検査、アトミック出力、成果物のサイズと拡張子の制限、型付きエラー、sender/origin allow-list、レイヤー固有の置き換えチャンネル、rendererロード前のIPC登録、認証済みsmoke readiness |
| React/UI | 右パネルの階層レイヤー、選択中の末端レイヤー、親から継承する表示・ロック、固定された「描く・消す・掴む」レール、描く種類と方法の設定、領域を地形へ合わせる右パネル操作、選択レイヤーに応じた編集対象、共通の地図移動と拡大縮小、読み取り専用プレビュー、楽観的保存と失敗回復、undo/redo状態 |
| OpenLayers adapter | 階層順と種類別の描画、親から継承する表示・ロック、選択レイヤーだけのヒットテスト、レイヤー切り替え時のキャンセル、地形・領域双方のグリッド／範囲操作、オブジェクトの配置・移動・消去、プレビューナビゲーション、Escape/pointercancel/blur/キャプチャ喪失のキャンセル、ホイール拡大縮小、中・右ボタンとSpaceによる地図移動、右クリックメニュー抑止、範囲を限定した出力、listenerの後片付け、べき等な破棄 |
| 境界引っ張り操作 | 頂点、辺、内部の優先順位を持つ正確な正規Polygonヒットテスト、pointermoveでIPCを呼ばない範囲を限定したプレビュー、pointerupで1回だけ行う正規化済みコミット、レイヤー固有の形状挙動、キャンセル、重複拒否 |
| リポジトリ | Markdownリンク、`git diff --check`、stage/add/modify/type-change/merge-resolutionと既存および新規refの範囲を対象にしたsecret guard行列、安全な削除の検査、アーキテクチャ検査、コミットごとのversion方針 |
| Electronランタイムsmoke | 明示的に許可した開発版起動、空の一時`userData`、main window作成、rendererロード、preload API、空ライブラリのJSON証拠、自動終了 |
| macOSパッケージ | リリース専用の静的arm64 bundle、metadata、DMG、checksum、パッケージsmokeの非起動検査。テストで配布パッケージを起動しない |

ローカルpushの前には、strict TypeScript、NodeとrendererのVitestプロジェクト、全Vitestスイート、アーキテクチャ検査、文書検査、現在のapp packageに定義されたスクリプトを実行し、その後にリポジトリguardを実行します。
リリースタグの前には、app packageに記載された正確なローカルリリースコマンドでElectron Forgeのarm64パッケージをbuildし、静的に検査します。

Realmの起動を必要とするテストは、別の名前を付け、今回の作業で明示的に許可されている場合だけ、`Realmをテスト起動.command`または`script/build_and_run.sh`を通じて実行します。
build済み、package済み、インストール済みの`.app`はテストに使いません。
GUIテストを通常の単体テストコマンドへ暗黙に含めてはいけません。
