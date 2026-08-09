---
name: realm-release
description: Realmのrelease準備、version確認、Apple Silicon配布build、local・remote tag、手動Draft Release、Publishを現行Checklistに従って進める。配布成果物、tag、tag push、Draft作成、公開を明示された場合に使い、各操作の許可を後続操作へ広げない。RealmはGitHub Actionsを使わない。
---

# Realm Release

1. 依頼を準備、build、tag作成、branch push、tag push、Draft、Publishへ分ける。
2. release docs、Checklist、package version、現行scriptを読む。
3. clean tree、version成果物、対象commitの妥当性を確認する。
4. verify local releaseをmacOS arm64で完了し、DMG、checksum、notices、SBOMを確認する。
5. tag、各push、Draft、Publishはそれぞれ別の明示許可を必要とする。
6. versionと一致する未使用tagだけを作り、既存tagを移動・削除しない。
7. Draftにはstaged済み4 assetだけを手動添付し、既存assetを上書きしない。
8. 署名、公証、自動更新、store配布、資格情報を推測で追加しない。
9. version、commit、tag、検証、asset、remote、公開状態を報告する。
