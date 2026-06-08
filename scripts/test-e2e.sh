#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-node}"
CODEX_NODE_MODULES="${CODEX_NODE_MODULES:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Set NODE_BIN=/path/to/node and retry." >&2
  exit 127
fi

if [[ -d "$CODEX_NODE_MODULES" ]]; then
  if [[ -n "${NODE_PATH:-}" ]]; then
    export NODE_PATH="$NODE_PATH:$CODEX_NODE_MODULES"
  else
    export NODE_PATH="$CODEX_NODE_MODULES"
  fi
fi

"$NODE_BIN" tests/e2e_extension.js
