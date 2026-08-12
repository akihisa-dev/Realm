#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WRAPPER="$SCRIPT_DIR/with_rust_toolchain.sh"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/realm-rust-toolchain.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

make_executable() {
  local path="$1"
  shift
  printf '%b\n' "$1" > "$path"
  chmod 755 "$path"
}

# Normal PATH: the existing cargo and rustc are selected without rustup.
normal_bin="$TEMP_DIR/normal-bin"
mkdir -p "$normal_bin"
make_executable "$normal_bin/cargo" '#!/bin/sh\nprintf cargo-normal'
make_executable "$normal_bin/rustc" '#!/bin/sh\nprintf rustc-normal'
normal_result="$(PATH="$normal_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'command -v cargo; command -v rustc; cargo; rustc')"
case "$normal_result" in
  *"$normal_bin/cargo"*"$normal_bin/rustc"*"cargo-normalrustc-normal"*) ;;
  *) echo "normal PATH resolution failed" >&2; exit 1 ;;
esac

# Fallback PATH: rustup supplies the active toolchain binaries.
fallback_bin="$TEMP_DIR/fallback-bin"
toolchain_bin="$TEMP_DIR/toolchain-bin"
mkdir -p "$fallback_bin" "$toolchain_bin"
make_executable "$toolchain_bin/cargo" '#!/bin/sh\nprintf cargo-rustup'
make_executable "$toolchain_bin/rustc" '#!/bin/sh\nprintf rustc-rustup'
cat > "$fallback_bin/rustup" <<EOF
#!/bin/sh
case "\${1:-}" in
  which)
    case "\${2:-}" in
      cargo) printf '%s/cargo\\n' '$toolchain_bin' ;;
      rustc) printf '%s/rustc\\n' '$toolchain_bin' ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
EOF
chmod 755 "$fallback_bin/rustup"
fallback_result="$(PATH="$fallback_bin:/usr/bin:/bin" "$WRAPPER" sh -c 'command -v cargo; command -v rustc; cargo; rustc')"
case "$fallback_result" in
  *"$toolchain_bin/cargo"*"$toolchain_bin/rustc"*"cargo-rustuprustc-rustup"*) ;;
  *) echo "rustup fallback resolution failed" >&2; exit 1 ;;
esac

# Refuse an environment with neither Cargo nor rustup.
if PATH="/usr/bin:/bin" "$WRAPPER" true >/dev/null 2>&1; then
  echo "missing Rust toolchain was not rejected" >&2
  exit 1
fi

echo "Rust toolchain resolver tests passed."
