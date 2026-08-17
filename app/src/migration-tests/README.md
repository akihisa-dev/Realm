# Electron保存処理の特性確認

このディレクトリでは、Electronの保存処理とrendererが満たすべき観測可能な契約を固定します。
`migrationInventory.ts`は過去のテスト参照を証拠として保持し、現在の実装はschema 12のSQLiteテストとrendererテストで特性を確認します。
`migrationSnapshot.ts`は、合成したschema 12のgolden snapshotを決定的に比較します。
SQLiteの行順とJSONオブジェクトのキー順は結果に影響しません。
レイヤー比較が成功してもソースの変更を見落とさないよう、ソースハッシュとsidecarの同一性は別に比較します。

基準データは意図的に合成したもので、ユーザーの`.realmmap`データを含みません。
RealmやGUIを起動せずに次を実行します。

```sh
cd app
pnpm test -- migration-tests
pnpm test
```

このディレクトリの保存テストは独自の一時データベースを作成し、現在の`terrain`、`regions`、`objects`のsnapshotを合成goldenと比較します。
インポートまたは拒否の後には`compareSourceIdentity`も検証します。
GUIの起動はこのゲートに含めません。
rendererの挙動は、inventoryに記載された既存のjsdom/OpenLayers単体テストで確認します。

## Vitestのプロジェクト分割

Electronのmain processはNode環境で動作し、React/OpenLayersのテストはjsdomに残します。
Vitestのプロジェクト分割により、`src/main/**/*.test.ts`とこのディレクトリのファイルシステムおよびSQLiteの特性確認テストは`node`プロジェクトに置きます。
`src/main/**`を除く`src/**/*.test.{ts,tsx}`は`renderer`プロジェクトに置きます。
これにより、rendererテストが誤ってネイティブパスを開くことや、main processテストが偽のDOMを受け取ることを防ぎます。
