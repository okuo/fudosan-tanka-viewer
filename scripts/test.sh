#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-node}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Set NODE_BIN=/path/to/node and retry." >&2
  exit 127
fi

"$NODE_BIN" --check content.js
"$NODE_BIN" --check popup.js
"$NODE_BIN" --check sidepanel.js
"$NODE_BIN" --check background.js
"$NODE_BIN" --check scripts/make-local-manifest.js
"$NODE_BIN" --check tests/e2e_extension.js
"$NODE_BIN" test_csv_export.js
"$NODE_BIN" test_background.js
bash -n scripts/build-local.sh
git diff --check

echo "npm-free test checks passed"
