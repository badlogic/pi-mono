---
name: pi-tmux-test
description: Test pi's interactive mode via tmux. Use when you need to test TUI behavior, extensions, or interactive features programmatically.
---

# Testing Pi Interactively via tmux

Use tmux to test pi's interactive mode. This allows sending input and capturing output programmatically.

## Setup

```bash
# Kill any existing test session and create a new one
tmux kill-session -t pi-test 2>/dev/null
tmux new-session -d -s pi-test -c /Users/badlogic/workspaces/pi-mono -x 100 -y 30

# Start pi using the test script (runs via tsx, picks up source changes)
# Always use --no-session to avoid creating session files during testing
tmux send-keys -t pi-test "./pi-test.sh --no-session" Enter

# Wait for startup
sleep 4
tmux capture-pane -t pi-test -p
```

## Interaction

```bash
# Send input
tmux send-keys -t pi-test "your message here" Enter

# Wait and capture output
sleep 5
tmux capture-pane -t pi-test -p

# Send special keys
tmux send-keys -t pi-test Escape
tmux send-keys -t pi-test C-c      # Ctrl+C
tmux send-keys -t pi-test C-d      # Ctrl+D
```

## Cleanup

```bash
tmux kill-session -t pi-test
```

## Testing Extensions

Write extensions to /tmp and load with `-e`:

```bash
cat > /tmp/test-extension.ts << 'EOF'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  // extension code
}
EOF

# Run pi with the extension
tmux send-keys -t pi-test "./pi-test.sh --no-session -e /tmp/test-extension.ts" Enter
```

Clean up after testing: `rm /tmp/test-extension.ts`
