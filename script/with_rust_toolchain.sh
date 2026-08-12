#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/rust_toolchain.sh"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 command [arg ...]" >&2
  exit 2
fi

if ! configure_realm_rust_toolchain; then
  echo "error: Rust toolchain is unavailable. Put cargo/rustc on PATH or install the pinned rustup toolchain." >&2
  exit 1
fi

exec "$@"
