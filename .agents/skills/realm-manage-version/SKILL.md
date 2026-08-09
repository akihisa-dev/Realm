---
name: realm-manage-version
description: Realmのcommit typeとオーナーの世代更新指示から次のMAJOR・MINOR・PATCHを決定し、package.json、Cargo.toml・lock、tauri.conf、SBOM、commit件名、Git履歴を整合させる。版計算、版更新、commit準備・検証に使い、stageとcommitはrealm-commit、tagはrealm-releaseを併用する。
---

# Realm Version Management

1. development docs、HEAD version、変更の主目的を確認する。
2. 明示された世代更新だけMAJOR、featはMINOR、その他はPATCHとする。
3. version-policyのnext commandで次版を計算する。
4. breaking markerが必要でMAJOR指示がなければcommitしない。
5. package、Cargo manifest・lock、Tauri config、SBOMを同じversionへ更新する。
6. SBOM再生成とlicense checkを行い、versionだけのcommitを作らない。
7. 複数目的は分け、最終報告直前に一つずつversionを進める。
8. stage後はcheck-staged、commit後はcheck-rangeを実行する。
