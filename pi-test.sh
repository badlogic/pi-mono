#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
npx tsx "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" "$@"
