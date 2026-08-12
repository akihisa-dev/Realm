#!/usr/bin/env bash

# Resolve the repository's active Rust toolchain without changing any user
# configuration.  A Cargo already visible on PATH always wins; rustup is only
# consulted when that command is unavailable.

realm_rust_toolchain_bin() {
  local cargo_command=""
  local rustup_command=""

  cargo_command="$(command -v cargo 2>/dev/null || true)"
  if [[ -n "$cargo_command" ]]; then
    dirname "$cargo_command"
    return 0
  fi

  rustup_command="$(command -v rustup 2>/dev/null || true)"
  [[ -n "$rustup_command" ]] || return 1

  cargo_command="$("$rustup_command" which cargo 2>/dev/null || true)"
  [[ -x "$cargo_command" ]] || return 1
  dirname "$cargo_command"
}

configure_realm_rust_toolchain() {
  local toolchain_bin=""
  local rustc_command=""

  toolchain_bin="$(realm_rust_toolchain_bin)" || return 1
  if [[ ":${PATH:-}:" != *":$toolchain_bin:"* ]]; then
    export PATH="$toolchain_bin${PATH:+:$PATH}"
  fi

  command -v cargo >/dev/null 2>&1 || return 1
  rustc_command="$(command -v rustc 2>/dev/null || true)"
  if [[ -z "$rustc_command" ]]; then
    local rustup_command=""
    rustup_command="$(command -v rustup 2>/dev/null || true)"
    if [[ -n "$rustup_command" ]]; then
      rustc_command="$("$rustup_command" which rustc 2>/dev/null || true)"
      if [[ -x "$rustc_command" ]]; then
        local rustc_bin
        rustc_bin="$(dirname "$rustc_command")"
        if [[ ":${PATH:-}:" != *":$rustc_bin:"* ]]; then
          export PATH="${PATH:+$PATH:}$rustc_bin"
        fi
      fi
    fi
  fi

  command -v rustc >/dev/null 2>&1
}
