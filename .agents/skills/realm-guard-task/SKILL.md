---
name: realm-guard-task
description: Realmリポジトリの変更・コミット・外部操作で、対象、許可範囲、並行差分、ユーザーデータ、完了証拠を変更前後に照合する。別リポジトリ、実.realmmap、提示見本、push・タグ・Release、復旧を伴う作業で専門Skillと併用し、調査だけでは読み取り専用を保つ。
---

# Realm Task Guard

1. 最初の書き込み前に目的、許可対象、対象外、外部操作、完了証拠を整理する。
2. Git root、branch、remote、statusを確認し、Realm以外へ書き込まない。
3. 変更直前に対象を再読し、並行差分を現在状態として統合する。意図不明な差分は編集・stageしない。
4. 調査では読み取り専用を保ち、push、tag、Release、画面起動を推測しない。ユーザーが現在の依頼で画面起動そのものを明示していなければ、Realm、browser、その他のGUI appやwindowを起動せず、起動しなければ確認できない事項は未確認として報告する。
5. 起動を伴うtestは、ユーザーが現在の依頼で画面起動そのものを明示した場合だけ`Realmをテスト起動.command`または`script/build_and_run.sh`から開発版を起動して行い、build・package・install済みappを使わない。実装、修正、test、確認、E2E、screenshotなどの依頼だけを起動許可として扱わない。
6. 実ユーザーの.realmmapをtest、fixture、Gitへ使わず、一時領域の合成dataだけを使う。
7. local-only、macOS arm64、単一SQLite、現在状態、手動編集、生成なしを守る。
8. 秘密情報、個人情報、内部URL、ローカル絶対pathを成果物とcommitへ含めない。
9. 完了前に最新指示、全差分、test、docs、未実施操作を照合する。
10. commitは全作業と検証後、最終報告直前だけrealm-commitへ渡す。
