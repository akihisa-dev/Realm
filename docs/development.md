# 開発

## 最初に読むもの

1. Apple Silicon搭載macOS 14以降で作業する
2. [AGENTS.md](../AGENTS.md)、[docs/INDEX.md](INDEX.md)、変更に対応する正本文書を読む
3. テスト用データベースは一時ディレクトリに置く。個人の`.realmmap`をテストへ指定しない
4. 書き込む前に`git status --short`、ロックファイル、現在の対象ファイルを確認する

## 固定環境

Realmは`.node-version`に記載した正確なNode.js versionと、`app/package.json`に記載した正確なNode.jsおよびpnpm versionを必要とします。
runtime gateは、別のOS、アーキテクチャ、固定値と異なるtool versionを拒否します。
Node.js 24は、ローカル保存に使うmain processの`node:sqlite` APIを提供します。

Homebrewを使うローカルセットアップは次のとおりです。

```sh
brew install node@24 pnpm
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
cd app
pnpm install --frozen-lockfile
```

グローバル設定やマシン固有のパスをコミットしてはいけません。
各開発者がローカルで固定環境を使う責任を持ちます。
このリポジトリではGitHub Actionsを使いません。

Electron Forgeが開発とパッケージのライフサイクルを管理します。
Viteはmain process、preload bridge、rendererを別々の対象としてbuildします。
main processはNode組み込みの`node:sqlite`を使い、追加のnative toolchainやホスト型サービスを必要としません。
runtime resolverが変更するのは現在のprocessだけであり、shellのdotfileは編集しません。

## 開発と検証

`app/`から次を実行します。

```sh
pnpm start
pnpm verify
pnpm skills:check
pnpm verify:full
```

`verify`はstrict TypeScriptと自動テストを対象にします。
`skills:check`はリポジトリ所有のRealm Skill、そのrouting metadata、他プロジェクト由来の古い前提を検証します。
`verify:full`はそれに加えて、Skillゲート、ソース境界、文書、推移ライセンス、コミット済みSBOM、rendererのproduction build、パッケージ内容、Node runtimeを検査します。
`verify:ci`はproduction依存関係のadvisoryも加えて実行する再利用可能なstrict local commandです。
GitHub Actionsには接続しません。

通常の`verify`はsecret-guardの回帰行列も実行します。
そのため、push直前だけでなく開発中にも、stage済み、commit-range、new-ref、file-type-change、merge-resolution、安全な削除の挙動を確認します。

公開用の検証スクリプト（`verify`、`verify:full`、`verify:ci`、2つの`verify:local:*`ゲート）は、`script/with_node_runtime.sh`を入口にします。
対話shellが別のNode versionを公開している場合、resolverはリポジトリの`.node-version`を確認し、明示されたローカルruntime、設定済みのversion managerの場所、Homebrewから見つけたprefix、PATHの後方にある候補を順に検証します。
toolのインストールをダウンロードしたり変更したりすることはありません。
すべての候補は固定された正確なversionを報告しなければなりません。
候補がない場合、ゲートは必要なversionとローカルセットアップの案内を示して停止します。
内部スクリプトを分けているのは、最初の依存関係またはテストコマンドを固定されていないNode processで実行しないためです。
通常、version不一致、引数または終了ステータス、runtime不足のケースを単独で確認するには`pnpm node:runtime:test`を使います。

### Finderショートカット

Finderからは、リポジトリルートにある実行可能なショートカットを使います。

- [`Realmをテスト起動.command`](../Realmをテスト起動.command)をダブルクリックすると、Electronアプリケーションを開発モードで起動する。`.realmmap`は自動で開かない
- [`Realmをビルド.command`](../Realmをビルド.command)をダブルクリックすると、Apple Silicon向けの`.app`とDMGをbuildして検査する。パッケージ済みアプリは起動しない

どちらのショートカットも固定されたローカル環境と`app/`内のインストール済み依存関係を使い、toolやパッケージを自動インストールしません。
起動前にRealmは、コミット済みの`pnpm-lock.yaml`とpnpmが保持するインストール済みlock snapshotを比較します。
依存関係が変わっている場合は安全側に停止して`pnpm install --frozen-lockfile`を求めますが、アプリケーションversionだけの変更では、それ以外が最新のインストールを無効にしません。
上記のHomebrew環境があれば、Finderが対話shellの`PATH`を引き継いでいなくても、ショートカットは固定Node.jsのパスを解決します。
開発ランチャーは、一時領域内のリポジトリ固有ディレクトリをElectronの`userData`に使います。
シンボリックリンク、別所有者、ディレクトリでない対象、`0700`以外の権限は拒否します。
そのため、開発用の世界がパッケージ済みアプリのuser-dataディレクトリを共有することはありません。
エラーを見える状態に保つため、Terminal windowは完了後にReturn入力を待ちます。
再利用可能なshellの入口は`script/build_and_run.sh`と`script/build_macos.sh`で、CodexのRun操作は前者を使います。

Realmの起動を必要とするテストは、`Realmをテスト起動.command`またはその入口である`script/build_and_run.sh`を使わなければなりません。
build済み、package済み、インストール済みの`.app`ではテストしません。
パッケージ検証は静的に行い、起動せずにbundle、実行ファイルのアーキテクチャ、metadata、署名、DMG、checksumを検査できます。

開発アプリケーションを起動する明示的な許可がある場合、`pnpm smoke:electron`は新しい一時`userData`ディレクトリでElectronを起動します。
固定されたpreload readiness channelを認証し、main window、renderer、preload API、空のライブラリを検証し、JSONレポートを書いて終了します。
`pnpm smoke:package`は通常のゲートとリリースゲートでは意図的に静的に動作し、パッケージアプリを起動せずに実行ファイルとプラットフォームの証拠を記録します。

依存関係とライセンスの検査は、pnpmロックファイルとパッケージ済みElectron/Viteの依存関係グラフを調べます。
古いパッケージ成果物、欠落したライセンス、想定外のパッケージ内容、古いSBOMがあると安全側に停止します。

SBOMは正規化後に決定的になり、どちらかのロックファイルが変わったときは更新しなければなりません。

```sh
pnpm sbom:generate
pnpm sbom:check
```

resolverの通常PATH、不一致、安全側で停止するケースを確認するには、次を実行します。

```sh
pnpm node:runtime:test
```

## versionの更新

`app/package.json`がアプリケーションversionの正本です。
Electron Forgeのパッケージmetadata、CycloneDXのアプリケーションversion、Git tagには`MAJOR.MINOR.PATCH`を使います。

すべてのコミットでversionを進めます。
オーナーから明示的なMAJOR指示がない場合、`feat`はMINORを、それ以外の承認済みcommit typeはPATCHを増やします。
MAJORの更新には、コミットメッセージの`Version-Impact: major`が必要です。
明示的なMAJOR指示なしに、`!`や`BREAKING CHANGE:`を付けたコミットを作成してはいけません。

独立した目的は別のコミットに分け、各コミットでversionを順番に進めます。
versionの更新は変更と同じコミットに含め、versionだけのコミットは作りません。
`app/`から次の値を計算するには、次を実行します。

```sh
pnpm version:next -- <current-version> <type>
```

### コミットのタイミング

依頼された作業全体を終え、正本文書を同期し、必要な検証を実行してからコミットします。
計画したコミットまたはコミット列は、オーナーへ最終結果を報告する直前にだけ作成します。
途中の進捗報告はコミットを許可したり、コミットを開始したりするものではありません。

stageの直前には最新の作業ツリーを読み直します。
独立した目的に属するファイルだけをstageし、version成果物がstage済みの差分と一致することを確認してから、計画した順にコミットします。
コミットを作成できない場合は、完了したと主張せず、未コミットのまま理由を報告します。

すべてのversion成果物を更新した後、SBOMを再生成します。
pre-commit hookはstage済み成果物を確認し、pre-push hookは送信対象の各コミットについて件名、type、連続したversion、同期済み成果物を検証します。

リポジトリ検査には次も含まれます。

```sh
git diff --check
.githooks/secret-guard.sh --self-test
```

secret-guardのself-testは、stage済み内容と既存ブランチおよび新規ブランチのpush範囲を検査します。
追加、変更、renameまたはcopy、ファイル種別の変更、merge解決を対象にし、安全な削除の範囲も確認しなければなりません。
削除は結果ツリーにblobがないため読み取りから除外しますが、内容を最初に導入したコミットは送信範囲の検査対象に残ります。

cloneごとに一度、リポジトリhookを有効にします。

```sh
git config core.hooksPath .githooks
```

## 書き込みとレビューの規則

- 並行している変更と無関係な変更を保持する
- `.realmmap`、機能またはセルの意味、コマンド権限、リリース挙動を変更した場合は、正本文書も更新する
- `example.invalid`や`REDACTED`のようなplaceholderを使い、実際のtoken、非公開の地図データ、非公開の場所を記録しない
- テストは合成した一時`.realmmap`を作成する。secret guardは、強制追加した場合でも地図ファイルとデータベースファイルを拒否する

## 明示的な操作ゲート

pre-commit hookはstage済みの秘密情報、空白、versionの一致を検査します。
pre-push hookは送信対象のcommit範囲を検査し、branch pushでは`verify:local:push`、tag pushでは`verify:local:release`を実行します。
リリースゲートはさらに、署名していないarm64パッケージをbuild、検査、stageします。
パッケージ済みアプリを起動することはありません。

branch push、tag作成、tag push、Draft Release作成、公開は、それぞれ別のオーナー操作です。
GitHub Actionがこれらを実行することはありません。
署名とnotarizationも別の操作です。
[リリース運用](operations/release.md)に従ってください。
