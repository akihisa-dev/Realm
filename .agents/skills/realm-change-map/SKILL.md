---
name: realm-change-map
description: Realmの平面世界地図について、terrain・forest・river・coastline・country・region・boundary・city・townの手動作成・編集・削除、OpenLayers描画、選択、pan・zoom、レイヤー、GeoJSON境界を追加・修正する。地物編集や地図表示の変更に使い、保存IPCはrealm-change-storage、一般UIはrealm-change-uiを併用する。
---

# Realm Map Change

1. project overview、data model、designと対象実装を読む。
2. EPSG:4326の平面世界、extent、zoom境界を保ち、外部tileやnetworkを追加しない。
3. 描画状態と永続地物を分け、OpenLayers objectをReactやSQLiteの正本にしない。
4. 9種の地物を生成せず手動操作だけで作る。未実装操作を動作するUIとして見せない。
5. geometryはRust command境界でclassとGeoJSON構造を検証する。
6. 地物変更を現在状態へtransactionalに反映し、session undo・redo用の前後状態を保つ。
7. pointer中断、選択解除、pan・zoom、空状態、境界値をtestする。
8. TypeScript、Vitest、Rust境界test、architecture、docsを確認する。
