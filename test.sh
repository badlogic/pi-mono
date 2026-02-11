#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/scripts/test-no-env.mjs" "$@"
