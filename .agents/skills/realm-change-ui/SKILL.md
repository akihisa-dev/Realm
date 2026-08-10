---
name: realm-change-ui
description: Realmの開始画面、編集shell、toolbar、rail、sidebar、地図canvas、dialog、状態表示、keyboard・pointer操作、accessibilityを実装・修正する。見た目、レイアウト、操作感、focus、drag、zoom、狭幅、エラー表示に使い、地図固有処理はrealm-change-map、実画面確認は明示時だけrealm-test-development-appを使う。
---

# Realm UI Change

1. design、対象仕様、React実装、CSSを読む。
2. 編集時は単純で判読しやすく、閲覧styleは永続dataから派生させる。
3. loading、empty、dirty、saving、error、disabled、selected、focusを定義する。
4. 未保存破棄、非同期競合、save中編集、snapshot切替を保護する。
5. keyboard、pointercancel、lost capture、zoom境界、accessible labelを維持する。
6. UI都合でSQLiteやIPC契約を変えず、必要なら専門Skillを併用する。
7. 状態遷移はReact test、座標計算はunit testで確認する。
8. 実アプリ起動やscreenshotは明示時だけrealm-test-development-appへ渡し、テスト起動した開発版だけを使う。
