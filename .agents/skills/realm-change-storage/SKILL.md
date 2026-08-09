---
name: realm-change-storage
description: Realmの単一.realmmap SQLite、rusqlite schema・migration・transaction、Tauri command、path検証、atomic create、open・save・close、破損・future schema拒否を追加・修正する。保存形式、IPC、ファイル安全性、履歴永続化に使い、地物仕様はrealm-change-map、年履歴はrealm-change-historyを併用する。
---

# Realm Storage Change

1. architecture、data model、Rust実装、Tauri capabilityを読む。
2. 一つの.realmmapを一つのSQLite正本として保ち、分割JSONやcloud送信を導入しない。
3. path、拡張子、親実体、symlink、通常file、SQLite headerをRustで検証する。
4. 新規作成はschemaとworldを一transactionで作り、同期済みstagingをno-replaceで公開する。
5. 既存fileはread-only preflight後だけread-writeで開き、拒否時にsourceやjournal modeを変えない。
6. mutationはtransactionalにし、失敗時に半端なworld、era、event、revisionを残さない。
7. schema変更はversion、fixture、future拒否、rollback、source不変をtestする。
8. Tauri commandは粗粒度にし、ReactからSQLやfilesystemを扱わせない。
9. Rust fmt、Clippy、test、IPC型、docsを確認する。
