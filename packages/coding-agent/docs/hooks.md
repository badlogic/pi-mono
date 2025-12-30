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
  ├─► session (reason: "before_branch", can cancel)
  └─► session (reason: "branch", AFTER branch)

user switches session (/resume)
  │
  ├─► session (reason: "before_switch", can cancel)
  └─► session (reason: "switch", AFTER switch)

user starts new session (/new)
  │
  ├─► session (reason: "before_new", can cancel)
  └─► session (reason: "new", AFTER new session starts)

context compaction (auto or /compact)
  │
  ├─► session (reason: "before_compact", can cancel or provide custom summary)
  └─► session (reason: "compact", AFTER compaction)

user exits (double Ctrl+C or Ctrl+D)
  │
  └─► session (reason: "shutdown")
```

A **turn** is one LLM response plus any tool calls. Complex tasks loop through multiple turns until the LLM responds without calling tools.

### session

Fired on session lifecycle events. The `before_*` variants fire before the action and can be cancelled by returning `{ cancel: true }`.

```typescript
pi.on("session", async (event, ctx) => {
  // event.entries: SessionEntry[] - all session entries
  // event.sessionFile: string | null - current session file (null with --no-session)
  // event.previousSessionFile: string | null - previous session file
  // event.reason: "start" | "before_switch" | "switch" | "before_new" | "new" |
  //               "before_branch" | "branch" | "before_compact" | "compact" | "shutdown"
  // event.targetTurnIndex: number - only for "before_branch" and "branch"

  // Cancel a before_* action:
  if (event.reason === "before_new") {
    return { cancel: true };
  }

  // For before_branch only: create branch but skip conversation restore
  // (useful for checkpoint hooks that restore files separately)
  if (event.reason === "before_branch") {
    return { skipConversationRestore: true };
  }
});
```

**Reasons:**
- `start`: Initial session load on startup
- `before_switch` / `switch`: User switched sessions (`/resume`)
- `before_new` / `new`: User started a new session (`/new`)
- `before_branch` / `branch`: User branched the session (`/branch`)
- `before_compact` / `compact`: Context compaction (auto or `/compact`)
- `shutdown`: Process is exiting (double Ctrl+C, Ctrl+D, or SIGTERM)

For `before_branch` and `branch` events, `event.targetTurnIndex` contains the entry index being branched from.

#### Custom Compaction

The `before_compact` event lets you implement custom compaction strategies. Understanding the data model:

**How default compaction works:**

When context exceeds the threshold, pi finds a "cut point" that keeps recent turns (configurable via `settings.json` `compaction.keepRecentTokens`, default 20k):

```
Legend:
  hdr  = header           usr  = user message       ass = assistant message
  tool = tool result      cmp  = compaction entry   bash = bashExecution
```

```
Session entries (before compaction):

  index:   0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ cmp │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                ↑     └───────┬───────┘ └────────────┬────────────┘
         previousSummary  messagesToSummarize     messagesToKeep
                                   ↑
                    cutPoint.firstKeptEntryIndex = 5

After compaction (new entry appended):

  index:   0     1     2     3      4     5     6      7      8     9     10    11
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ cmp │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬───────────┘ └────────────────────────┬─────────────────┘
                  not sent to LLM                           sent to LLM
                                          ↑
                                firstKeptEntryIndex = 5
                                  (stored in new cmp)
```

The session file is append-only. When loading, the session loader finds the latest compaction entry, uses its summary, then loads messages starting from `firstKeptEntryIndex`. The cut point is always a user, assistant, or bashExecution message (never a tool result, which must stay with its tool call).

```
What gets sent to the LLM as context:

                       5     6      7      8     9     10
  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
                 ↑      └─────────────────┬────────────────┘
       from new cmp's              messages from
           summary           firstKeptEntryIndex onwards
```

**Split turns:** When a single turn is too large, the cut point may land mid-turn at an assistant message. In this case `cutPoint.isSplitTurn = true`:

```
Split turn example (one huge turn that exceeds keepRecentTokens):

  index:   0     1     2      3     4      5      6     7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │ ass │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┴─────┘
                ↑                                       ↑
         turnStartIndex = 1                   firstKeptEntryIndex = 7
                │                                       │ (must be usr/ass/bash, not tool)
                └─────────── turn prefix ───────────────┘ (idx 1-6, summarized separately)
                                                        └── kept messages (idx 7-9)

  messagesToSummarize = []  (no complete turns before this one)
  messagesToKeep = [ass idx 7, tool idx 8, ass idx 9]

The default compaction generates TWO summaries that get merged:
1. History summary (previousSummary + messagesToSummarize)
2. Turn prefix summary (messages from turnStartIndex to firstKeptEntryIndex)
```

See [src/core/compaction.ts](../src/core/compaction.ts) for the full implementation.

**Event fields:**

| Field | Description |
|-------|-------------|
| `preparation` | Compaction preparation with `firstKeptEntryId`, `messagesToSummarize`, `messagesToKeep`, `tokensBefore`, `isSplitTurn`. |
| `previousCompactions` | Array of previous `CompactionEntry` objects (newest first). Access summaries for accumulated context. |
| `model` | Model to use for summarization. |
| `customInstructions` | Optional focus for summary (from `/compact <instructions>`). |
| `signal` | AbortSignal for cancellation. Pass to LLM calls and check periodically. |

Access session entries via `ctx.sessionManager.getEntries()` and API keys via `ctx.modelRegistry.getApiKey(model)`.

Custom compaction hooks should honor the abort signal by passing it to `complete()` calls. This allows users to cancel compaction (e.g., via Ctrl+C during `/compact`).

**Returning custom compaction:**

```typescript
return {
  compaction: {
    summary: "Your summary...",
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    details: { /* optional hook-specific data */ },
  }
};
```

The `details` field persists hook-specific metadata (e.g., artifact index, version markers) in the compaction entry.

See [examples/hooks/custom-compaction.ts](../examples/hooks/custom-compaction.ts) for a complete example.

**After compaction (`compact` event):**
- `event.compactionEntry`: The saved compaction entry
- `event.tokensBefore`: Token count before compaction
- `event.fromHook`: Whether the compaction entry was provided by a hook

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

### context

Fired before each LLM call, allowing non-destructive message modification. The original session is not modified.

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages: AgentMessage[] (deep copy, safe to modify)
  
  // Return modified messages, or undefined to keep original
  return { messages: modifiedMessages };
});
```

Use case: Dynamic context pruning without modifying session history.

```typescript
export default function (pi: HookAPI) {
  pi.on("context", async (event, ctx) => {
    // Find all pruning decisions stored as custom entries
    const entries = ctx.sessionManager.getEntries();
    const pruningRules = entries
      .filter(e => e.type === "custom" && e.customType === "prune-rules")
      .flatMap(e => e.data as PruneRule[]);
    
    // Apply pruning to messages (e.g., truncate old tool results)
    const prunedMessages = applyPruning(event.messages, pruningRules);
    return { messages: prunedMessages };
  });
}
```

### before_agent_start

Fired once when user submits a prompt, before `agent_start`. Allows injecting a message that gets persisted.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.userMessage: the user's message
  
  // Return a message to inject, or undefined to skip
  return {
    message: {
      customType: "context-injection",
      content: "Additional context...",
      display: true,  // Show in TUI
    }
  };
});
```

The injected message is:
- Persisted to session as a `CustomMessageEntry`
- Sent to the LLM as a user message
- Visible in TUI (if `display: true`)

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

### ctx.ui.custom(component, done)

Show a custom TUI component with keyboard focus. Call `done()` when finished.

```typescript
import { Container, Text } from "@mariozechner/pi-tui";

const myComponent = new Container(0, 0, [
  new Text("Custom UI - press ESC to close", 0, 0),
]);

ctx.ui.custom(myComponent, () => {
  // Cleanup when component is dismissed
});
```

See `examples/hooks/snake.ts` for a complete example with keyboard handling.

### ctx.sessionManager

Access to the session manager for reading session state.

```typescript
const entries = ctx.sessionManager.getEntries();
const path = ctx.sessionManager.getPath();
const tree = ctx.sessionManager.getTree();
const label = ctx.sessionManager.getLabel(entryId);
```

### ctx.modelRegistry

Access to model registry for model discovery and API keys.

```typescript
const apiKey = ctx.modelRegistry.getApiKey(model);
const models = ctx.modelRegistry.getAvailableModels();
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

## Hook API Methods

The `pi` object provides methods for interacting with the agent:

### pi.sendMessage(message, triggerTurn?)

Inject a message into the session. Creates a `CustomMessageEntry` (not a user message).

```typescript
pi.sendMessage(message: HookMessage, triggerTurn?: boolean): void

// HookMessage structure:
interface HookMessage {
  customType: string;  // Your hook's identifier
  content: string | (TextContent | ImageContent)[];
  display: boolean;    // true = show in TUI, false = hidden
  details?: unknown;   // Hook-specific metadata (not sent to LLM)
}
```

- If `triggerTurn` is true (default), starts an agent turn after injecting
- If streaming, message is queued until current turn ends
- Messages are persisted to session and sent to LLM as user messages

```typescript
pi.sendMessage({
  customType: "my-hook",
  content: "External trigger: build failed",
  display: true,
}, true);  // Trigger agent response
```

### pi.appendEntry(customType, data?)

Persist hook state to session. Does NOT participate in LLM context.

```typescript
pi.appendEntry(customType: string, data?: unknown): void
```

Use for storing state that survives session reload. Scan entries on reload to reconstruct state:

```typescript
pi.on("session", async (event, ctx) => {
  if (event.reason === "start" || event.reason === "switch") {
    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === "my-hook") {
        // Reconstruct state from entry.data
      }
    }
  }
});

// Later, save state
pi.appendEntry("my-hook", { count: 42 });
```

### pi.registerCommand(name, options)

Register a custom slash command.

```typescript
pi.registerCommand(name: string, options: {
  description?: string;
  handler: (ctx: HookCommandContext) => Promise<void>;
}): void
```

The handler receives:
- `ctx.args`: Everything after `/commandname`
- `ctx.ui`: UI methods (select, confirm, input, notify, custom)
- `ctx.hasUI`: Whether interactive UI is available
- `ctx.cwd`: Current working directory
- `ctx.sessionManager`: Session access
- `ctx.modelRegistry`: Model access

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const messages = entries.filter(e => e.type === "message").length;
    ctx.ui.notify(`${messages} messages in session`, "info");
  }
});
```

To prompt the LLM after a command, use `pi.sendMessage()` with `triggerTurn: true`.

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for `CustomMessageEntry` messages.

```typescript
pi.registerMessageRenderer(customType: string, renderer: HookMessageRenderer): void

type HookMessageRenderer = (
  message: HookMessage,
  options: { expanded: boolean; width: number },
  theme: Theme
) => Component | null;
```

Return a TUI Component for the inner content. Pi wraps it in a styled box.

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerMessageRenderer("my-hook", (message, options, theme) => {
  return new Text(theme.fg("accent", `[MY-HOOK] ${message.content}`), 0, 0);
});
```

### pi.exec(command, args, options?)

Execute a shell command.

```typescript
const result = await pi.exec(command: string, args: string[], options?: {
  signal?: AbortSignal;
  timeout?: number;
}): Promise<ExecResult>;

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;  // True if killed by signal/timeout
}
```

```typescript
const result = await pi.exec("git", ["status"]);
if (result.code === 0) {
  console.log(result.stdout);
}

// With timeout
const result = await pi.exec("slow-command", [], { timeout: 5000 });
if (result.killed) {
  console.log("Command timed out");
}
```

## Sending Messages (Examples)

### Example: File Watcher

```typescript
import * as fs from "node:fs";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session", async (event, ctx) => {
    if (event.reason !== "start") return;

    const triggerFile = "/tmp/agent-trigger.txt";

    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          pi.sendMessage({
            customType: "file-trigger",
            content: `External trigger: ${content}`,
            display: true,
          }, true);
          fs.writeFileSync(triggerFile, "");
        }
      } catch {
        // File might not exist yet
      }
    });

    ctx.ui.notify("Watching /tmp/agent-trigger.txt", "info");
  });
}
```

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
        pi.sendMessage({
          customType: "webhook",
          content: body || "Webhook triggered",
          display: true,
        }, true);
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

**Note:** `pi.sendMessage()` is not supported in print mode (single-shot execution).

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

  pi.on("session", async (event, ctx) => {
    // Only handle before_branch events
    if (event.reason !== "before_branch") return;

    const ref = checkpoints.get(event.targetTurnIndex);
    if (!ref) return;

    const choice = await ctx.ui.select("Restore code state?", [
      "Yes, restore code to that point",
      "No, keep current code",
    ]);

    if (choice?.startsWith("Yes")) {
      await ctx.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Code restored to checkpoint", "info");
    }
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

### Custom Compaction

Use a different model for summarization, or implement your own compaction strategy.

See [examples/hooks/custom-compaction.ts](../examples/hooks/custom-compaction.ts) and the [Custom Compaction](#custom-compaction) section above for details.

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

Tools (built-in and custom) are wrapped with hook callbacks after tool discovery/selection, before the agent is created:

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
     -> hookRunner.emit({ type: "session", reason: "before_branch", ... })  # can cancel
     -> [if not cancelled: branch happens]
     -> hookRunner.emit({ type: "session", reason: "branch", ... })

Session switch:
  -> AgentSession.switchSession()
     -> hookRunner.emit({ type: "session", reason: "before_switch", ... })  # can cancel
     -> [if not cancelled: switch happens]
     -> hookRunner.emit({ type: "session", reason: "switch", ... })

Clear:
  -> AgentSession.reset()
     -> hookRunner.emit({ type: "session", reason: "before_new", ... })  # can cancel
     -> [if not cancelled: new session starts]
     -> hookRunner.emit({ type: "session", reason: "new", ... })

Shutdown (interactive mode):
  -> handleCtrlC() or handleCtrlD()
     -> hookRunner.emit({ type: "session", reason: "shutdown", ... })
     -> process.exit(0)
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
