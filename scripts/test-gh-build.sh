#!/bin/bash
set -e

# Simulate GH Actions build locally

cd /Users/badlogic/workspaces/pi-mono

echo "=== Cleaning node_modules ==="
rm -rf node_modules packages/*/node_modules

echo "=== npm ci ==="
npm ci

echo "=== Install cross-platform bindings (like GH Actions) ==="
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

echo "=== Build binary with cross-compile flag ==="
cd packages/coding-agent
bun build --compile --target=bun-darwin-arm64 ./dist/cli.js --outfile /tmp/pi-gh-sim/pi
cp package.json /tmp/pi-gh-sim/

echo "=== Test the binary ==="
/tmp/pi-gh-sim/pi -e /Users/badlogic/workspaces/pi-doom --help 2>&1 | head -5

echo "=== Binary size ==="
ls -la /tmp/pi-gh-sim/pi
