---
name: realm-update-dependencies
description: Realmのpnpm・Cargo依存、Node・pnpm・Rust・cargo-deny固定値を候補確認から段階的に更新し、互換性、license、THIRD_PARTY_NOTICES、SBOM、test、web build、macOS packageまで整合させる。依存更新、audit、outdated、lockfile、toolchain更新に使い、GitHub Actionsは対象にしない。
---

# Realm Dependency Update

1. 監査だけなら変更せず、manifest、lock、deny、notices、SBOMを読む。
2. production、development、Rust、toolchainを分け、小さなgroupごとに評価する。
3. 公式release note、migration guide、package metadataを一次情報にする。
4. macOS arm64とNode・React・Tauri・Rustの組合せ、Realmが使うAPIを確認する。
5. major、native、storage、renderer依存を重点確認し、最新版だけで採用しない。
6. manifestとlockを同時更新し、必要なcode・type・config対応を含める。
7. DependabotやGitHub Actionsを追加しない。
8. license、SBOM、audit、TypeScript、test、Rust、web buildを確認する。
9. Tauriやpackage変更ではrealm-debug-packagingを併用する。
