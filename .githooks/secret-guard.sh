#!/bin/sh
set -eu

blocked=0
zero=0000000000000000000000000000000000000000
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script_path="$script_dir/secret-guard.sh"

is_text_path() {
  lower_path=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$lower_path" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.icns|*.pdf|*.zip|*.dmg|*.exe|*.dll|*.so|*.dylib|*.node|*.realmmap|*.realmmap-*|*.sqlite|*.sqlite3|*.db|*.db-wal|*.db-shm)
      return 1 ;;
  esac
  return 0
}

is_guard_path() {
  case "$1" in
    .githooks/pre-commit|.githooks/pre-push|.githooks/secret-guard.sh)
      return 0 ;;
  esac
  return 1
}

check_path_name() {
  path=$1
  base=$(basename "$path" | tr '[:upper:]' '[:lower:]')
  is_guard_path "$path" && return 0
  case "$base" in
    *.realmmap|*.realmmap-*|*.sqlite|*.sqlite3|*.db|*.db-wal|*.db-shm)
      echo "Blocked user map or database file: $path" >&2; return 1 ;;
    .env|.env.*|*.env|*.env.*)
      case "$base" in .env.example|*.example) return 0 ;; esac
      echo "Blocked environment file: $path" >&2; return 1 ;;
    *client-secret*|*credentials*|*secret*|*token*|*.keychain|*.keychain-db|*keychain-export*)
      echo "Blocked credential-bearing filename: $path" >&2; return 1 ;;
  esac
  return 0
}

check_content_file() {
  content_file=$1
  path=$2
  commit=$3

  # Read directly from a file instead of shell variables. Command substitution
  # strips NUL bytes and could hide a credential after a binary-looking prefix.
  if grep -Eaiq 'Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9_./+=:@-]{16,}' "$content_file"; then
    echo "Blocked HTTP Bearer credential: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq 'Authorization:[[:space:]]*Basic[[:space:]]+[A-Za-z0-9+/=]{16,}' "$content_file"; then
    echo "Blocked HTTP Basic credential: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq '(^|[^A-Za-z0-9_])(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_[A-Za-z0-9_])' "$content_file"; then
    echo "Blocked GitHub token pattern: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq 'BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY|BEGIN PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY' "$content_file"; then
    echo "Blocked private key material: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq '(^|[^A-Za-z0-9_])(access_token|client_secret|refresh_token|id_token|private_key|_authToken|NPM_TOKEN)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_./+=:@-]{16,}' "$content_file"; then
    echo "Blocked credential assignment: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq '(npm_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{20,}|https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,})' "$content_file"; then
    echo "Blocked provider token pattern: $path ($commit)" >&2; return 1
  fi
  if grep -Eaiq '(mongodb(\+srv)?|mysql|postgres(ql)?):\/\/[^[:space:]@:/]+:[^[:space:]@/]+@' "$content_file"; then
    echo "Blocked credentialed database URL: $path ($commit)" >&2; return 1
  fi
  if grep -Eaq 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}' "$content_file"; then
    echo "Blocked AWS access key identifier: $path ($commit)" >&2; return 1
  fi
  return 0
}

check_blob_content() {
  commit=$1; path=$2
  is_guard_path "$path" && return 0
  is_text_path "$path" || return 0
  content_file=$(mktemp "${TMPDIR:-/tmp}/realm-secret-content.XXXXXX")
  if ! git cat-file blob "$commit:$path" > "$content_file" 2>/dev/null; then
    rm -f "$content_file"
    echo "Unable to read staged blob safely: $path ($commit)" >&2
    return 1
  fi
  if check_content_file "$content_file" "$path" "$commit"; then
    result=0
  else
    result=$?
  fi
  rm -f "$content_file"
  return "$result"
}

check_commit_path() {
  commit=$1; path=$2; failed=0
  check_path_name "$path" || failed=1
  check_blob_content "$commit" "$path" || failed=1
  [ "$failed" -eq 0 ]
}

check_commit() {
  commit=$1
  paths_file=$(mktemp "${TMPDIR:-/tmp}/realm-guard-paths.XXXXXX")
  git diff-tree --root --no-commit-id --name-only --diff-filter=ACMRT -m -r "$commit" > "$paths_file"
  if [ -s "$paths_file" ]; then
    while IFS= read -r path; do
      check_commit_path "$commit" "$path" || blocked=1
    done < "$paths_file"
  fi
  rm -f "$paths_file"
}

check_staged() {
  paths_file=$(mktemp "${TMPDIR:-/tmp}/realm-guard-paths.XXXXXX")
  git diff --cached --name-only --diff-filter=ACMRT > "$paths_file"
  if [ -s "$paths_file" ]; then
    while IFS= read -r path; do
      check_staged_path "$path" || blocked=1
    done < "$paths_file"
  fi
  rm -f "$paths_file"
}

check_staged_path() {
  path=$1; failed=0
  check_path_name "$path" || failed=1
  if ! is_guard_path "$path" && is_text_path "$path"; then
    content_file=$(mktemp "${TMPDIR:-/tmp}/realm-secret-content.XXXXXX")
    if git cat-file blob ":$path" > "$content_file" 2>/dev/null; then
      check_content_file "$content_file" "$path" staged || failed=1
    else
      echo "Unable to read staged blob safely: $path" >&2
      failed=1
    fi
    rm -f "$content_file"
  fi
  [ "$failed" -eq 0 ]
}

check_range() {
  for commit in $(git rev-list "$1"); do check_commit "$commit"; done
}

check_new_ref() {
  for commit in $(git rev-list "$1" --not --remotes); do check_commit "$commit"; done
}

check_pre_push() {
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" = "$zero" ] && continue
    if [ "$remote_sha" = "$zero" ]; then check_new_ref "$local_sha"; else check_range "$remote_sha..$local_sha"; fi
  done
}

run_self_test() {
  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/realm-secret-guard.XXXXXX")
  trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
  (
    cd "$temp_dir"
    git init -q
    git config user.email realm-guard@example.invalid
    git config user.name "Realm Secret Guard"
    expect_clean() {
      label=$1; shift
      blocked=0
      "$@" || :
      [ "$blocked" -eq 0 ] || { echo "self-test expected success: $label" >&2; exit 1; }
    }
    expect_blocked() {
      label=$1; shift
      blocked=0
      "$@" || :
      [ "$blocked" -ne 0 ] || { echo "self-test expected rejection: $label" >&2; exit 1; }
    }

    printf '%s\n' safe > safe.txt; git add safe.txt
    : > empty.txt; git add empty.txt
    expect_clean 'safe staged/add/empty' check_staged
    git commit -q -m safe; safe_commit=$(git rev-parse HEAD)
    git update-ref refs/remotes/origin/main "$safe_commit"
    expect_clean 'safe commit' check_commit "$safe_commit"
    rm safe.txt
    git add safe.txt
    git commit -q -m 'delete safe fixture'
    deleted_commit=$(git rev-parse HEAD)
    expect_clean 'safe deletion commit' check_commit "$deleted_commit"
    expect_clean 'existing remote range with deletion' check_pre_push <<EOF
refs/heads/main $deleted_commit refs/heads/main $safe_commit
EOF

    dummy_token=$(printf '%s%s' gh p_dummy_token_for_guard_only)
    printf '%s\n' "$dummy_token" > leak.txt; git add leak.txt
    expect_blocked 'synthetic GitHub token staged' check_staged
    git reset -q leak.txt

    printf '%s\n' safe > typechange.txt
    git add typechange.txt
    git commit -q -m 'type change baseline'
    typechange_base=$(git rev-parse HEAD)
    rm typechange.txt
    ln -s "$dummy_token" typechange.txt
    git add -A typechange.txt
    if ! git diff --cached --name-status -- typechange.txt | grep -Eq '^T'; then
      echo 'self-test expected regular-to-symlink type change' >&2
      exit 1
    fi
    expect_blocked 'synthetic GitHub token type-change staged' check_staged
    git commit -q -m 'type change secret fixture'
    typechange_commit=$(git rev-parse HEAD)
    expect_blocked 'synthetic GitHub token type-change commit' check_commit "$typechange_commit"
    expect_blocked 'existing remote range with secret type-change' check_pre_push <<EOF
refs/heads/main $typechange_commit refs/heads/main $safe_commit
EOF
    expect_blocked 'new remote ref with secret type-change' check_pre_push <<EOF
refs/heads/new $typechange_commit refs/heads/new $zero
EOF

    main_branch=$(git symbolic-ref --short HEAD)
    printf '%s\n' merge-base > merge-target.txt
    git add merge-target.txt
    git commit -q -m 'merge fixture base'
    git checkout -q -b merge-secret
    printf '%s\n' branch-secret > merge-target.txt
    git add merge-target.txt
    git commit -q -m 'merge fixture branch'
    git checkout -q "$main_branch"
    printf '%s\n' main-secret > merge-target.txt
    git add merge-target.txt
    git commit -q -m 'merge fixture main'
    if git merge -q --no-commit merge-secret; then
      echo 'self-test expected merge conflict' >&2
      exit 1
    fi
    printf '%s\n' "$dummy_token" > merge-target.txt
    git add merge-target.txt
    git commit -q -m 'merge resolution secret fixture'
    merge_commit=$(git rev-parse HEAD)
    expect_blocked 'secret introduced by merge resolution' check_commit "$merge_commit"

    printf '%s\n' blocked > .env; git add -f .env
    expect_blocked 'blocked .env filename' check_staged
    git reset -q .env; rm .env
    printf '%s\n' blocked > synthetic-credentials.txt; git add synthetic-credentials.txt
    expect_blocked 'blocked synthetic credential filename' check_staged
    git reset -q synthetic-credentials.txt; rm synthetic-credentials.txt

    printf 'SQLite format 3\000synthetic guard fixture\n' > world.realmmap
    git add -f world.realmmap
    expect_blocked 'realmmap filename' check_staged
    git reset -q world.realmmap
    printf 'SQLite format 3\000synthetic uppercase guard fixture\n' > UPPER.REALMMAP
    git add -f UPPER.REALMMAP
    expect_blocked 'uppercase realmmap filename' check_staged
    git reset -q UPPER.REALMMAP
    printf 'synthetic prefix\000ghp_dummy_token_after_nul_1234567890\n' > nul.txt
    git add nul.txt
    expect_blocked 'NUL followed by GitHub token' check_staged
    git reset -q nul.txt
  )
  echo "Realm secret guard self-test passed."
}

case "${1:-}" in
  --staged) check_staged ;;
  --staged-path) check_staged_path "${2:?path required}" ;;
  --commit-path) check_commit_path "${2:?commit required}" "${3:?path required}" ;;
  --commit) check_commit "${2:?commit required}" ;;
  --range) check_range "${2:?range required}" ;;
  --pre-push) check_pre_push ;;
  --self-test) run_self_test ;;
  *) echo "Usage: $0 --staged|--pre-push|--range RANGE|--self-test" >&2; exit 2 ;;
esac

[ "$blocked" -eq 0 ]
