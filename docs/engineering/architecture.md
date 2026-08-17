# アーキテクチャ

## 階層treeとrenderer

右パネルの階層レイヤーが`selectedLayerId`を決め、左レールは常に「描く」「消す」「掴む」と新規作成だけを表示します。描く設定でグリッド・範囲を選び、領域を地形へ合わせる操作は選択領域の右パネル操作です。編集状態は`selectedLayerId`、`activeTool(draw|erase|grab)`、`activeKind(terrain|region|city|text|mountain|forest)`、`drawMethod`へ分離します。オブジェクトの「掴む」は、選択と移動に対応する独立した操作です。

rendererはflattenされたtreeを使って表示順・visibility・lock・active leaf filteringを決めます。OpenLayersのsourceやfeatureはこの投影であり、SQLite snapshotが正本です。pointercancel、layer switch、hidden/locked nodeでは進行中のgestureを破棄します。

## 境界

Electronのrendererは表示と操作を担当します。
Electronのmain processは、ファイルシステムのパス、SQLite接続、schema検証、書き込みを一元的に管理します。
Reactがデータベースを開いたり、任意のパスへ直接アクセスしたりすることはありません。

```text
React / OpenLayers
        │ 型付きpreload IPC
        ▼
Electron main境界 ── 検証 ── 現在状態サービス
        │                         │
        ▼                         ▼
 アプリライブラリ / 出力      node:sqlite接続
                                    │
                                    ▼
                      世界ごとに1つの内部SQLiteファイル
```

## 状態の所有者

- Electronのmain processは、アプリデータのライブラリパス、開いた`node:sqlite`データベース、SQLiteトランザクション、schema状態、地形、領域、オブジェクト、アセット、世界の安定した識別子、保存済みレイヤーの現在内容、範囲を限定したプロジェクト設定、セッション中のundo/redoスタックを所有します。
- Reactは、selectedLayerId、activeTool、activeKind、drawMethod、一時的な六角形セル選択、オブジェクトの下書きラベル、viewport、プレビュー状態、共有描画範囲、tree状態、選択中のオブジェクトと領域、直列化した変更状態を所有します。main processによる置き換えが完了するまで、楽観的な下書きを保持します。
- OpenLayersが持つのは、階層と種類別の保存内容から導出した描画・操作用オブジェクトと、一時的なグリッド選択だけです。保存データの正本にはなりません。

## 階層エディタ

右側の`LayerManager`には、groupとleafからなる階層treeがあります。leafを選択すると`selectedLayerId`を設定します。
選択したレイヤーだけが、主ポインターによる作成、選択、移動、削除、形状編集を受け付けます。
他のレイヤーは表示しますが、描画された形状を選択したり編集したりできません。
leafを切り替えると、次のleafを有効にする前に、進行中のポインター操作、選択、プレビューをキャンセルします。

左ツールレールには、常に「描く」「消す」「掴む」を同じ順序で表示します。`terrain`・`region`のgrid/areaは描く設定から選び、regionのシェイピングは選択regionの右パネル操作で行います。objectの種類は`activeKind`で選びます。
「グリッド描画」と「範囲描画」はactive layerに応じて同じセル選択結果を地形または領域へ振り分け、「消す」はレイヤー固有の削除へ振り分けます。「掴む」は地形・領域では形状操作、オブジェクトでは選択と移動へ振り分けます。
領域を地形へ合わせる操作は、選択した論理領域から地形のない部分だけを削ります。描く内容の種類、領域の色と対象、オブジェクトの種類（`city`、`text`、`mountain`、`forest`）とラベルは右パネルで選びます。

消しゴムが別のレイヤーの対象を選ぶことはありません。
ラベルとハンドラーは`selectedLayerId`と`activeKind`から決まります。
中ボタン、右ボタン、Space、ホイールによるナビゲーションは、すべてのレイヤーで使えます。
表示プレビュー中はadapterを読み取り専用のナビゲーションへ切り替え、すべてのレイヤー変更操作を無効にします。

## rendererの境界

OpenLayersのimportは`app/src/map/`以下に隔離します。
`contracts.ts`はUI向けrenderer契約です。
`MapAdapter.ts`は、地図、操作状態、active layerのゲート、主ポインターのライフサイクル、パンとズーム、キャンセルを所有します。
`mapLayerRegistry.ts`は、地形、領域、オブジェクトに分けたsourceとlayer、スタイル、グリッドの置き換え、プレビュー表示、描画リソースの後片付けを所有します。

正規描画では階層の並びを適用し、各レイヤー内では保存内容を次の順に投影します。

```text
terrain  →  region  →  object
```

地形と領域の編集には、グリッドに吸着した正確なPolygonジオメトリを使います。
表示プレビューだけでは、renderer内で輪郭を滑らかにしたジオメトリを使います。
オブジェクトはジオメトリ、種類、ラベル、プロパティ、ロック状態、`z_index`を使って描画し、オブジェクト同士の重なりを許可します。
一時的なセルポリゴンとセルIDは、ペイント、消去、ヒットテスト、プレビューだけに使います。
これらは破棄し、SQLiteにもundo履歴にも入りません。

完了したグリッド描画または範囲描画のジェスチャーは、範囲を限定したセル選択としてrendererの境界を越え、地形または領域の正規化済みポリゴン変更へ変換されます。
rendererがSQLiteへ書き込むことはありません。
main processのコマンドは対象レイヤー全体を検証し、同じレイヤー内のポリゴン重複を拒否し、1つのトランザクションで置き換え、1つの履歴チェックポイントを作成します。
オブジェクトの配置、移動、削除、ロック変更も、同じトランザクション境界でオブジェクトレイヤー全体を置き換えます。

pointercancel、Escape、blur、ポインターキャプチャ喪失、レイヤー切り替えはキャンセル境界です。
レイヤーを切り替えると、制御中の選択も消去し、新しい操作を設定する前にadapterをパンへ戻します。
中ボタンまたは右ボタンのパンとSpaceによるパンは、active layerを変えずに現在の主ポインター操作を一時停止します。

## main、preload、メモリbackend

Electronでは、`app/src/main/main.ts`をプロセスの構成ルート、`app/src/main/ipc/registerIpcHandlers.ts`をIPCレジストリとして維持します。
型付きpreloadは、階層と内容を更新する次のコマンドを公開します。

- `realm:replaceTerrainLayer`
- `realm:replaceRegionLayer`
- `realm:replaceObjectLayer`
- `realm:replaceLayerTree`
- `realm:replaceMapContent`

rendererはこれらのコマンドを`RealmBackend`経由で使います。
階層変更は`replaceLayerTree`、複数種類にまたがる編集は`replaceMapContent`を1回のトランザクションとundo単位として扱います。
ブラウザー専用のメモリbackendは、2つ目の保存形式にはならず、決定的なUIテストのために同じレイヤー契約を実装します。
`MapShape[]`はメモリ上のエディタ投影であり、IPC APIでも保存APIでもありません。

main process内では、`layerCommands.ts`が地形と領域の置き換えを検証し、`objectCommands.ts`がオブジェクトの種類、ジオメトリ、プロパティ、ロック、順序、アセットを検証します。
`snapshot.ts`は分割されたモデルを読み取り、`operations.ts`はundo/redoのためにすべての永続テーブルを取得または復元します。
保存schemaの検証とパスおよびアトミック公開のコードは、コマンド境界より下に残します。

## 安全な不変条件

- アプリデータのディレクトリはElectronのmain processで解決し、ライブラリの項目は検証済みUUIDで指定し、ユーザーが選んだインポートと出力のパスを検証します。ユーザー入力をSQLやファイルシステムのパスへ連結してはいけません
- 現在状態の書き込みにはパラメーター化クエリとトランザクションを使います。検証または保存トリガーに失敗した場合、すべてのレイヤーを変更前のままにします
- schemaと初期世界データは1つのSQLiteトランザクションで作成します。schemaはversion 13で、階層、地形、領域、オブジェクト、アセットを別のテーブルに持ちます
- 既存ファイルは、書き込み可能な接続を開く前に読み取り専用接続で検査します。version 13未満、将来のversion、廃止済みテーブル、不正なジオメトリ、不一致のschemaメタデータ、不完全なファイル、整合性検査の失敗では、ソースバイトとjournal modeを変更しません
- データベースの内容やテレメトリをネットワークへ送信してはいけません。アセットとプロジェクトデータはローカルに留めます
- PNG、JPEG、PDFの出力は現在のrendererから導出し、main processの書き込み境界で範囲を限定します。編集可能なプロジェクト保存データにはしません

## 判断記録

レイヤーの識別、オブジェクト種類、地形の意味、保存構造、IPC権限を変更する場合は、[data-model.md](data-model.md)とこの文書を更新し、回帰テストも追加します。
これらの不変条件が変わらないUIだけの変更は、コードとテストの更新だけで完結できます。
