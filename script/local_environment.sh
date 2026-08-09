configure_realm_local_environment() {
  local repository_root="$1"
  local brew_binary=""
  local brew_prefix=""
  local node_formula=""
  local node_major=""
  local node_prefix=""
  local rustup_prefix=""
  local leading_paths=""
  local trailing_path=""
  local current_path="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

  export pnpm_config_verify_deps_before_run=error

  if command -v brew >/dev/null 2>&1; then
    brew_binary="$(command -v brew)"
  elif [[ -x /opt/homebrew/bin/brew ]]; then
    brew_binary="/opt/homebrew/bin/brew"
  else
    return 0
  fi

  IFS=. read -r node_major _ < "$repository_root/.node-version"
  node_formula="node@$node_major"

  brew_prefix="$("$brew_binary" --prefix 2>/dev/null || true)"
  node_prefix="$("$brew_binary" --prefix "$node_formula" 2>/dev/null || true)"
  rustup_prefix="$("$brew_binary" --prefix rustup 2>/dev/null || true)"

  if [[ -n "$node_prefix" && -d "$node_prefix/bin" ]]; then
    leading_paths="$node_prefix/bin"
  fi
  if [[ -n "$rustup_prefix" && -d "$rustup_prefix/bin" ]]; then
    leading_paths="${leading_paths:+$leading_paths:}$rustup_prefix/bin"
  fi
  if [[ -n "$brew_prefix" && -d "$brew_prefix/bin" ]]; then
    trailing_path=":$brew_prefix/bin"
  fi

  export PATH="${leading_paths:+$leading_paths:}$current_path$trailing_path"
}
