---
name: realm-retire-feature
description: Realmの機能・サブシステムを、ユーザーが廃止・撤去・完全削除を明示した場合に、入口、状態、IPC、SQLite互換、依存、test、文書、Skillまで横断して安全に取り除く。機能廃止に使い、監査、未使用らしいcode、機能維持refactorでは使わない。
---

# Realm Feature Retirement

1. 廃止対象と終了状態が明示されていることを確認し、整理依頼から推測しない。
2. UI非表示、作成停止、互換読込維持、保存形式除去を区別する。
3. UI、state、type、Tauri、Rust、schema、capability、dependency、test、docs、Skillを棚卸しする。
4. 実ユーザーの.realmmapを削除・変換せず、旧dataの読込・無視・移行・拒否を決める。
5. 新規利用を止め、必要な移行後に実装を外す。
6. 利用がないことを確認してからdependency、asset、scriptを削除する。
7. dead UI、type、command、table参照、docs link、Skill routingの残存を検索する。
8. test、full verification、migration・reopen、docsを確認する。
