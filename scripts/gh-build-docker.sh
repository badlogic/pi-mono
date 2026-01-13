#!/bin/bash
set -euo pipefail

echo "=== Versions ==="
node --version
bun --version
npm --version

echo "=== Install dependencies ==="
npm ci

echo "=== Install cross-platform bindings ==="
npm install --no-save --force \
  @mariozechner/clipboard-darwin-arm64@0.3.0 \
  @mariozechner/clipboard-darwin-x64@0.3.0 \
  @mariozechner/clipboard-linux-x64-gnu@0.3.0 \
  @mariozechner/clipboard-linux-arm64-gnu@0.3.0 \
  @mariozechner/clipboard-win32-x64-msvc@0.3.0

npm install --no-save --force \
  @img/sharp-darwin-arm64@0.34.5 \
  @img/sharp-darwin-x64@0.34.5 \
  @img/sharp-linux-x64@0.34.5 \
  @img/sharp-linux-arm64@0.34.5 \
  @img/sharp-win32-x64@0.34.5 \
  @img/sharp-libvips-darwin-arm64@1.2.4 \
  @img/sharp-libvips-darwin-x64@1.2.4 \
  @img/sharp-libvips-linux-x64@1.2.4 \
  @img/sharp-libvips-linux-arm64@1.2.4

echo "=== Build all packages ==="
npm run build

echo "=== Build darwin-arm64 binary ==="
mkdir -p /repo/.tmp
cd packages/coding-agent
bun build --compile --target=bun-darwin-arm64 ./dist/cli.js --outfile /repo/.tmp/pi-darwin-arm64

echo "=== Done ==="
ls -la /repo/.tmp/pi-darwin-arm64
