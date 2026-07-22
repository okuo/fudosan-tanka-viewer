#!/usr/bin/env bash
set -euo pipefail

echo "Creating distribution zip..."

# Remove dist folder if exists
rm -rf dist

# Create dist folder and copy required files
mkdir -p dist/icons
cp manifest.json background.js content.js styles.css popup.html popup.js popup.css sidepanel.html sidepanel.js sidepanel.css dist/
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png dist/icons/

# Remove old zip if exists
rm -f fudosan-tanka-viewer.zip

# Create zip file
(cd dist && zip -r ../fudosan-tanka-viewer.zip .)

# Remove dist folder
rm -rf dist

echo "Done! fudosan-tanka-viewer.zip created."
