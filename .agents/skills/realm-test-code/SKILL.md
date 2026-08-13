---
name: realm-test-code
description: RealmのVitest・React Testing Library・Node SQLite/Electron main test・Node script testについて、失敗再現、原因切分け、回帰test、fixture、mock、一時.realmmap、coverageを扱う。test失敗、flaky、回帰防止、coverage不足、境界test追加に使い、機能実装はrealm-change系Skill、実画面は明示時だけrealm-test-development-appを使う。
---

# Realm Code Test

1. 調査だけなら編集せず、失敗command、test名、期待値、実際値を最小対象で再現する。
2. React・DOMはjsdom、Node scriptとElectron mainはNode、SQLite・path・transactionはNode SQLite testへ置く。
3. 実装内部よりユーザー結果、保存内容、状態遷移、拒否、副作用なしを検証する。
4. 実ユーザーの.realmmapを使わず、各testが一時領域にsynthetic fixtureを作る。
5. 時間、乱数、共有state、listener、map target、temporary fileをcleanupする。
6. 保存では成功、rollback、reopen、future・corrupt拒否を確認する。
7. coverage数値だけを満たすtestや除外を追加しない。
8. 対象testから始め、Vitest、TypeScript、Node test、必要なfull gateへ広げる。
