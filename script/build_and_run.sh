#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP_DIR="$ROOT_DIR/app"
MODE="${1:-run}"
SESSION_LOCK_PATH=""
SESSION_LOCK_TOKEN=""

source "$SCRIPT_DIR/local_environment.sh"
configure_realm_local_environment "$ROOT_DIR"

usage() {
  echo "usage: $0 [run]" >&2
}

fail() {
  echo "error: $*" >&2
  exit 1
}

require_local_environment() {
  command -v node >/dev/null 2>&1 || fail "Node.js was not found. Follow docs/development.md."
  command -v pnpm >/dev/null 2>&1 || fail "pnpm was not found. Follow docs/development.md."
  [[ -d "$APP_DIR/node_modules" ]] || fail "Dependencies are not installed. Run 'cd app && pnpm install --frozen-lockfile' first."

  cd "$APP_DIR"
  pnpm runtime:check
}

state_file() {
  local state_key
  state_key="$(/usr/bin/stat -f '%d-%i' "$ROOT_DIR")"
  echo "${TMPDIR:-/tmp}/dev.akihisa.realm-${UID}-${state_key}.pid"
}

process_started_at() {
  ps -p "$1" -o lstart= 2>/dev/null || true
}

release_state_lock() {
  local current_token=""

  if [[ -n "$SESSION_LOCK_PATH" && -L "$SESSION_LOCK_PATH" ]]; then
    current_token="$(/usr/bin/readlink "$SESSION_LOCK_PATH" 2>/dev/null || true)"
    if [[ "$current_token" == "$SESSION_LOCK_TOKEN" ]]; then
      rm -f "$SESSION_LOCK_PATH"
    fi
  fi

  SESSION_LOCK_PATH=""
  SESSION_LOCK_TOKEN=""
}

acquire_state_lock() {
  local lock_path
  local owner_pid=""
  local owner_started=""
  local owner_token=""
  local current_started=""
  local launcher_started=""
  local attempt

  lock_path="$(state_file).lock"
  launcher_started="$(process_started_at "$$")"
  SESSION_LOCK_TOKEN="$$|${launcher_started:-unavailable}"

  for ((attempt = 0; attempt < 100; attempt += 1)); do
    if /bin/ln -s "$SESSION_LOCK_TOKEN" "$lock_path" 2>/dev/null; then
      SESSION_LOCK_PATH="$lock_path"
      trap release_state_lock EXIT
      return 0
    fi

    if [[ -L "$lock_path" ]]; then
      owner_token="$(/usr/bin/readlink "$lock_path" 2>/dev/null || true)"
      owner_pid="${owner_token%%|*}"
      owner_started="${owner_token#*|}"

      if [[ "$owner_pid" =~ ^[0-9]+$ ]]; then
        if [[ "$owner_started" == "unavailable" ]]; then
          if kill -0 "$owner_pid" 2>/dev/null; then
            sleep 0.05
            continue
          fi
        else
          current_started="$(process_started_at "$owner_pid")"
        fi

        if [[ "$owner_started" == "unavailable" || -z "$current_started" || "$current_started" != "$owner_started" ]]; then
          if [[ "$(/usr/bin/readlink "$lock_path" 2>/dev/null || true)" == "$owner_token" ]]; then
            rm -f "$lock_path"
          fi
          continue
        fi
      fi
    fi

    sleep 0.05
  done

  fail "another Realm development launcher is preparing a session. Try again."
}

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid

  while IFS= read -r child_pid; do
    [[ "$child_pid" =~ ^[0-9]+$ ]] || continue
    terminate_process_tree "$child_pid"
  done < <(/usr/bin/pgrep -P "$parent_pid" 2>/dev/null || true)

  kill -TERM "$parent_pid" 2>/dev/null || true
}

stop_previous_development_session() {
  local previous_pid=""
  local previous_root=""
  local previous_started=""
  local current_started=""
  local previous_command=""
  local session_state
  local attempt

  session_state="$(state_file)"
  [[ -r "$session_state" ]] || return 0

  {
    IFS= read -r previous_pid || true
    IFS= read -r previous_root || true
    IFS= read -r previous_started || true
  } < "$session_state"

  if [[ ! "$previous_pid" =~ ^[0-9]+$ || "$previous_root" != "$ROOT_DIR" ]]; then
    rm -f "$session_state"
    return 0
  fi

  if ! kill -0 "$previous_pid" 2>/dev/null; then
    rm -f "$session_state"
    return 0
  fi

  if [[ "$previous_started" == "unavailable" ]]; then
    fail "a previous Realm development session is still running, but process inspection is unavailable. Close it manually and try again."
  fi

  if [[ -z "$previous_started" ]]; then
    rm -f "$session_state"
    return 0
  fi

  current_started="$(process_started_at "$previous_pid")"
  if [[ -z "$current_started" ]]; then
    fail "the previous Realm development session cannot be inspected safely. Close it manually and try again."
  fi
  if [[ "$current_started" != "$previous_started" ]]; then
    rm -f "$session_state"
    return 0
  fi

  previous_command="$(ps -p "$previous_pid" -o command= 2>/dev/null || true)"
  if [[ "$previous_command" != *build_and_run.sh* && ( "$previous_command" != *pnpm* || "$previous_command" != *start* ) ]]; then
    fail "the previous Realm development session could not be identified safely. Close it manually and try again."
  fi

  echo "Stopping the previous Realm development session..."
  terminate_process_tree "$previous_pid"
  for ((attempt = 0; attempt < 50; attempt += 1)); do
    if ! kill -0 "$previous_pid" 2>/dev/null; then
      rm -f "$session_state"
      return 0
    fi
    sleep 0.1
  done

  fail "the previous Realm development session did not stop. Close it manually and try again."
}

if [[ $# -gt 1 ]]; then
  usage
  exit 2
fi

case "$MODE" in
  run)
    ;;
  *)
    usage
    exit 2
    ;;
esac

require_local_environment
acquire_state_lock
stop_previous_development_session

SESSION_STATE="$(state_file)"
SESSION_STARTED="$(process_started_at "$$")"
SESSION_STATE_TEMP="$SESSION_STATE.$$"
printf '%s\n%s\n%s\n' "$$" "$ROOT_DIR" "${SESSION_STARTED:-unavailable}" > "$SESSION_STATE_TEMP"
mv -f "$SESSION_STATE_TEMP" "$SESSION_STATE"

release_state_lock
trap - EXIT

echo "Starting Realm in development mode..."
exec pnpm start
