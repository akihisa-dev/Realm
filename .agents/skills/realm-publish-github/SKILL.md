---
name: realm-publish-github
description: Realmの検証・commit済み変更を、明示された範囲だけGitHubへpushし、必要な場合だけDraft Pull Requestを作成・更新する。branch push、remote反映、Draft PR、公開前検査に使い、commitはrealm-commit、tag・Draft Release・Publishはrealm-releaseを優先する。
---

# Realm GitHub Publication

1. push、branch作成、PR作成・更新のうち明示された操作だけを行う。
2. status、branch、upstream、remote、未push commit、remote SHA、共通祖先を確認する。
3. non-fast-forwardやremote新規commitではmerge・rebase・forceを自動実行しない。
4. secret guard、version range、outgoing diff、verify local pushを完了する。
5. GitHub Actionsを期待せず、local gate失敗時はpushしない。
6. cleanな現在HEADを明示remoteとrefへ通常pushし、force pushを使わない。
7. PR明示時は重複を確認し、ready指定がなければDraftにする。
8. push後にremote SHA、PR URL・Draft状態、未実施操作を報告する。
