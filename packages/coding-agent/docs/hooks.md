> pi can create hooks. Ask it to build one for your use case.

# Hooks

Hooks are TypeScript modules that extend pi's behavior by subscribing to lifecycle events. They can intercept tool calls, prompt the user, modify results, inject messages, and more.

**Key capabilities:**
- **User interaction** - Hooks can prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()`
- **Custom slash commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Event interception** - Block or modify tool calls, inject context, customize compaction
- **Session persistence** - Store hook state that survives restarts via `pi.appendEntry()`

**Example use cases:**
- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on `/branch`)
- Path protection (block writes to `.env`, `node_modules/`)
- External integrations (file watchers, webhooks, CI triggers)
- Interactive tools (games, wizards, custom dialogs)

See [examples/hooks/](../examples/hooks/) for working implementations, including a [snake game](../examples/hooks/snake.ts) demonstrating custom UI.

## Quick Start

Create `~/.pi/agent/hooks/my-hook.ts`:

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Hook loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });
}
```

Test with `--hook` flag:

```bash
pi --hook ./my-hook.ts
```

## Hook Locations

Hooks are auto-discovered from:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/hooks/*.ts` | Global (all projects) |
| `.pi/hooks/*.ts` | Project-local |

Additional paths via `settings.json`:

```json
{
  "hooks": ["/path/to/hook.ts"]
}
```

## Available Imports

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent/hooks` | Hook types (`HookAPI`, `HookContext`, events) |
| `@mariozechner/pi-coding-agent` | Additional types if needed |
| `@mariozechner/pi-ai` | AI utilities |
| `@mariozechner/pi-tui` | TUI components |

Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

## Writing a Hook

A hook exports a default function that receives `HookAPI`:

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // Handle event
  });
}
```

Hooks are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

## Events

### Lifecycle Overview

```
pi starts
  │
  └─► session_start
      │
      ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► before_agent_start (can inject message)              │
  ├─► agent_start                                          │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   ├─► context (can modify messages)            │       │
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

/new (new session)
  ├─► session_before_new (can cancel)
  └─► session_new

/resume (switch session)
  ├─► session_before_switch (can cancel)
  └─► session_switch

/branch
  ├─► session_before_branch (can cancel)
  └─► session_branch

/compact or auto-compaction
  ├─► session_before_compact (can cancel or customize)
  └─► session_compact

/tree navigation
  ├─► session_before_tree (can cancel or customize)
  └─► session_tree

exit (Ctrl+C, Ctrl+D)
  └─► session_shutdown
```

### Session Events

#### session_start

Fired on initial session load.

```typescript
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

#### session_before_switch / session_switch

Fired when switching sessions via `/resume`.

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.targetSessionFile - session we're switching to
  return { cancel: true }; // Cancel the switch
});

pi.on("session_switch", async (event, ctx) => {
  // event.previousSessionFile - session we came from
});
```

#### session_before_new / session_new

Fired when starting a new session via `/new`.

```typescript
pi.on("session_before_new", async (_event, ctx) => {
  const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
  if (!ok) return { cancel: true };
});

pi.on("session_new", async (_event, ctx) => {
  // New session started
});
```

#### session_before_branch / session_branch

Fired when branching via `/branch`.

```typescript
pi.on("session_before_branch", async (event, ctx) => {
  // event.entryId - ID of the entry being branched from

  return { cancel: true }; // Cancel branch
  // OR
  return { skipConversationRestore: true }; // Branch but don't rewind messages
});

pi.on("session_branch", async (event, ctx) => {
  // event.previousSessionFile - previous session file
});
```

The `skipConversationRestore` option is useful for checkpoint hooks that restore code state separately.

#### session_before_compact / session_compact

Fired on compaction. See [compaction.md](compaction.md) for details.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});

pi.on("session_compact", async (event, ctx) => {
  // event.compactionEntry - the saved compaction
  // event.fromHook - whether hook provided it
});
```

#### session_before_tree / session_tree

Fired on `/tree` navigation. Always fires regardless of user's summarization choice. See [compaction.md](compaction.md) for details.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;
  // preparation.targetId, oldLeafId, commonAncestorId, entriesToSummarize
  // preparation.userWantsSummary - whether user chose to summarize

  return { cancel: true };
  // OR provide custom summary (only used if userWantsSummary is true):
  return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromHook
});
```

#### session_shutdown

Fired on exit (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

Fired after user submits prompt, before agent loop. Can inject a persistent message.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - user's prompt text
  // event.images - attached images (if any)

  return {
    message: {
      customType: "my-hook",
      content: "Additional context for the LLM",
      display: true,  // Show in TUI
    }
  };
});
```

The injected message is persisted as `CustomMessageEntry` and sent to the LLM.

#### agent_start / agent_end

Fired once per user prompt.

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this prompt
});
```

#### turn_start / turn_end

Fired for each turn (one LLM response + tool calls).

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex
  // event.message - assistant's response
  // event.toolResults - tool results from this turn
});
```

#### context

Fired before each LLM call. Modify messages non-destructively (session unchanged).

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify

  // Filter or transform messages
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

### Tool Events

#### tool_call

Fired before tool executes. **Can block.**

```typescript
pi.on("tool_call", async (event, ctx) => {
  // event.toolName - "bash", "read", "write", "edit", etc.
  // event.toolCallId
  // event.input - tool parameters

  if (shouldBlock(event)) {
    return { block: true, reason: "Not allowed" };
  }
});
```

Tool inputs:
- `bash`: `{ command, timeout? }`
- `read`: `{ path, offset?, limit? }`
- `write`: `{ path, content }`
- `edit`: `{ path, oldText, newText }`
- `ls`: `{ path?, limit? }`
- `find`: `{ pattern, path?, limit? }`
- `grep`: `{ pattern, path?, glob?, ignoreCase?, literal?, context?, limit? }`

#### tool_result

Fired after tool executes (including errors). **Can modify result.**

Check `event.isError` to distinguish successful executions from failures.

```typescript
pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content - array of TextContent | ImageContent
  // event.details - tool-specific (see below)
  // event.isError - true if the tool threw an error

  if (event.isError) {
    // Handle error case
  }

  // Modify result:
  return { content: [...], details: {...}, isError: false };
});
```

Use type guards for typed details:

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  if (isBashToolResult(event)) {
    // event.details is BashToolDetails | undefined
    if (event.details?.truncation?.truncated) {
      // Full output at event.details.fullOutputPath
    }
  }
});
```

Available guards: `isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`.

## HookContext

Every handler receives `ctx: HookContext`:

### ctx.ui

UI methods for user interaction. Hooks can prompt users and even render custom TUI components.

**Built-in dialogs:**

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);
// Returns selected string or undefined if cancelled

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");
// Returns true or false

// Text input
const name = await ctx.ui.input("Name:", "placeholder");
// Returns string or undefined if cancelled

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"

// Set status text in footer (persistent until cleared)
ctx.ui.setStatus("my-hook", "Processing 5/10...");  // Set status
ctx.ui.setStatus("my-hook", undefined);              // Clear status

// Set the core input editor text (pre-fill prompts, generated content)
ctx.ui.setEditorText("Generated prompt text here...");

// Get current editor text
const currentText = ctx.ui.getEditorText();
```

**Status text notes:**
- Multiple hooks can set their own status using unique keys
- Statuses are displayed on a single line in the footer, sorted alphabetically by key
- Text is sanitized (newlines/tabs replaced with spaces) and truncated to terminal width
- Use `ctx.ui.theme` to style status text with theme colors (see below)

**Styling with theme colors:**

Use `ctx.ui.theme` to apply consistent colors that respect the user's theme:

```typescript
const theme = ctx.ui.theme;

// Foreground colors
ctx.ui.setStatus("my-hook", theme.fg("success", "✓") + theme.fg("dim", " Ready"));
ctx.ui.setStatus("my-hook", theme.fg("error", "✗") + theme.fg("dim", " Failed"));
ctx.ui.setStatus("my-hook", theme.fg("accent", "●") + theme.fg("dim", " Working..."));

// Available fg colors: accent, success, error, warning, muted, dim, text, and more
// See docs/theme.md for the full list of theme colors
```

See [examples/hooks/status-line.ts](../examples/hooks/status-line.ts) for a complete example.

**Custom components:**

Show a custom TUI component with keyboard focus:

```typescript
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

const result = await ctx.ui.custom((tui, theme, done) => {
  const loader = new BorderedLoader(tui, theme, "Working...");
  loader.onAbort = () => done(null);
  
  doWork(loader.signal).then(done).catch(() => done(null));
  
  return loader;
});
```

Your component can:
- Implement `handleInput(data: string)` to receive keyboard input
- Implement `render(width: number): string[]` to render lines
- Implement `invalidate()` to clear cached render
- Implement `dispose()` for cleanup when closed
- Call `tui.requestRender()` to trigger re-render
- Call `done(result)` when done to restore normal UI

See [examples/hooks/qna.ts](../examples/hooks/qna.ts) for a loader pattern and [examples/hooks/snake.ts](../examples/hooks/snake.ts) for a game. See [tui.md](tui.md) for the full component API.

### ctx.hasUI

`false` in print mode (`-p`), JSON print mode, and RPC mode. Always check before using `ctx.ui`:

```typescript
if (ctx.hasUI) {
  const choice = await ctx.ui.select(...);
} else {
  // Default behavior
}
```

### ctx.cwd

Current working directory.

### ctx.sessionManager

Read-only access to session state. See `ReadonlySessionManager` in [`src/core/session-manager.ts`](../src/core/session-manager.ts).

```typescript
// Session info
ctx.sessionManager.getCwd()           // Working directory
ctx.sessionManager.getSessionDir()    // Session directory (~/.pi/agent/sessions)
ctx.sessionManager.getSessionId()     // Current session ID
ctx.sessionManager.getSessionFile()   // Session file path (undefined with --no-session)

// Entries
ctx.sessionManager.getEntries()       // All entries (excludes header)
ctx.sessionManager.getHeader()        // Session header entry
ctx.sessionManager.getEntry(id)       // Specific entry by ID
ctx.sessionManager.getLabel(id)       // Entry label (if any)

// Tree navigation
ctx.sessionManager.getBranch()        // Current branch (root to leaf)
ctx.sessionManager.getBranch(leafId)  // Specific branch
ctx.sessionManager.getTree()          // Full tree structure
ctx.sessionManager.getLeafId()        // Current leaf entry ID
ctx.sessionManager.getLeafEntry()     // Current leaf entry
```

Use `pi.sendMessage()` or `pi.appendEntry()` for writes.

### ctx.modelRegistry

Access to models and API keys:

```typescript
// Get API key for a model
const apiKey = await ctx.modelRegistry.getApiKey(model);

// Get available models
const models = ctx.modelRegistry.getAvailableModels();
```

### ctx.model

Current model, or `undefined` if none selected yet. Use for LLM calls in hooks:

```typescript
if (ctx.model) {
  const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
  // Use with @mariozechner/pi-ai complete()
}
```

## HookAPI Methods

### pi.on(event, handler)

Subscribe to events. See [Events](#events) for all event types.

### pi.sendMessage(message, triggerTurn?)

Inject a message into the session. Creates a `CustomMessageEntry` that participates in the LLM context.

```typescript
pi.sendMessage({
  customType: "my-hook",      // Your hook's identifier
  content: "Message text",    // string or (TextContent | ImageContent)[]
  display: true,              // Show in TUI
  details: { ... },           // Optional metadata (not sent to LLM)
}, triggerTurn);              // If true, triggers LLM response
```

**Storage and timing:**
- The message is appended to the session file immediately as a `CustomMessageEntry`
- If the agent is currently streaming, the message is queued and appended after the current turn
- If `triggerTurn` is true and the agent is idle, a new agent loop starts

**LLM context:**
- `CustomMessageEntry` is converted to a user message when building context for the LLM
- Only `content` is sent to the LLM; `details` is for rendering/state only

**TUI display:**
- If `display: true`, the message appears in the chat with purple styling (customMessageBg, customMessageText, customMessageLabel theme colors)
- If `display: false`, the message is hidden from the TUI but still sent to the LLM
- Use `pi.registerMessageRenderer()` to customize how your messages render (see below)

### pi.appendEntry(customType, data?)

Persist hook state. Creates `CustomEntry` (does NOT participate in LLM context).

```typescript
// Save state
pi.appendEntry("my-hook-state", { count: 42 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-hook-state") {
      // Reconstruct from entry.data
    }
  }
});
```

### pi.registerCommand(name, options)

Register a custom slash command:

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    // args = everything after /stats
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  }
});
```

For long-running commands (e.g., LLM calls), use `ctx.ui.custom()` with a loader. See [examples/hooks/qna.ts](../examples/hooks/qna.ts).

To trigger LLM after command, call `pi.sendMessage(..., true)`.

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for `CustomMessageEntry` messages with your `customType`. Without a custom renderer, messages display with default purple styling showing the content as-is.

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerMessageRenderer("my-hook", (message, options, theme) => {
  // message.content - the message content (string or content array)
  // message.details - your custom metadata
  // options.expanded - true if user pressed Ctrl+O
  
  const prefix = theme.fg("accent", `[${message.details?.label ?? "INFO"}] `);
  const text = typeof message.content === "string" 
    ? message.content 
    : message.content.map(c => c.type === "text" ? c.text : "[image]").join("");
  
  return new Text(prefix + theme.fg("text", text), 0, 0);
});
```

**Renderer signature:**
```typescript
type HookMessageRenderer = (
  message: CustomMessageEntry,
  options: { expanded: boolean },
  theme: Theme
) => Component | null;
```

Return `null` to use default rendering. The returned component is wrapped in a styled Box by the TUI. See [tui.md](tui.md) for component details.

### pi.exec(command, args, options?)

Execute a shell command:

```typescript
const result = await pi.exec("git", ["status"], {
  signal,      // AbortSignal
  timeout,     // Milliseconds
});

// result.stdout, result.stderr, result.code, result.killed
```

## Examples

### Permission Gate

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  const dangerous = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const cmd = event.input.command as string;
    if (dangerous.some(p => p.test(cmd))) {
      if (!ctx.hasUI) {
        return { block: true, reason: "Dangerous (no UI)" };
      }
      const ok = await ctx.ui.confirm("Dangerous!", `Allow: ${cmd}?`);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });
}
```

### Protected Paths

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  const protectedPaths = [".env", ".git/", "node_modules/"];

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const path = event.input.path as string;
    if (protectedPaths.some(p => path.includes(p))) {
      ctx.ui.notify(`Blocked: ${path}`, "warning");
      return { block: true, reason: `Protected: ${path}` };
    }
  });
}
```

### Git Checkpoint

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  const checkpoints = new Map<string, string>();
  let currentEntryId: string | undefined;

  pi.on("tool_result", async (_event, ctx) => {
    const leaf = ctx.sessionManager.getLeafEntry();
    if (leaf) currentEntryId = leaf.id;
  });

  pi.on("turn_start", async () => {
    const { stdout } = await pi.exec("git", ["stash", "create"]);
    if (stdout.trim() && currentEntryId) {
      checkpoints.set(currentEntryId, stdout.trim());
    }
  });

  pi.on("session_before_branch", async (event, ctx) => {
    const ref = checkpoints.get(event.entryId);
    if (!ref || !ctx.hasUI) return;

    const ok = await ctx.ui.confirm("Restore?", "Restore code to checkpoint?");
    if (ok) {
      await pi.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Code restored", "info");
    }
  });

  pi.on("agent_end", () => checkpoints.clear());
}
```

### Custom Command

See [examples/hooks/snake.ts](../examples/hooks/snake.ts) for a complete example with `registerCommand()`, `ui.custom()`, and session persistence.

## Mode Behavior

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI | Normal operation |
| RPC | JSON protocol | Host handles UI |
| Print (`-p`) | No-op (returns null/false) | Hooks run but can't prompt |

In print mode, `select()` returns `undefined`, `confirm()` returns `false`, `input()` returns `undefined`, `getEditorText()` returns `""`, and `setEditorText()`/`setStatus()` are no-ops. Design hooks to handle this by checking `ctx.hasUI`.

## Error Handling

- Hook errors are logged, agent continues
- `tool_call` errors block the tool (fail-safe)
- Errors display in UI with hook path and message
- If a hook hangs, use Ctrl+C to abort

## Debugging

1. Open VS Code in hooks directory
2. Open JavaScript Debug Terminal (Ctrl+Shift+P → "JavaScript Debug Terminal")
3. Set breakpoints
4. Run `pi --hook ./my-hook.ts`
