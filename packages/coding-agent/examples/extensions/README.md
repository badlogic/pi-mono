# Extension Examples

Example extensions for pi-coding-agent.

## Usage

```bash
# Load an extension with --extension flag
pi --extension examples/extensions/permission-gate.ts

# Or copy to extensions directory for auto-discovery
cp permission-gate.ts ~/.pi/agent/extensions/
```

## Examples

### Lifecycle & Safety

| Extension | Description |
|-----------|-------------|
| `permission-gate.ts` | Prompts for confirmation before dangerous bash commands (rm -rf, sudo, etc.) |
| `protected-paths.ts` | Blocks writes to protected paths (.env, .git/, node_modules/) |
| `confirm-destructive.ts` | Confirms before destructive session actions (clear, switch, branch) |
| `dirty-repo-guard.ts` | Prevents session changes with uncommitted git changes |

### Custom Tools

| Extension | Description |
|-----------|-------------|
| `todo.ts` | Todo list tool + `/todos` command with custom rendering and state persistence |
| `hello.ts` | Minimal custom tool example |
| `question.ts` | Demonstrates `ctx.ui.select()` for asking the user questions |
| `subagent/` | Delegate tasks to specialized subagents with isolated context windows |

### Commands & UI

| Extension | Description |
|-----------|-------------|
| `preset.ts` | Named presets for model, thinking level, tools, and instructions via `--preset` flag and `/preset` command |
| `plan-mode.ts` | Claude Code-style plan mode for read-only exploration with `/plan` command |
| `tools.ts` | Interactive `/tools` command to enable/disable tools with session persistence |
| `handoff.ts` | Transfer context to a new focused session via `/handoff <goal>` |
| `qna.ts` | Extracts questions from last response into editor via `ctx.ui.setEditorText()` |
| `status-line.ts` | Shows turn progress in footer via `ctx.ui.setStatus()` with themed colors |
| `snake.ts` | Snake game with custom UI, keyboard handling, and session persistence |
| `send-user-message.ts` | Demonstrates `pi.sendUserMessage()` for sending user messages from extensions |

### Git Integration

| Extension | Description |
|-----------|-------------|
| `git-checkpoint.ts` | Creates git stash checkpoints at each turn for code restoration on branch |
| `auto-commit-on-exit.ts` | Auto-commits on exit using last assistant message for commit message |

### System Prompt & Compaction

| Extension | Description |
|-----------|-------------|
| `pirate.ts` | Demonstrates `systemPromptAppend` to dynamically modify system prompt |
| `custom-compaction.ts` | Custom compaction that summarizes entire conversation |

### External Dependencies

| Extension | Description |
|-----------|-------------|
| `chalk-logger.ts` | Uses chalk from parent node_modules (demonstrates jiti module resolution) |
| `with-deps/` | Extension with its own package.json and dependencies |
| `file-trigger.ts` | Watches a trigger file and injects contents into conversation |

## Writing Extensions

See [docs/extensions.md](../../docs/extensions.md) for full documentation.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // Subscribe to lifecycle events
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register custom tools
  pi.registerTool({
    name: "greet",
    label: "Greeting",
    description: "Generate a greeting",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // Register commands
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify("Hello!", "info");
    },
  });
}
```

## Key Patterns

**Use StringEnum for string parameters** (required for Google API compatibility):
```typescript
import { StringEnum } from "@mariozechner/pi-ai";

// Good
action: StringEnum(["list", "add"] as const)

// Bad - doesn't work with Google
action: Type.Union([Type.Literal("list"), Type.Literal("add")])
```

**State persistence via details:**
```typescript
// Store state in tool result details for proper branching support
return {
  content: [{ type: "text", text: "Done" }],
  details: { todos: [...todos], nextId },  // Persisted in session
};

// Reconstruct on session events
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.toolName === "my_tool") {
      const details = entry.message.details;
      // Reconstruct state from details
    }
  }
});
```
