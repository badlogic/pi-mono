# Hooks Examples

Example hooks for pi-coding-agent.

## Usage

```bash
# Load a hook with --hook flag
pi --hook examples/hooks/permission-gate.ts

# Or copy to hooks directory for auto-discovery
cp permission-gate.ts ~/.pi/agent/hooks/
```

## Examples

| Hook | Description |
|------|-------------|
| `permission-gate.ts` | Prompts for confirmation before dangerous bash commands (rm -rf, sudo, etc.) |
| `git-checkpoint.ts` | Creates git stash checkpoints at each turn for code restoration on branch |
| `protected-paths.ts` | Blocks writes to protected paths (.env, .git/, node_modules/) |
| `file-trigger.ts` | Watches a trigger file and injects contents into conversation |
| `confirm-destructive.ts` | Confirms before destructive session actions (clear, switch, branch) |
| `dirty-repo-guard.ts` | Prevents session changes with uncommitted git changes |
| `auto-commit-on-exit.ts` | Auto-commits on exit using last assistant message for commit message |
| `custom-compaction.ts` | Custom compaction that summarizes entire conversation |
| `qna.ts` | Extracts questions from last response into editor via `ctx.ui.setEditorText()` |
| `snake.ts` | Snake game with custom UI, keyboard handling, and session persistence |
| `status-line.ts` | Shows turn progress in footer via `ctx.ui.setStatus()` with themed colors |

## Writing Hooks

See [docs/hooks.md](../../docs/hooks.md) for full documentation.

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  // Subscribe to events
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register custom commands
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify("Hello!", "info");
    },
  });
}
```
