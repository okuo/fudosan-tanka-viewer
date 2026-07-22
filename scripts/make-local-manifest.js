#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const manifestPath = process.argv[2];

if (!manifestPath) {
  console.error('Usage: node scripts/make-local-manifest.js <manifest-path>');
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest file was not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '0.0.0';

manifest.name = '坪たん LOCAL';
manifest.short_name = '坪たん Dev';
manifest.version_name = `${version}-local`;
manifest.description = `[LOCAL] ${manifest.description || ''}`;
manifest.action = {
  ...(manifest.action || {}),
  default_title: '坪たん LOCAL'
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Updated local manifest: ${path.relative(process.cwd(), manifestPath)}`);
