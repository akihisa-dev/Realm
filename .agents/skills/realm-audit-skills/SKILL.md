---
name: realm-audit-skills
description: Realmリポジトリ所有の.agents/skills集合を、責務、発火description、相互routing、現行path・command、補助資源、重複、不足、古いGitHub Actions前提から監査し、明示された場合だけ修正・統合・分割・廃止する。Skill棚卸し、誤発火、古い手順、Realm固有領域の不足調査に使う。
---

# Realm Skill Audit

1. 監査のみと監査・適用を分け、監査のみではSkillを変更しない。
2. AGENTS routing、全SKILL.mdとagents/openai.yamlを一覧化する。
3. name、description、目的、入力、出力、path、command、Skill関係を収集する。
4. descriptionだけで適切に発火できるか、重複、不足、循環routingを確認する。
5. map、storage、UI、verification、test、docs、package、version、commit、publicationを代表caseでroutingする。
6. pathとcommandをHEADへ照合し、別プロジェクト固有語、別runtime、Markdown workspace、GitHub Actions前提、build・package済みappを使うtest手順を拒否する。
7. skill creator validatorで全Skillを検証し、未完了マーカー、frontmatter、linkを確認する。
8. 修正は明示時だけ行い、失われる知識とrouting影響を説明する。
