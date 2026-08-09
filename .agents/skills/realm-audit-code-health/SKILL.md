---
name: realm-audit-code-health
description: RealmのReact、TypeScript、Rust、Tauri command、OpenLayers、SQLite境界について、責務肥大、依存方向、非同期競合、I/O、再描画、初期読込、性能を実害に基づいて監査する。code健全性、巨大file、性能、循環依存、境界違反の調査や明示された局所改善に使い、包括的変更はrealm-refactor-codebaseを優先する。
---

# Realm Code Health Audit

1. 監査だけなら編集せず、改善が明示された場合だけ変更する。
2. status、対象code、architecture、data model、test strategyを読む。
3. React、map adapter、backend、Tauri command、SQLiteの所有境界を追う。
4. 行数や警告数だけで判断せず、data損失、操作停止、競合、不要I/O・renderを優先する。
5. architecture check、TypeScript、Clippy、test、buildで裏付ける。
6. 誤検知は既存防御とtestを根拠にし、設定だけで警告を消さない。
7. 改善では純粋処理、状態、I/O、描画、互換処理を依存方向に沿って分ける。
8. 所見、根拠、優先度、変更、検証、残存riskを報告する。
