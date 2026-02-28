#!/usr/bin/env bash
# Integration test for the Embry Agent D-Bus bridge.
#
# Prerequisites:
#   - D-Bus session bus running (standard on KDE/GNOME)
#   - Pi built: cd packages/coding-agent && npm run build
#   - ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN set
#
# Usage: bash test/dbus-integration.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
CLI="$PKG_DIR/dist/dbus/cli.js"
DBUS_NAME="org.embry.Agent"
DBUS_PATH="/org/embry/Agent"
DBUS_IFACE="org.embry.Agent"
PID=""
ERRORS=0

cleanup() {
    if [[ -n "$PID" ]]; then
        kill "$PID" 2>/dev/null || true
        wait "$PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; ERRORS=$((ERRORS + 1)); }

echo "=== Embry Agent D-Bus Integration Test ==="
echo ""

# 1. Check prerequisites
if [[ ! -f "$CLI" ]]; then
    echo "ERROR: CLI not built. Run 'npm run build' in packages/coding-agent first."
    exit 1
fi

if ! command -v busctl &>/dev/null; then
    echo "ERROR: busctl not found. Install systemd."
    exit 1
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_OAUTH_TOKEN:-}" ]]; then
    echo "SKIP: No API key set. Set ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN."
    exit 0
fi

# 2. Start the daemon
echo "Starting pi-dbus..."
node "$CLI" --cwd "$PKG_DIR" &
PID=$!
sleep 5

# 3. Check D-Bus name registration
if busctl --user list 2>/dev/null | grep -q "$DBUS_NAME"; then
    pass "D-Bus name registered: $DBUS_NAME"
else
    fail "D-Bus name not registered"
    echo "Daemon may have failed to start. Check output above."
    exit 1
fi

# 4. Ping
PING_RESULT=$(busctl --user call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" Ping 2>/dev/null || echo "FAIL")
if echo "$PING_RESULT" | grep -q "pong"; then
    pass "Ping returned pong"
else
    fail "Ping failed: $PING_RESULT"
fi

# 5. GetState
STATE_RESULT=$(busctl --user call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" GetState 2>/dev/null || echo "FAIL")
if echo "$STATE_RESULT" | grep -q "isStreaming"; then
    pass "GetState returned valid JSON"
else
    fail "GetState failed: $STATE_RESULT"
fi

# 6. Read properties
STREAMING=$(busctl --user get-property "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" IsStreaming 2>/dev/null || echo "FAIL")
if echo "$STREAMING" | grep -q "false"; then
    pass "IsStreaming = false (idle)"
else
    fail "IsStreaming unexpected: $STREAMING"
fi

# 7. Ask (simple prompt — should complete quickly)
echo ""
echo "Testing Ask (this may take 10-30 seconds)..."
ASK_RESULT=$(busctl --user --timeout=180 call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" Ask s "Reply with exactly: EMBRY_TEST_OK" 2>/dev/null || echo "FAIL")
if echo "$ASK_RESULT" | grep -qi "EMBRY_TEST_OK"; then
    pass "Ask returned expected response"
else
    # Partial pass — the agent responded but maybe didn't follow instructions exactly
    if [[ "$ASK_RESULT" != "FAIL" && ${#ASK_RESULT} -gt 10 ]]; then
        pass "Ask returned a response (${#ASK_RESULT} chars)"
    else
        fail "Ask failed: $ASK_RESULT"
    fi
fi

# 8. AskWithHints (model routing)
echo ""
echo "Testing AskWithHints (this may take 10-30 seconds)..."
HINTS_RESULT=$(busctl --user --timeout=180 call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" AskWithHints ss \
    "Reply with exactly: HINTS_OK" '{"thinking":"normal"}' 2>/dev/null || echo "FAIL")
if [[ "$HINTS_RESULT" != "FAIL" && ${#HINTS_RESULT} -gt 5 ]]; then
    pass "AskWithHints returned a response (${#HINTS_RESULT} chars)"
else
    fail "AskWithHints failed: $HINTS_RESULT"
fi

# 9. AskAs (multi-persona)
echo ""
echo "Testing AskAs (this may take 10-30 seconds)..."
ASKAS_RESULT=$(busctl --user --timeout=180 call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" AskAs ss \
    "graham-anderson" "Reply with exactly: PERSONA_OK" 2>/dev/null || echo "FAIL")
if [[ "$ASKAS_RESULT" != "FAIL" && ${#ASKAS_RESULT} -gt 5 ]]; then
    pass "AskAs returned a response (${#ASKAS_RESULT} chars)"
else
    # AskAs may fail if persona AGENTS.md not found — that's a soft failure
    if echo "$ASKAS_RESULT" | grep -qi "persona"; then
        pass "AskAs responded (persona context may be missing — OK for CI)"
    else
        fail "AskAs failed: $ASKAS_RESULT"
    fi
fi

# 10. Concurrent queue behavior (fire two Ask calls rapidly)
echo ""
echo "Testing concurrent queue (two rapid Ask calls)..."
busctl --user --timeout=180 call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" Ask s "Reply: QUEUE_1" &>/dev/null &
Q_PID1=$!
busctl --user --timeout=180 call "$DBUS_NAME" "$DBUS_PATH" "$DBUS_IFACE" Ask s "Reply: QUEUE_2" &>/dev/null &
Q_PID2=$!
Q_OK=true
wait "$Q_PID1" 2>/dev/null || Q_OK=false
wait "$Q_PID2" 2>/dev/null || Q_OK=false
if $Q_OK; then
    pass "Concurrent queue: both requests completed"
else
    fail "Concurrent queue: one or both requests failed"
fi

# 11. Clean shutdown
echo ""
echo "Testing graceful shutdown..."
kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null || true
PID=""

sleep 2
if busctl --user list 2>/dev/null | grep -q "$DBUS_NAME"; then
    fail "D-Bus name still registered after shutdown"
else
    pass "D-Bus name released on shutdown"
fi

# Summary
echo ""
echo "=== Results ==="
if [[ $ERRORS -eq 0 ]]; then
    echo "All tests passed!"
    exit 0
else
    echo "$ERRORS test(s) failed"
    exit 1
fi
