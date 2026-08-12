#!/usr/bin/env bash
set -Eeuo pipefail

# Run a command with the exact Node.js version declared by the repository.
# The resolver is deliberately local-only: it never downloads or changes a
# version manager, and it validates every candidate before selecting it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 command [arg ...]" >&2
  exit 2
fi

expected_node_version() {
  local version
  version="$(tr -d '[:space:]' < "$ROOT_DIR/.node-version")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "error: .node-version must contain a strict Node.js version (found '$version')." >&2
    return 1
  }
  printf '%s\n' "$version"
}

node_version() {
  local candidate="$1"
  "$candidate" --version 2>/dev/null | sed -nE 's/^v?([0-9]+\.[0-9]+\.[0-9]+).*$/\1/p' | head -n 1
}

is_expected_node() {
  local candidate="$1" expected="$2" found
  [[ -x "$candidate" ]] || return 1
  found="$(node_version "$candidate")"
  [[ "$found" == "$expected" ]]
}

candidate_node() {
  local candidate="$1" expected="$2"
  if is_expected_node "$candidate" "$expected"; then
    return 0
  fi
  return 1
}

path_node_candidate() {
  local expected="$1" entry candidate
  local path_value="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || entry="."
    candidate="$entry/node"
    if candidate_node "$candidate" "$expected"; then
      dirname "$candidate"
      return 0
    fi
  done < <(printf '%s' "$path_value" | tr ':' '\n')
  return 1
}

resolve_node_bin() {
  local expected="$1" current_node current_bin candidate prefix brew_binary
  local major="${expected%%.*}"

  current_node="$(command -v node 2>/dev/null || true)"
  if [[ -n "$current_node" ]] && candidate_node "$current_node" "$expected"; then
    dirname "$current_node"
    return 0
  fi

  # An explicit, process-local override is useful for non-standard installs;
  # it is still required to report the repository's exact version.
  if [[ -n "${REALM_NODE_BIN:-}" ]] && candidate_node "$REALM_NODE_BIN" "$expected"; then
    dirname "$REALM_NODE_BIN"
    return 0
  fi

  # Version-manager locations are derived from their environment, never
  # committed machine-specific paths.
  if [[ -n "${NVM_DIR:-}" ]] && candidate_node "$NVM_DIR/versions/node/v$expected/bin/node" "$expected"; then
    printf '%s\n' "$NVM_DIR/versions/node/v$expected/bin"
    return 0
  fi
  if [[ -n "${ASDF_DATA_DIR:-}" ]] && candidate_node "$ASDF_DATA_DIR/installs/nodejs/$expected/bin/node" "$expected"; then
    printf '%s\n' "$ASDF_DATA_DIR/installs/nodejs/$expected/bin"
    return 0
  fi

  # Homebrew exposes an unversioned `bin/node` symlink even when the pinned
  # formula is not linked. Derive its sibling `opt` prefix without assuming
  # an Intel or Apple Silicon installation directory.
  if [[ -n "$current_node" ]]; then
    current_bin="$(dirname "$current_node")"
    candidate="$current_bin/../opt/node@$major/bin/node"
    if candidate_node "$candidate" "$expected"; then
      printf '%s\n' "$(dirname "$candidate")"
      return 0
    fi
  fi

  # Homebrew's prefix is discovered through the executable visible to this
  # process, so the resolver works on either supported macOS architecture.
  brew_binary="$(command -v brew 2>/dev/null || true)"
  if [[ -n "$brew_binary" ]]; then
    prefix="$("$brew_binary" --prefix "node@$major" 2>/dev/null || true)"
    if [[ -n "$prefix" ]] && candidate_node "$prefix/bin/node" "$expected"; then
      printf '%s\n' "$prefix/bin"
      return 0
    fi
  fi

  # PATH may contain a second, pinned installation after an unpinned one.
  path_node_candidate "$expected" && return 0

  # A version manager can expose its selected binary without making its bin
  # directory visible on PATH. Validate the reported path before using it.
  for manager in mise asdf volta; do
    if command -v "$manager" >/dev/null 2>&1; then
      candidate="$("$manager" which node 2>/dev/null || true)"
      if [[ -n "$candidate" ]] && candidate_node "$candidate" "$expected"; then
        dirname "$candidate"
        return 0
      fi
    fi
  done

  return 1
}

expected="$(expected_node_version)"
node_bin="$(resolve_node_bin "$expected" || true)"
if [[ -z "$node_bin" ]]; then
  current="$(command -v node 2>/dev/null || true)"
  found=""
  [[ -n "$current" ]] && found="$(node_version "$current")"
  echo "error: Node.js $expected is required for Realm verification; found ${found:-none}." >&2
  echo "Install or activate that exact version with a local version manager, then retry; no runtime was downloaded." >&2
  exit 1
fi

export PATH="$node_bin${PATH:+:$PATH}"

# If a caller supplied an absolute node path, replace it with the validated
# candidate as well; otherwise a stale shebang could bypass the selected PATH.
if [[ "${1##*/}" == "node" ]]; then
  set -- "$node_bin/node" "${@:2}"
fi

exec "$@"
