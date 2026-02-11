#!/bin/bash
# Sanity check for fetcher skill
# Verifies fetcher can fetch pages and Playwright is available
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$SCRIPT_DIR/run.sh"

echo "=== Fetcher Skill Sanity Check ==="
echo ""

# 1. Check run.sh exists and is executable
echo -n "1. run.sh executable... "
if [[ -x "$RUN" ]]; then
    echo "OK"
else
    echo "FAIL (run.sh not executable)"
    exit 1
fi

# 2. Check uvx is available
echo -n "2. uvx available... "
if command -v uvx &>/dev/null; then
    echo "OK ($(uvx --version 2>/dev/null | head -1))"
else
    echo "FAIL (uvx not found - install uv)"
    exit 1
fi

# 3. Check fetcher can run (--help)
echo -n "3. Fetcher runs... "
if "$RUN" --help 2>&1 | grep -qi "fetcher"; then
    echo "OK"
else
    echo "FAIL (fetcher not working)"
    exit 1
fi

# 4. Check fetcher doctor
echo -n "4. Fetcher doctor... "
DOCTOR_OUTPUT=$("$RUN" doctor 2>&1 || true)
if echo "$DOCTOR_OUTPUT" | grep -q "playwright.*ok"; then
    echo "OK (Playwright available)"
    PLAYWRIGHT_OK=1
else
    echo "WARN (Playwright not ready)"
    echo "      Run: uvx --from 'git+https://github.com/grahama1970/fetcher.git' playwright install chromium"
    PLAYWRIGHT_OK=0
fi

# 5. Test fetch on simple page (if we have network)
echo -n "5. Simple fetch test... "
OUT_DIR="/tmp/fetcher-sanity-$$"
if FETCHER_HTTP_CACHE_DISABLE=1 "$RUN" get https://example.com --out "$OUT_DIR" 2>/dev/null; then
    if [[ -f "$OUT_DIR/consumer_summary.json" ]]; then
        VERDICT=$(grep -o '"verdict": "[^"]*"' "$OUT_DIR/consumer_summary.json" | head -1 | cut -d'"' -f4)
        echo "OK (verdict: $VERDICT)"
    else
        echo "WARN (no summary produced)"
    fi
    rm -rf "$OUT_DIR" 2>/dev/null || true
else
    echo "WARN (fetch failed - may need network)"
    rm -rf "$OUT_DIR" 2>/dev/null || true
fi

# 6. Check SPA domain support (just verify code path)
echo -n "6. SPA fallback domains... "
if uvx --from "git+https://github.com/grahama1970/fetcher.git" python -c "
from fetcher.workflows.web_fetch import SPA_FALLBACK_DOMAINS
assert 'antigravity.google' in SPA_FALLBACK_DOMAINS
print('OK')
" 2>/dev/null; then
    :
else
    echo "WARN (antigravity.google not in SPA domains)"
fi

echo ""
if [[ "$PLAYWRIGHT_OK" == "1" ]]; then
    echo "=== All sanity checks passed ==="
else
    echo "=== Sanity checks passed (Playwright warning) ==="
    echo "    For SPA/JS page support, install Playwright browsers."
fi
