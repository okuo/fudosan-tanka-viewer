#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-node}"

require_exact_line() {
  local root="$1"
  local file="$2"
  local expected="$3"
  if ! grep -Fqx -- "$expected" "$root/$file"; then
    echo "Missing exact release wiring in $file: $expected" >&2
    return 1
  fi
}

assert_release_wiring() {
  local root="${1:-.}"

  for file in property-matcher.js observed-listings-store.js; do
    grep -q "$file" "$root/build.sh"
    grep -q "$file" "$root/build.ps1"
    grep -q "$file" "$root/scripts/build-local.sh"
    grep -q "$file" "$root/.github/workflows/ci.yml"
    grep -q "$file" "$root/.github/workflows/release.yml"
  done

  require_exact_line "$root" build.sh 'cp manifest.json property-matcher.js observed-listings-store.js background.js content.js styles.css popup.html popup.js popup.css sidepanel.html sidepanel.js sidepanel.css dist/'
  require_exact_line "$root" build.ps1 'Copy-Item "property-matcher.js" "dist/"'
  require_exact_line "$root" build.ps1 'Copy-Item "observed-listings-store.js" "dist/"'
  require_exact_line "$root" scripts/build-local.sh '  property-matcher.js'
  require_exact_line "$root" scripts/build-local.sh '  observed-listings-store.js'
  require_exact_line "$root" .github/workflows/ci.yml '          for f in property-matcher.js observed-listings-store.js background.js content.js styles.css manifest.json popup.html popup.js popup.css sidepanel.html sidepanel.js sidepanel.css icons/icon16.png icons/icon48.png icons/icon128.png; do'
  require_exact_line "$root" .github/workflows/ci.yml '          node --check property-matcher.js'
  require_exact_line "$root" .github/workflows/ci.yml '          node --check observed-listings-store.js'
  require_exact_line "$root" .github/workflows/ci.yml '          node test_property_matcher.js'
  require_exact_line "$root" .github/workflows/ci.yml '          node test_observed_listings_store.js'
  require_exact_line "$root" .github/workflows/release.yml '          node --check property-matcher.js'
  require_exact_line "$root" .github/workflows/release.yml '          node --check observed-listings-store.js'
  require_exact_line "$root" .github/workflows/release.yml '          node test_property_matcher.js'
  require_exact_line "$root" .github/workflows/release.yml '          node test_observed_listings_store.js'
}

if [ "${1:-}" = "--check-release-wiring" ]; then
  assert_release_wiring "${2:-.}"
  exit 0
fi

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Set NODE_BIN=/path/to/node and retry." >&2
  exit 127
fi

"$NODE_BIN" --check property-matcher.js
"$NODE_BIN" --check observed-listings-store.js
"$NODE_BIN" --check content.js
"$NODE_BIN" --check popup.js
"$NODE_BIN" --check sidepanel.js
"$NODE_BIN" --check background.js
"$NODE_BIN" --check scripts/make-local-manifest.js
"$NODE_BIN" --check tests/e2e_extension.js

assert_release_wiring .

"$NODE_BIN" test_property_matcher.js
"$NODE_BIN" test_observed_listings_store.js
"$NODE_BIN" test_csv_export.js
"$NODE_BIN" test_background.js
bash -n scripts/build-local.sh
git diff --check

echo "npm-free test checks passed"
