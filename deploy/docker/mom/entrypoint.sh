#!/usr/bin/env bash
set -euo pipefail

cd /repo
DATA_DIR="${MOM_DATA_DIR:-/data}"

# Install/build every start is simplest but slower.
# This heuristic is readable and usually fine.
if [[ ! -d node_modules ]]; then
  echo "[mom] npm install..."
  npm install
fi

#echo "[mom] npm run build..."
#npm run build

echo "[mom] Starting Terminal 1: (root) npm run dev"
npm run dev &
ROOT_PID=$!

echo "[mom] Starting Terminal 2: (mom) tsx watch"
cd packages/mom
exec npx tsx --watch-path src --watch src/main.ts --sandbox=docker:mom-sandbox "$DATA_DIR"
