#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WRAPPER="$SCRIPT_DIR/with_node_runtime.sh"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/realm-node-runtime.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

make_node() {
  local path="$1" version="$2"
  mkdir -p "$(dirname "$path")"
  printf '#!/bin/sh\nif [ "${1:-}" = "--version" ]; then printf "v%s\\n" "%s"; else exec /bin/sh "$@"; fi\n' "$version" "$version" > "$path"
  chmod 755 "$path"
}

wrong_bin="$TEMP_DIR/wrong/bin"
fixed_bin="$TEMP_DIR/fixed/bin"
make_node "$wrong_bin/node" "26.4.0"
make_node "$fixed_bin/node" "24.19.0"

# A Homebrew-style unlinked pinned formula is discovered from the active
# installation's sibling prefix even when `brew` itself is absent from PATH.
brew_like="$TEMP_DIR/brew-like"
make_node "$brew_like/bin/node" "26.4.0"
make_node "$brew_like/opt/node@24/bin/node" "24.19.0"
brew_like_selected="$(PATH="$brew_like/bin:/usr/bin:/bin" "$WRAPPER" sh -c 'node --version')"
[[ "$brew_like_selected" == "v24.19.0" ]] || { echo "derived Homebrew candidate selected '$brew_like_selected'" >&2; exit 1; }

# An already-correct PATH remains unchanged.
normal="$(PATH="$fixed_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'node --version')"
[[ "$normal" == "v24.19.0" ]] || { echo "normal PATH selected '$normal'" >&2; exit 1; }

# A PATH beginning with Node 26 must be repaired by selecting the later,
# repository-pinned Node 24 runtime.
selected="$(PATH="$wrong_bin:$fixed_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'node --version')"
[[ "$selected" == "v24.19.0" ]] || { echo "PATH fallback selected '$selected'" >&2; exit 1; }

# Arguments and the wrapped command's exit status must pass through unchanged.
arguments="$(PATH="$wrong_bin:$fixed_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'printf "%s" "$1"' command argument-pass)"
[[ "$arguments" == "argument-pass" ]] || { echo "wrapped arguments changed" >&2; exit 1; }

if PATH="$wrong_bin:$fixed_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'exit 17'; then
  echo "wrapped exit status was not propagated" >&2
  exit 1
else
  [[ "$?" -eq 17 ]] || { echo "wrapped exit status changed" >&2; exit 1; }
fi

# No pinned candidate is an explicit, fail-closed error rather than a retry
# loop or an accidental execution under the wrong version.
if PATH="$wrong_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'true' >/dev/null 2>&1; then
  echo "missing pinned Node runtime was accepted" >&2
  exit 1
fi

echo "Node runtime resolver tests passed."
