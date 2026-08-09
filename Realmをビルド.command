#!/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

echo "RealmのmacOSアプリとDMGをビルドします。"
if "$ROOT_DIR/script/build_macos.sh"; then
  status=0
else
  status=$?
fi

echo
if [[ $status -eq 0 ]]; then
  echo "Realmのビルドが完了しました。"
else
  echo "Realmのビルドに失敗しました（終了コード: ${status}）。"
  echo "上のエラーと docs/development.md を確認してください。"
fi

if [[ -t 0 ]]; then
  read -r -p "Returnキーを押すと閉じます。" _
fi

exit "$status"
