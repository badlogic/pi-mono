#!/usr/bin/env bash
set -euo pipefail

npx tsx packages/coding-agent/src/cli.ts "$@"
