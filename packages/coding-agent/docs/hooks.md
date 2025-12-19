# Hooks

Hooks are TypeScript modules that extend the coding agent's behavior by subscribing to lifecycle events. They can intercept tool calls, prompt the user for input, modify results, and more.

**Example use cases:**
- Block dangerous commands (permission gates for `rm -rf`, `sudo`, etc.)
- Checkpoint code state (git stash at each turn, restore on `/branch`)
- Protect paths (block writes to `.env`, `node_modules/`, etc.)
- Modify tool output (filter or transform results before the LLM sees them)
- Inject messages from external sources (file watchers, webhooks, CI systems)

See [examples/hooks/](../examples/hooks/) for working implementations.

## Hook Locations

Hooks are automatically discovered from two locations:

1. **Global hooks**: `~/.pi/agent/hooks/*.ts`
2. **Project hooks**: `<cwd>/.pi/hooks/*.ts`

All `.ts` files in these directories are loaded automatically. Project hooks let you define project-specific behavior (similar to `.pi/AGENTS.md`).

You can also load a specific hook file directly using the `--hook` flag:

```bash
pi --hook ./my-hook.ts
```

This is useful for testing hooks without placing them in the standard directories.

### Additional Configuration

You can also add explicit hook paths in `~/.pi/agent/settings.json`:

```json
{
  "hooks": [
    "/path/to/custom/hook.ts"
  ],
  "hookTimeout": 30000
}
```

- `hooks`: Additional hook file paths (supports `~` expansion)
- `hookTimeout`: Timeout in milliseconds for hook operations (default: 30000). Does not apply to `tool_call` events, which have no timeout since they may prompt the user.

## Available Imports

Hooks can import from these packages (automatically resolved by pi):

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent/hooks` | Hook types (`HookAPI`, etc.) |
| `@mariozechner/pi-coding-agent` | Additional types if needed |
| `@mariozechner/pi-ai` | AI utilities (`ToolResultMessage`, etc.) |
| `@mariozechner/pi-tui` | TUI components (for advanced use cases) |
| `@sinclair/typebox` | Schema definitions |

Node.js built-in modules (`node:fs`, `node:path`, etc.) are also available.

## Writing a Hook

A hook is a TypeScript file that exports a default function. The function receives a `HookAPI` object used to subscribe to events.

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session", async (event, ctx) => {
    ctx.ui.notify(`Session ${event.reason}: ${ctx.sessionFile ?? "ephemeral"}`, "info");
  });
}
```

### Setup

Create a hooks directory:

```bash
# Global hooks
mkdir -p ~/.pi/agent/hooks

# Or project-local hooks
mkdir -p .pi/hooks
```

Then create `.ts` files directly in these directories. Hooks are loaded using [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation. The import from `@mariozechner/pi-coding-agent/hooks` resolves to the globally installed package automatically.

## Events

### Lifecycle

```
pi starts
  │
  ├─► session (reason: "start")
  │
  ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► agent_start                                          │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   │                                            │       │
  │   │   LLM responds, may call tools:            │       │
  │   │     ├─► tool_call (can block)              │       │
  │   │     │   tool executes                      │       │
  │   │     └─► tool_result (can modify)           │       │
  │   │                                            │       │
  │   └─► turn_end                                 │       │
  │                                                        │
  └─► agent_end                                            │
                                                           │
user sends another prompt ◄────────────────────────────────┘

user branches (/branch)
  │
  ├─► branch (BEFORE branch, can control)
  └─► session (reason: "switch", AFTER branch)

user switches session (/session)
  │
  └─► session (reason: "switch")

user clears session (/clear)
  │
  └─► session (reason: "clear")
```

A **turn** is one LLM response plus any tool calls. Complex tasks loop through multiple turns until the LLM responds without calling tools.

### session

Fired on startup and when session changes.

```typescript
pi.on("session", async (event, ctx) => {
  // event.entries: SessionEntry[] - all session entries
  // event.sessionFile: string | null - current session file (null with --no-session)
  // event.previousSessionFile: string | null - previous session file
  // event.reason: "start" | "switch" | "clear"
});
```

**Reasons:**
- `start`: Initial session load on startup
- `switch`: User switched sessions (`/session`) or branched (`/branch`)
- `clear`: User cleared the session (`/clear`)

### branch

Fired BEFORE a branch happens. Can control branch behavior.

```typescript
pi.on("branch", async (event, ctx) => {
  // event.targetTurnIndex: number
  // event.entries: SessionEntry[]
  return { skipConversationRestore: true }; // or undefined
});
```

Note: After branch completes, a `session` event fires with `reason: "switch"`.

### agent_start / agent_end

Fired once per user prompt.

```typescript
pi.on("agent_start", async (event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages: AppMessage[] - new messages from this prompt
});
```

### turn_start / turn_end

Fired for each turn within an agent loop.

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex: number
  // event.timestamp: number
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex: number
  // event.message: AppMessage - assistant's response
  // event.toolResults: ToolResultMessage[] - tool results from this turn
});
```

### tool_call

Fired before tool executes. **Can block.** No timeout (user prompts can take any time).

```typescript
pi.on("tool_call", async (event, ctx) => {
  // event.toolName: string (built-in or custom tool name)
  // event.toolCallId: string
  // event.input: Record<string, unknown>
  return { block: true, reason: "..." }; // or undefined to allow
});
```

Built-in tool inputs:
- `bash`: `{ command, timeout? }`
- `read`: `{ path, offset?, limit? }`
- `write`: `{ path, content }`
- `edit`: `{ path, oldText, newText }`
- `ls`: `{ path?, limit? }`
- `find`: `{ pattern, path?, limit? }`
- `grep`: `{ pattern, path?, glob?, ignoreCase?, literal?, context?, limit? }`

Custom tools are also intercepted with their own names and input schemas.

### tool_result

Fired after tool executes. **Can modify result.**

```typescript
pi.on("tool_result", async (event, ctx) => {
  // event.toolName: string
  // event.toolCallId: string
  // event.input: Record<string, unknown>
  // event.content: (TextContent | ImageContent)[]
  // event.details: tool-specific (see below)
  // event.isError: boolean
  
  // Return modified content/details, or undefined to keep original
  return { content: [...], details: {...} };
});
```

The event type is a discriminated union based on `toolName`. Use the provided type guards to narrow `details` to the correct type:

```typescript
import { isBashToolResult, type HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (isBashToolResult(event)) {
      // event.details is BashToolDetails | undefined
      if (event.details?.truncation?.truncated) {
        // Access full output from temp file
        const fullPath = event.details.fullOutputPath;
      }
    }
  });
}
```

Available type guards: `isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`.

#### Tool Details Types

Each built-in tool has a typed `details` field. Types are exported from `@mariozechner/pi-coding-agent`:

| Tool | Details Type | Source |
|------|-------------|--------|
| `bash` | `BashToolDetails` | `src/core/tools/bash.ts` |
| `read` | `ReadToolDetails` | `src/core/tools/read.ts` |
| `edit` | `undefined` | - |
| `write` | `undefined` | - |
| `grep` | `GrepToolDetails` | `src/core/tools/grep.ts` |
| `find` | `FindToolDetails` | `src/core/tools/find.ts` |
| `ls` | `LsToolDetails` | `src/core/tools/ls.ts` |

Common fields in details:
- `truncation?: TruncationResult` - present when output was truncated
- `fullOutputPath?: string` - path to temp file with full output (bash only)

`TruncationResult` contains:
- `truncated: boolean` - whether truncation occurred
- `truncatedBy: "lines" | "bytes" | null` - which limit was hit
- `totalLines`, `totalBytes` - original size
- `outputLines`, `outputBytes` - truncated size

Custom tools use `CustomToolResultEvent` with `details: unknown`. Create your own type guard to get full type safety:

```typescript
import { 
  isBashToolResult,
  type CustomToolResultEvent,
  type HookAPI,
  type ToolResultEvent,
} from "@mariozechner/pi-coding-agent/hooks";

interface MyCustomToolDetails {
  someField: string;
}

// Type guard that narrows both toolName and details
function isMyCustomToolResult(e: ToolResultEvent): e is CustomToolResultEvent & { 
  toolName: "my-custom-tool"; 
  details: MyCustomToolDetails;
} {
  return e.toolName === "my-custom-tool";
}

export default function (pi: HookAPI) {
  pi.on("tool_result", async (event, ctx) => {
    // Built-in tool: use provided type guard
    if (isBashToolResult(event)) {
      if (event.details?.fullOutputPath) {
        console.log(`Full output at: ${event.details.fullOutputPath}`);
      }
    }

    // Custom tool: use your own type guard
    if (isMyCustomToolResult(event)) {
      // event.details is now MyCustomToolDetails
      console.log(event.details.someField);
    }
  });
}
```

**Note:** If you modify `content`, you should also update `details` accordingly. The TUI uses `details` (e.g., truncation info) for rendering, so inconsistent values will cause display issues.

## Context API

Every event handler receives a context object with these methods:

### ctx.ui.select(title, options)

Show a selector dialog. Returns the selected option or `null` if cancelled.

```typescript
const choice = await ctx.ui.select("Pick one:", ["Option A", "Option B"]);
if (choice === "Option A") {
  // ...
}
```

### ctx.ui.confirm(title, message)

Show a confirmation dialog. Returns `true` if confirmed, `false` otherwise.

```typescript
const confirmed = await ctx.ui.confirm("Delete file?", "This cannot be undone.");
if (confirmed) {
  // ...
}
```

### ctx.ui.input(title, placeholder?)

Show a text input dialog. Returns the input string or `null` if cancelled.

```typescript
const name = await ctx.ui.input("Enter name:", "default value");
```

### ctx.ui.notify(message, type?)

Show a notification. Type can be `"info"`, `"warning"`, or `"error"`.

```typescript
ctx.ui.notify("Operation complete", "info");
ctx.ui.notify("Something went wrong", "error");
```

### ctx.exec(command, args)

Execute a command and get the result.

```typescript
const result = await ctx.exec("git", ["status"]);
// result.stdout: string
// result.stderr: string
// result.code: number
```

### ctx.cwd

The current working directory.

```typescript
console.log(`Working in: ${ctx.cwd}`);
```

### ctx.sessionFile

Path to the current session file, or `null` when running with `--no-session` (ephemeral mode).

```typescript
if (ctx.sessionFile) {
  console.log(`Session: ${ctx.sessionFile}`);
}
```

### ctx.hasUI

Whether interactive UI is available. `false` in print and RPC modes.

```typescript
if (ctx.hasUI) {
  const choice = await ctx.ui.select("Pick:", ["A", "B"]);
} else {
  // Fall back to default behavior
}
```

## Sending Messages

Hooks can inject messages into the agent session using `pi.send()`. This is useful for:

- Waking up the agent when an external event occurs (file change, CI result, etc.)
- Async debugging (inject debug output from other processes)
- Triggering agent actions from external systems

```typescript
pi.send(text: string, attachments?: Attachment[]): void
```

If the agent is currently streaming, the message is queued. Otherwise, a new agent loop starts immediately.

### Example: File Watcher

```typescript
import * as fs from "node:fs";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session", async (event, ctx) => {
    if (event.reason !== "start") return;
    
    // Watch a trigger file
    const triggerFile = "/tmp/agent-trigger.txt";
    
    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          pi.send(`External trigger: ${content}`);
          fs.writeFileSync(triggerFile, ""); // Clear after reading
        }
      } catch {
        // File might not exist yet
      }
    });
    
    ctx.ui.notify("Watching /tmp/agent-trigger.txt", "info");
  });
}
```

To trigger: `echo "Run the tests" > /tmp/agent-trigger.txt`

### Example: HTTP Webhook

```typescript
import * as http from "node:http";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session", async (event, ctx) => {
    if (event.reason !== "start") return;
    
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        pi.send(body || "Webhook triggered");
        res.writeHead(200);
        res.end("OK");
      });
    });
    
    server.listen(3333, () => {
      ctx.ui.notify("Webhook listening on http://localhost:3333", "info");
    });
  });
}
```

To trigger: `curl -X POST http://localhost:3333 -d "CI build failed"`

**Note:** `pi.send()` is not supported in print mode (single-shot execution).

## Examples

### Shitty Permission Gate

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive)/i,
    /\bsudo\b/i,
    /\b(chmod|chown)\b.*777/i,
  ];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const isDangerous = dangerousPatterns.some((p) => p.test(command));

    if (isDangerous) {
      const choice = await ctx.ui.select(
        `⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`,
        ["Yes", "No"]
      );

      if (choice !== "Yes") {
        return { block: true, reason: "Blocked by user" };
      }
    }

    return undefined;
  });
}
```

### Git Checkpointing

Stash code state at each turn so `/branch` can restore it.

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  const checkpoints = new Map<number, string>();

  pi.on("turn_start", async (event, ctx) => {
    // Create a git stash entry before LLM makes changes
    const { stdout } = await ctx.exec("git", ["stash", "create"]);
    const ref = stdout.trim();
    if (ref) {
      checkpoints.set(event.turnIndex, ref);
    }
  });

  pi.on("branch", async (event, ctx) => {
    const ref = checkpoints.get(event.targetTurnIndex);
    if (!ref) return undefined;

    const choice = await ctx.ui.select("Restore code state?", [
      "Yes, restore code to that point",
      "No, keep current code",
    ]);

    if (choice?.startsWith("Yes")) {
      await ctx.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Code restored to checkpoint", "info");
    }

    return undefined;
  });

  pi.on("agent_end", async () => {
    checkpoints.clear();
  });
}
```

### Block Writes to Certain Paths

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  const protectedPaths = [".env", ".git/", "node_modules/"];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") {
      return undefined;
    }

    const path = event.input.path as string;
    const isProtected = protectedPaths.some((p) => path.includes(p));

    if (isProtected) {
      ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
      return { block: true, reason: `Path "${path}" is protected` };
    }

    return undefined;
  });
}
```

## Mode Behavior

Hooks behave differently depending on the run mode:

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI dialogs | User can interact normally |
| RPC | JSON protocol | Host application handles UI |
| Print (`-p`) | No-op (returns null/false) | Hooks run but can't prompt |

In print mode, `select()` returns `null`, `confirm()` returns `false`, and `input()` returns `null`. Design hooks to handle these cases gracefully.

## Error Handling

- If a hook throws an error, it's logged and the agent continues
- If a `tool_call` hook throws an error, the tool is **blocked** (fail-safe)
- Other events have a timeout (default 30s); timeout errors are logged but don't block
- Hook errors are displayed in the UI with the hook path and error message

## Debugging

To debug a hook:

1. Open VS Code in your hooks directory
2. Open a **JavaScript Debug Terminal** (Ctrl+Shift+P → "JavaScript Debug Terminal")
3. Set breakpoints in your hook file
4. Run `pi --hook ./my-hook.ts` in the debug terminal

The `--hook` flag loads a hook directly without needing to modify `settings.json` or place files in the standard hook directories.

---

# Internals

## Discovery and Loading

Hooks are discovered and loaded at startup in `main.ts`:

```
main.ts
  -> discoverAndLoadHooks(configuredPaths, cwd)  [loader.ts]
     -> discoverHooksInDir(~/.pi/agent/hooks/)   # global hooks
     -> discoverHooksInDir(cwd/.pi/hooks/)       # project hooks
     -> merge with configuredPaths (deduplicated)
     -> for each path:
        -> jiti.import(path)                     # TypeScript support via jiti
        -> hookFactory(hookAPI)                  # calls pi.on() to register handlers
        -> returns LoadedHook { path, handlers: Map<eventType, handlers[]> }
```

## Tool Wrapping

Tools are wrapped with hook callbacks before the agent is created:

```
main.ts
  -> wrapToolsWithHooks(tools, hookRunner)  [tool-wrapper.ts]
     -> returns new tools with wrapped execute() functions
```

The wrapped `execute()` function:

1. Checks `hookRunner.hasHandlers("tool_call")`
2. If yes, calls `hookRunner.emitToolCall(event)` (no timeout)
3. If result has `block: true`, throws an error
4. Otherwise, calls the original `tool.execute()`
5. Checks `hookRunner.hasHandlers("tool_result")`
6. If yes, calls `hookRunner.emit(event)` (with timeout)
7. Returns (possibly modified) result

## HookRunner

The `HookRunner` class manages hook execution:

```typescript
class HookRunner {
  constructor(hooks: LoadedHook[], cwd: string, timeout?: number)
  
  setUIContext(ctx: HookUIContext, hasUI: boolean): void
  setSessionFile(path: string | null): void
  onError(listener): () => void
  hasHandlers(eventType: string): boolean
  emit(event: HookEvent): Promise<Result>
  emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined>
}
```

Key behaviors:
- `emit()` has a timeout (default 30s) for safety
- `emitToolCall()` has **no timeout** (user prompts can take any time)
- Errors in `emit()` are caught, logged via `onError()`, and execution continues
- Errors in `emitToolCall()` propagate, causing the tool to be blocked (fail-safe)

## Event Flow

```
Mode initialization:
  -> hookRunner.setUIContext(ctx, hasUI)
  -> hookRunner.setSessionFile(path)
  -> hookRunner.emit({ type: "session", reason: "start", ... })

User sends prompt:
  -> AgentSession.prompt()
     -> hookRunner.emit({ type: "agent_start" })
     -> hookRunner.emit({ type: "turn_start", turnIndex })
     -> agent loop:
        -> LLM generates tool calls
        -> For each tool call:
           -> wrappedTool.execute()
              -> hookRunner.emitToolCall({ type: "tool_call", ... })
              -> [if not blocked] originalTool.execute()
              -> hookRunner.emit({ type: "tool_result", ... })
        -> LLM generates response
     -> hookRunner.emit({ type: "turn_end", ... })
     -> [repeat if more tool calls]
  -> hookRunner.emit({ type: "agent_end", messages })

Branch:
  -> AgentSession.branch()
     -> hookRunner.emit({ type: "branch", ... })  # BEFORE branch
     -> [branch happens]
     -> hookRunner.emit({ type: "session", reason: "switch", ... })  # AFTER

Session switch:
  -> AgentSession.switchSession()
     -> hookRunner.emit({ type: "session", reason: "switch", ... })

Clear:
  -> AgentSession.reset()
     -> hookRunner.emit({ type: "session", reason: "clear", ... })
```

## UI Context by Mode

Each mode provides its own `HookUIContext` implementation:

**Interactive Mode** (`interactive-mode.ts`):
- `select()` -> `HookSelectorComponent` (TUI list selector)
- `confirm()` -> `HookSelectorComponent` with Yes/No options
- `input()` -> `HookInputComponent` (TUI text input)
- `notify()` -> Adds text to chat container

**RPC Mode** (`rpc-mode.ts`):
- All methods send JSON requests via stdout
- Waits for JSON responses via stdin
- Host application renders UI and sends responses

**Print Mode** (`print-mode.ts`):
- All methods return null/false immediately
- `notify()` is a no-op

## File Structure

```
packages/coding-agent/src/core/hooks/
├── index.ts          # Public exports
├── types.ts          # Event types, HookAPI, contexts
├── loader.ts         # jiti-based hook loading
├── runner.ts         # HookRunner class
└── tool-wrapper.ts   # Tool wrapping for interception
```
