# Hooks Examples

Example hooks for pi-coding-agent.

## Examples

### permission-gate.ts
Prompts for confirmation before running dangerous bash commands (rm -rf, sudo, chmod 777, etc.).

### git-checkpoint.ts
Creates git stash checkpoints at each turn, allowing code restoration when branching.

### protected-paths.ts
Blocks writes to protected paths (.env, .git/, node_modules/).

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
    // event.reason: "start" | "switch" | "clear"
    // ctx.ui, ctx.exec, ctx.cwd, ctx.sessionFile, ctx.hasUI
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
- `session` - startup, session switch, clear
- `branch` - before branching (can skip conversation restore)
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
