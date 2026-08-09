---
name: realm-test-development-app
description: ユーザーが現在の作業で明示した場合だけ、Realmをテスト起動した開発版で見た目、操作、地図pan・zoom、focus、dialog、Tauri lifecycleを実画面確認する。GUI確認、screenshot、開発版操作、E2Eに使い、未指示の起動、build・package・install済みapp、実ユーザー.realmmapの利用を防ぐ。
---

# Realm Development App Test

1. 実アプリ起動やGUI操作が現在の依頼で明示されていることを確認する。
2. 自動testで証明できる条件を先に確認し、実画面固有の条件だけを列挙する。
3. 必ず`Realmをテスト起動.command`またはその実体である`script/build_and_run.sh`を使い、その作業でテスト起動した開発processとwindowだけを対象にする。
4. build済み、package済み、install済みapp、既存Realm、別taskのserverを起動・操作してtestしない。
5. 実ユーザーの.realmmapを開かず、一時領域のsynthetic projectを使う。
6. 依頼に関係する開始、地図、年、era、save、close、error、keyboardだけを確認する。
7. 終了時に自分が起動したprocessだけを止め、一時dataだけを片付ける。
8. 自動test、実画面結果、未確認を分けて報告する。
