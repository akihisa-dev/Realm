# リリースチェックリスト

リリース操作には明示的な承認が必要です。
このリポジトリではGitHub Actionsを使いません。
コミットは、branch push、tag作成、tag push、Draft Release作成、公開を許可するものではありません。

## tagの前に

- [ ] versionの正本とコミット済みSBOMが、予定するsemverで一致している
- [ ] schema migrationと`.realmmap`互換性の注記が最新である
- [ ] Apple Silicon上で`verify:local:push`が成功している
- [ ] build済みパッケージを起動せず、arm64 buildとbundleの静的検査を含む`verify:local:release`が成功している
- [ ] DMGのchecksum、通知、コミット済みCycloneDX SBOMが`release-assets/`に存在する
- [ ] 以前の`release-assets/`の証拠を検査して明示的に移動しており、stageコマンドが上書きしていない
- [ ] 完全な差分、secret guard、未追跡ファイルを確認している
- [ ] 署名なし、notarizationなしの状態をこのリリース候補で受け入れられる

## pushの前に

- [ ] オーナーがこのbranchまたはtagのpushを明示的に許可している
- [ ] `.githooks/secret-guard.sh --range <outgoing-range>`が成功している
- [ ] refがローカルで検証済みのコミットを指している
- [ ] 対応するローカルゲートをpush直前に再実行している

## Draft Releaseを作成する前に

- [ ] オーナーがtag push後のDraft Release作成を明示的に許可している
- [ ] tagが正確な`MAJOR.MINOR.PATCH`であり、`app/package.json`と一致し、検証済みのコミットを指している
- [ ] Draftにはstage済みのDMG、SHA-256ファイル、通知、SBOMだけが含まれている
- [ ] upload中に成果物をbuildし直したり、変更したり、上書きしたりしていない
- [ ] 既存または公開済みのassetを上書きしていない
- [ ] Releaseがdraftのままになっている

## 公開

- [ ] 署名とnotarizationを、別途承認された認証情報の手順で実施している
- [ ] 最終notarization済み成果物でGatekeeper検証が成功している
- [ ] オーナーがGitHub Releaseの公開を明示的に許可している
