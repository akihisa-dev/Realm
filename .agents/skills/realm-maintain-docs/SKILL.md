---
name: realm-maintain-docs
description: RealmのAGENTS.md、README、CONTRIBUTING、SECURITY、Release Checklist、docs正本と索引を現行実装へ同期し、責務重複、古い説明、リンク切れ、索引漏れを防ぐ。仕様・設計・運用文書の作成、整理、実装後同期に使い、code変更は専門Skill、commitはrealm-commitを併用する。
---

# Realm Documentation Maintenance

1. 調査だけなら編集せず、statusとdocs INDEXから対象を選ぶ。
2. AI規則はAGENTS、製品はproject、UIはdesign、技術はengineering、運用はdevelopmentとoperationsへ置く。
3. READMEは対外要約、CONTRIBUTINGは参加規則、SECURITYは報告境界、Checklistは手動公開確認に限定する。
4. 現在の判断だけを書き、作業履歴、未確定仕様、他製品名、秘密、絶対pathを残さない。
5. command、version、成果物名を現行package scriptsへ照合し、GitHub Actionsを前提にしない。
6. 新規文書より既存正本を優先し、追加・移動・削除時は索引を同期する。
7. docs index check、旧語検索、diff checkを実行する。
8. commit時はrealm-manage-versionとrealm-commitを使う。
