---
name: realm-commit
description: Realmの完了済み変更を、最終結果の報告直前に目的別に分割・検証・stageし、日本語Conventional Commitsでcommitする。作業完了時の既定commit、明示commit、stage-onlyに使い、versionはrealm-manage-versionを必ず併用する。実装途中、検証途中、途中報告、pushだけの依頼ではcommitしない。
---

# Realm Commit

1. stage-onlyとcommitを区別し、commitではrealm-manage-versionを使う。
2. 実装、docs、検証をすべて終えるまでcommitせず、最終報告直前だけbatchを開始する。
3. 最新status、working tree、indexを再読し、独立目的ごとに単位を決める。
4. 無関係・並行差分をstageせず、git add dotやadd allを使わない。
5. 各commitでversionを進め、code・test・docs・version・SBOMを同じ目的へ含める。
6. secret guard、cached diff check、staged diff、version check-staged、pre-commitを実行する。
7. 件名はtype、version、日本語説明とし、scopeは件名へ書かない。
8. 本文はscope、目的、内容、確認、影響を基本とし、機微値と絶対pathを一般化する。
9. commit後にID、version、残存差分を確認する。
10. commit失敗時は完了扱いにせず、権限不足、index lock、並行差分、version所有競合を理由に終了しない。最新状態を再読し、短時間再試行、安全なhunk分離、必要な権限承認、明示許可を得たworktreeなどで継続する。新しいユーザー判断が不可欠なら具体的な許可を求めてblockedとし、完了報告しない。無関係差分の混入、勝手なunstage、worktreeの無断使用は禁止する。pushは明示時だけrealm-publish-githubへ渡す。
