#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-node}"
DIST_DIR="${1:-dist/local}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Set NODE_BIN=/path/to/node and retry." >&2
  exit 127
fi

mkdir -p "$DIST_DIR/icons"

files=(
  manifest.json
  background.js
  content.js
  styles.css
  popup.html
  popup.js
  popup.css
  sidepanel.html
  sidepanel.js
  sidepanel.css
)

for file in "${files[@]}"; do
  cp "$file" "$DIST_DIR/$file"
done

cp icons/icon16.png "$DIST_DIR/icons/icon16.png"
cp icons/icon32.png "$DIST_DIR/icons/icon32.png"
cp icons/icon48.png "$DIST_DIR/icons/icon48.png"
cp icons/icon128.png "$DIST_DIR/icons/icon128.png"

"$NODE_BIN" scripts/make-local-manifest.js "$DIST_DIR/manifest.json"

echo "Local extension build is ready: $DIST_DIR"
echo "Load this folder from chrome://extensions/ as an unpacked extension."
