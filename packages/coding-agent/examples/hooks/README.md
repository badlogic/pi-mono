# Hooks Examples

Example hooks for pi-coding-agent.

## Examples

### permission-gate.ts
Prompts for confirmation before running dangerous bash commands (rm -rf, sudo, chmod 777, etc.).

### git-checkpoint.ts
Creates git stash checkpoints at each turn, allowing code restoration when branching.

### protected-paths.ts
Blocks writes to protected paths (.env, .git/, node_modules/).

### file-trigger.ts
Watches a trigger file and injects its contents into the conversation. Useful for external systems (CI, file watchers, webhooks) to send messages to the agent.

### confirm-destructive.ts
Prompts for confirmation before destructive session actions (clear, switch, branch). Demonstrates how to cancel `before_*` session events.

### dirty-repo-guard.ts
Prevents session changes when there are uncommitted git changes. Blocks clear/switch/branch until you commit.

### auto-commit-on-exit.ts
Automatically commits changes when the agent exits (shutdown event). Uses the last assistant message to generate a commit message.

## Usage

```bash
# Test directly
pi --hook examples/hooks/permission-gate.ts

# Or copy to hooks directory for persistent use
cp permission-gate.ts ~/.pi/agent/hooks/
```

## Writing Hooks

See [docs/hooks.md](../../docs/hooks.md) for full documentation.

### Key Points

**Hook structure:**
```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session", async (event, ctx) => {
    // event.reason: "start" | "before_switch" | "switch" | "before_clear" | "clear" |
    //               "before_branch" | "branch" | "shutdown"
    // event.targetTurnIndex: number (only for before_branch/branch)
    // ctx.ui, ctx.exec, ctx.cwd, ctx.sessionFile, ctx.hasUI

    // Cancel before_* actions:
    if (event.reason === "before_clear") {
      return { cancel: true };
    }
    return undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    // Can block tool execution
    if (dangerous) {
      return { block: true, reason: "Blocked" };
    }
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    // Can modify result
    return { result: "modified result" };
  });
}
```

**Available events:**
- `session` - lifecycle events with before/after variants (can cancel before_* actions)
- `agent_start` / `agent_end` - per user prompt
- `turn_start` / `turn_end` - per LLM turn
- `tool_call` - before tool execution (can block)
- `tool_result` - after tool execution (can modify)

**UI methods:**
```typescript
const choice = await ctx.ui.select("Title", ["Option A", "Option B"]);
const confirmed = await ctx.ui.confirm("Title", "Are you sure?");
const input = await ctx.ui.input("Title", "placeholder");
ctx.ui.notify("Message", "info"); // or "warning", "error"
```

**Sending messages:**
```typescript
pi.send("Message to inject into conversation");
```
