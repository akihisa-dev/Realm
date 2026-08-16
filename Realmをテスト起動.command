#!/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

echo "Realmを開発モードでテスト起動します。"
if "$ROOT_DIR/script/build_and_run.sh"; then
  status=0
else
  status=$?
fi

echo
if [[ $status -eq 0 ]]; then
  echo "Realmのテスト起動を終了しました。"
else
  echo "Realmのテスト起動に失敗しました（終了コード: ${status}）。"
  echo "上のエラーと docs/development.md を確認してください。"
fi

if [[ -t 0 ]]; then
  read -r -p "Returnキーを押すと閉じます。" _
fi

exit "$status"
