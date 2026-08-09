---
name: realm-change-history
description: Realmの表示年、年表、名前付き時代、地物revision、同一年sequence、削除revision、年移動による世界状態の再現を追加・修正する。年・期間・時代・timeline event・履歴表示や保存に使い、geometryはrealm-change-map、SQLiteとIPCはrealm-change-storageを併用する。
---

# Realm History Change

1. project overviewとdata modelを読み、年の意味と対象entityを確定する。
2. 年はRustのi32全域を往復し、UIだけの固定範囲へ切り詰めない。
3. eraは安定ID、非空名、開始年、任意終了年を持ち、終了年を開始年より前にしない。
4. revisionはyear・sequence順のappend-onlyとし、同一年の後勝ちを決定的にする。
5. 削除をrow消去ではなく削除revisionとして記録し、任意年のsnapshotを再構成する。
6. timeline event、era、featureを分け、Rustの粗粒度commandでtransactionalに扱う。
7. 負年、i32端、同年複数更新、削除、空履歴、reopen、rollbackをtestする。
8. UI、IPC、schema、docsを同じ変更で同期する。
