---
name: realm-change-local-verification
description: Realmのpackage scripts、Git hooks、secret guard、runtime policy、architecture・docs・license・SBOM・security・package検査などローカル検証経路を追加・修正する。検証失敗、hook、公開前gate、tool固定、秘密情報防止に使う。RealmはGitHub Actionsを使わないためworkflowを作成せず、依存更新はrealm-update-dependencies、配布検査はrealm-debug-packagingを併用する。
---

# Realm Local Verification Change

1. development docs、package scripts、hooks、対象scriptを読む。
2. GitHub Actionsやworkflowを追加せず、local Apple Silicon環境を正本にする。
3. 通常、push前、release前のgateを分け、後者ほど前者を包含させる。
4. Node、pnpm、Electron Forge、Viteの現行固定値を照合する。
5. secret、version、license、SBOM、architecture、package checkを弱めない。
6. scriptは失敗を終了codeで伝え、未導入・stale成果物をfail-closedにする。
7. 起動が必要なtestは通常gateやrelease gateへ混ぜず、明示時だけ`Realmをテスト起動.command`経由の開発版で行う。build・package・install済みappは起動しない。
8. shell syntax、script test、self-test、拒否case、diff checkを確認する。
