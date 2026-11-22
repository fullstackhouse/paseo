#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"

source "$ROOT_DIR/scripts/dev-home.sh"

export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6768}"
# The daemon this window may start admits the renderer's Metro origin, so pick the port first.
if [ -z "${EXPO_PORT:-}" ]; then
  EXPO_PORT=$(NO_COLOR=1 FORCE_COLOR=0 "$ROOT_DIR/node_modules/.bin/get-port" 8082 8083 8084 8085 8086 8087 8088 8089)
fi
export EXPO_PORT
# As a Paseo service, load the renderer through its proxy URL: that origin is stable, while
# the service port changes on every start and the dev daemon admits only stable origins.
export EXPO_DEV_URL="${PASEO_URL:-http://localhost:${EXPO_PORT}}"

configure_dev_paseo_home

DEV_ROOT="${PASEO_DEV_ROOT:-$(default_dev_paseo_root)}"
export PASEO_DEV_ROOT="$DEV_ROOT"
export PASEO_DEV_RUNTIME_FALLBACK_ROOT="$DEV_ROOT"
DEV_RUNTIME="$(node "$SCRIPT_DIR/dev-runtime.mjs")"
export PASEO_ELECTRON_FLAGS="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).electronFlags)' "$DEV_RUNTIME")"
export PASEO_ELECTRON_USER_DATA_DIR="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).userDataDir)' "$DEV_RUNTIME")"
unset PASEO_DEV_RUNTIME_FALLBACK_ROOT
mkdir -p "$PASEO_ELECTRON_USER_DATA_DIR"

DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"
export PASEO_DAEMON_ENDPOINT="$DAEMON_ENDPOINT"

npm --prefix "$DESKTOP_DIR" run build:main

echo "══════════════════════════════════════════════════════"
echo "  Paseo Desktop Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:      ${EXPO_DEV_URL}"
echo "  Daemon:     ${PASEO_LISTEN}"
echo "  Origins:    ${PASEO_CORS_ORIGINS}"
if [ -n "${PASEO_DEV_LAN_URLS:-}" ]; then
  echo "  LAN:        ${PASEO_DEV_LAN_URLS} (password required)"
fi
echo "  Home:       ${PASEO_HOME}"
echo "  userData:   ${PASEO_ELECTRON_USER_DATA_DIR}"
echo "══════════════════════════════════════════════════════"

exec node "$SCRIPT_DIR/dev-runner.mjs"
