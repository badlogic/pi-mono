#!/bin/bash
# Sanity check for scillm skill
# Verifies Chutes API connectivity and basic completions work
set -e

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== scillm Skill Sanity Check ==="
echo ""

# 1. Check environment variables
echo -n "1. Environment variables... "
if [[ -z "$CHUTES_API_KEY" ]]; then
    echo "FAIL (CHUTES_API_KEY not set)"
    exit 1
fi
if [[ -z "$CHUTES_API_BASE" ]]; then
    echo "FAIL (CHUTES_API_BASE not set)"
    exit 1
fi
echo "OK"

# 2. Check scillm is importable
echo -n "2. scillm import... "
if python3 -c "from scillm import acompletion, parallel_acompletions" 2>/dev/null; then
    echo "OK"
else
    echo "FAIL (scillm not installed)"
    exit 1
fi

# 3. Test text completion (quick call)
echo -n "3. Text completion (single)... "
START=$(date +%s.%N)
RESULT=$(python3 "$SKILL_DIR/batch.py" single "Say hello in 3 words" --timeout 30 2>&1)
EXIT_CODE=$?
END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)

if [[ $EXIT_CODE -eq 0 ]] && [[ -n "$RESULT" ]]; then
    echo "OK (${ELAPSED}s)"
    echo "   Response: ${RESULT:0:50}..."
else
    echo "FAIL (exit=$EXIT_CODE)"
    echo "   Error: $RESULT"
    exit 1
fi

# 4. Test VLM availability (just check model env)
echo -n "4. VLM model configured... "
VLM_MODEL="${CHUTES_VLM_MODEL:-Qwen/Qwen3-VL-235B-A22B-Instruct}"
echo "OK ($VLM_MODEL)"

# 5. Test parallel_acompletions (2 quick prompts)
echo -n "5. Batch completion... "
BATCH_INPUT=$(mktemp)
echo '{"prompt": "Say yes"}' > "$BATCH_INPUT"
echo '{"prompt": "Say no"}' >> "$BATCH_INPUT"

START=$(date +%s.%N)
RESULT=$(python3 "$SKILL_DIR/batch.py" batch --input "$BATCH_INPUT" --timeout 30 2>&1 | tail -2)
EXIT_CODE=$?
END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)
rm -f "$BATCH_INPUT"

if [[ $EXIT_CODE -eq 0 ]]; then
    OK_COUNT=$(echo "$RESULT" | grep -c '"ok": true' || true)
    echo "OK (${ELAPSED}s, ${OK_COUNT}/2 ok)"
else
    echo "FAIL (exit=$EXIT_CODE)"
    exit 1
fi

# 6. Check Lean4 availability (optional)
echo -n "6. Lean4 prover (optional)... "
if python3 "$SKILL_DIR/prove.py" --check 2>&1 | grep -q '"ready": true'; then
    echo "OK (ready)"
else
    echo "SKIP (not configured)"
fi

echo ""
echo "=== All sanity checks passed ==="
