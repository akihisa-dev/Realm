---
name: realm-refactor-codebase
description: Realm全体または複数境界を、現行動作と.realmmap互換性を保ちながら、責務、依存方向、状態所有、Tauri IPC、SQLite、OpenLayers、非同期、I/O、再描画、検証、正本文書まで包括的に整理する。大規模refactorや技術的負債の包括解消に使い、機能追加や単一file整理だけには使わない。
---

# Realm Codebase Refactor

1. 目的、非目的、保持動作、保存互換、性能基準、完了条件を固定する。
2. status、docs、architecture、data model、test strategy、package scripts、境界を調べる。
3. React、map adapter、backend、Tauri command、domain、SQLiteの依存方向を整理する。
4. 現行.realmmap、world ID、現在状態、atomicity、local-onlyを不変にする。
5. 小さな検証可能単位へ分け、各段階で対象testを通す。
6. migrationはsource不変、rollback、fixtureを先に設計する。
7. TypeScript、coverage、architecture、Rust fmt・Clippy・test、SBOM、docsを確認する。
8. 独立目的は分け、全作業後の最終報告直前に順次commitする。
