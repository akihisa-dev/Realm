#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP_DIR="$ROOT_DIR/app"

source "$SCRIPT_DIR/local_environment.sh"
configure_realm_local_environment "$ROOT_DIR"

fail() {
  echo "error: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js was not found. Follow docs/development.md."
command -v pnpm >/dev/null 2>&1 || fail "pnpm was not found. Follow docs/development.md."
[[ -d "$APP_DIR/node_modules" ]] || fail "Dependencies are not installed. Run 'cd app && pnpm install --frozen-lockfile' first."

cd "$APP_DIR"
pnpm runtime:check

echo "Building the Realm macOS application and DMG..."
pnpm build:mac
pnpm package:check

echo "Build completed: app/out/darwin/"
