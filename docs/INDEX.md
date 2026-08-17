# Realm文書索引

この索引は、作業内容に対応する正本文書へ案内します。
ある文書が別の文書を要約することはありますが、実装上の判断は最も具体的な正本で確認してください。

## 製品

- [プロジェクト概要](project/overview.md)：目的、範囲、利用者、対象外、用語

## 技術

- [アーキテクチャ](engineering/architecture.md)：Electron main/preloadの境界、状態の所有者、オフライン保証
- [データモデル](engineering/data-model.md)：schema 13の`.realmmap` SQLite契約、階層tree、typed content、一時的なグリッド選択
- [技術構成](engineering/stack.md)：採用する技術とプラットフォームの制約
- [テスト戦略](engineering/test-strategy.md)：テスト層と公開前に必要な証拠

## デザイン

- [デザイン正本](design/DESIGN.md)：初期のビジュアルシステム、アプリケーション状態、レイアウト、rendererの表示規則

## 開発と運用

- [開発](development.md)：ローカル環境、安全なコマンド、文書規則、検証
- [リリース運用](operations/release.md)：明示的な承認、ローカル公開ゲート、タグ、下書き成果物

## リポジトリ規約

- [AGENTS.md](../AGENTS.md)：自動化された作業者の規則
- [CONTRIBUTING.md](../CONTRIBUTING.md)：オーナー主導の貢献方針
- [SECURITY.md](../SECURITY.md)：秘密情報の防御と脆弱性の報告
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)：依存関係に関する通知の入口

コード変更によってこれらの記述が不正確になった場合は、同じ変更で文書も更新してください。
競合する第2の正本を作ってはいけません。
