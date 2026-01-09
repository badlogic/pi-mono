#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ATO:-}" ]]; then
  printf '%s\n' "ATO is not set. Export ATO with the OAuth token." >&2
  exit 1
fi

payload_path="${1:-/Users/badlogic/workspaces/pi-mono/anthropic-oauth-test-payload.json}"

if [[ ! -f "$payload_path" ]]; then
  printf '%s\n' "Payload file not found: $payload_path" >&2
  exit 1
fi

curl -sS -D - -o /tmp/anthropic-oauth-test.json \
  -X POST "https://api.anthropic.com/v1/messages?beta=true" \
  -H "accept: application/json" \
  -H "anthropic-beta: claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14" \
  -H "anthropic-dangerous-direct-browser-access: true" \
  -H "anthropic-version: 2023-06-01" \
  -H "authorization: Bearer $ATO" \
  -H "content-type: application/json" \
  -H "user-agent: claude-cli/2.1.2 (external, cli)" \
  -H "x-app: cli" \
  -H "x-stainless-arch: arm64" \
  -H "x-stainless-helper-method: stream" \
  -H "x-stainless-lang: js" \
  -H "x-stainless-os: MacOS" \
  -H "x-stainless-package-version: 0.70.0" \
  -H "x-stainless-retry-count: 0" \
  -H "x-stainless-runtime: node" \
  -H "x-stainless-runtime-version: v25.2.1" \
  -H "x-stainless-timeout: 600" \
  --data-binary "@$payload_path"

printf '%s\n' "Response body saved to /tmp/anthropic-oauth-test.json"
