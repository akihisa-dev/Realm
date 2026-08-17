# リリース運用

Realmのリリースはオーナー主導で明示的に行います。
リポジトリではGitHub Actionsを使いません。
ローカルゲートが成功しても、Git操作、Draft Releaseの作成、公開は許可されません。

## tagの前に

- `app/package.json`の正確なsemverと、コミット済みのSBOMを確認する
- schema互換性の注記とmigrationテストが最新であることを確認する
- `app/`から`pnpm verify:local:push`を実行し、完全な差分を確認する
- Apple Silicon上で`pnpm verify:local:release`を実行する。このコマンドはElectron Forgeの`.app`をbuildし、Finderを起動したりvolumeをmountしたりせずにDMGを作成し、arm64実行ファイルとbundle metadataを静的に検証し、checksumを生成し、通知とコミット済みSBOMを`release-assets/`へstageする。buildしたパッケージは起動しない
- ユーザーの地図ファイル、認証情報、無関係な変更がないことを確認する

リリースをstageするとき、`release-assets/`は既に存在していてはいけません。
stageコマンドは、以前の証拠セットを削除したり上書きしたりせずに停止します。
別の実行の前に、対象ディレクトリを明示的に検査して移動してください。

初期成果物は意図的に署名もnotarizationも行いません。
Developer ID identity、hardened-runtimeの署名設計、notarization認証情報、Gatekeeper検証は影響の大きい別作業であり、buildの依頼から推測してはいけません。

Realmの起動を必要とする機能テストとGUIテストは、`Realmをテスト起動.command`または`script/build_and_run.sh`を通じて別に完了させます。
build済み、package済み、インストール済みの`.app`をテストアプリケーションに使いません。

## GitとGitHubの境界

branch push、tag作成、tag push、Draft Release作成、Release公開には、それぞれ別の明示的なオーナー指示が必要です。
pre-push hookは安全側で停止し、対応するローカルゲートを再実行します。
tagやpushが自動ワークフローを起動することはありません。

オーナーが、正確な`MAJOR.MINOR.PATCH` tagがGitHubに存在した後のDraft Releaseを明示的に依頼した場合は、次の手順を使います。

1. tagがアプリケーションversionと一致し、ローカルで検証したコミットを指していることを確認する
2. `release-assets/`にある`pnpm verify:local:release`が既にstageした4つのファイルだけを使う
3. 既存のassetや公開済みReleaseを上書きせずに、GitHub Draft Releaseを作成する
4. オーナーが別途公開を許可するまで、Releaseをdraftのままにする

想定するファイルは、`Realm-<version>-macOS-arm64.dmg`、その`.sha256`ファイル、`THIRD_PARTY_NOTICES.md`、`realm-dependencies.cdx.json`です。
Draft Releaseの作成中にこれらをbuildし直したり変更したりしてはいけません。

## ロールバック

成果物またはmigrationに問題がある場合は、公開を停止して証拠を保持し、修正版のversionを発行します。
Release assetを上書きせず、公開済みGit履歴を書き換えず、ユーザーの`.realmmap`をその場で変更しません。
