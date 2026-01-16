> pi can create extensions. Ask it to build one for your use case.

# Extensions

Extensions are TypeScript modules that extend pi's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more.

**Key capabilities:**
- **Custom tools** - Register tools the LLM can call via `pi.registerTool()`
- **Event interception** - Block or modify tool calls, inject context, customize compaction
- **User interaction** - Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()` for complex interactions
- **Custom commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** - Store state that survives restarts via `pi.appendEntry()`
- **Custom rendering** - Control how tool calls/results and messages appear in TUI

**Example use cases:**
- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Custom compaction (summarize conversation your way)
- Conversation summaries (see `summarize.ts` example)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)
- Games while you wait (see `snake.ts` example)

See [examples/extensions/](../examples/extensions/) for working implementations.

## Table of Contents

- [Quick Start](#quick-start)
- [Extension Locations](#extension-locations)
- [Available Imports](#available-imports)
- [Writing an Extension](#writing-an-extension)
  - [Extension Styles](#extension-styles)
- [Events](#events)
  - [Lifecycle Overview](#lifecycle-overview)
  - [Session Events](#session-events)
  - [Agent Events](#agent-events)
  - [Tool Events](#tool-events)
- [ExtensionContext](#extensioncontext)
- [ExtensionCommandContext](#extensioncommandcontext)
- [ExtensionAPI Methods](#extensionapi-methods)
- [State Management](#state-management)
- [Custom Tools](#custom-tools)
- [Custom UI](#custom-ui)
- [Error Handling](#error-handling)
- [Mode Behavior](#mode-behavior)

## Quick Start

Create `~/.pi/agent/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
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

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test with `--extension` (or `-e`) flag:

```bash
pi -e ./my-extension.ts
```

## Extension Locations

Extensions are auto-discovered from:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global (all projects) |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project-local |
| `.pi/extensions/*/index.ts` | Project-local (subdirectory) |

Additional paths via `settings.json`:

```json
{
  "extensions": ["/path/to/extension.ts", "/path/to/extension/dir"]
}
```

**Discovery rules:**

1. **Direct files:** `extensions/*.ts` or `*.js` → loaded directly
2. **Subdirectory with index:** `extensions/myext/index.ts` → loaded as single extension
3. **Subdirectory with package.json:** `extensions/myext/package.json` with `"pi"` field → loads declared paths

```
~/.pi/agent/extensions/
├── simple.ts                      # Direct file (auto-discovered)
├── my-tool/
│   └── index.ts                   # Subdirectory with index (auto-discovered)
└── my-extension-pack/
    ├── package.json               # Declares multiple extensions
    ├── node_modules/              # Dependencies installed here
    └── src/
        ├── safety-gates.ts        # First extension
        └── custom-tools.ts        # Second extension
```

```json
// my-extension-pack/package.json
{
  "name": "my-extension-pack",
  "dependencies": {
    "zod": "^3.0.0"
  },
  "pi": {
    "extensions": ["./src/safety-gates.ts", "./src/custom-tools.ts"]
  }
}
```

The `package.json` approach enables:
- Multiple extensions from one package
- Third-party npm dependencies (resolved via jiti)
- Nested source structure (no depth limit within the package)
- Deployment to and installation from npm

## Available Imports

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `@sinclair/typebox` | Schema definitions for tool parameters |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@mariozechner/pi-tui` | TUI components for custom rendering |

npm dependencies work too. Add a `package.json` next to your extension (or in a parent directory), run `npm install`, and imports from `node_modules/` are resolved automatically.

Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

## Writing an Extension

An extension exports a default function that receives `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui for user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "success");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

### Extension Styles

**Single file** - simplest, for small extensions:

```
~/.pi/agent/extensions/
└── my-extension.ts
```

**Directory with index.ts** - for multi-file extensions:

```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (exports default function)
    ├── tools.ts        # Helper module
    └── utils.ts        # Helper module
```

**Package with dependencies** - for extensions that need npm packages:

```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # Declares dependencies and entry points
    ├── package-lock.json
    ├── node_modules/   # After npm install
    └── src/
        └── index.ts
```

```json
// package.json
{
  "name": "my-extension",
  "dependencies": {
    "zod": "^3.0.0",
    "chalk": "^5.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Run `npm install` in the extension directory, then imports from `node_modules/` work automatically.

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
  ├─► (extension commands checked first, bypass if found)  │
  ├─► input (can intercept, transform, or handle)          │
  ├─► (skill/template expansion if not handled)            │
  ├─► before_agent_start (can inject message, modify system prompt)
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

/new (new session) or /resume (switch session)
  ├─► session_before_switch (can cancel)
  └─► session_switch

/fork
  ├─► session_before_fork (can cancel)
  └─► session_fork

/compact or auto-compaction
  ├─► session_before_compact (can cancel or customize)
  └─► session_compact

/tree navigation
  ├─► session_before_tree (can cancel or customize)
  └─► session_tree

/model or Ctrl+P (model selection/cycling)
  └─► model_select

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

**Examples:** [claude-rules.ts](../examples/extensions/claude-rules.ts), [custom-header.ts](../examples/extensions/custom-header.ts), [file-trigger.ts](../examples/extensions/file-trigger.ts), [status-line.ts](../examples/extensions/status-line.ts), [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

#### session_before_switch / session_switch

Fired when starting a new session (`/new`) or switching sessions (`/resume`).

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason - "new" or "resume"
  // event.targetSessionFile - session we're switching to (only for "resume")

  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});

pi.on("session_switch", async (event, ctx) => {
  // event.reason - "new" or "resume"
  // event.previousSessionFile - session we came from
});
```

**Examples:** [confirm-destructive.ts](../examples/extensions/confirm-destructive.ts), [dirty-repo-guard.ts](../examples/extensions/dirty-repo-guard.ts), [status-line.ts](../examples/extensions/status-line.ts), [todo.ts](../examples/extensions/todo.ts)

#### session_before_fork / session_fork

Fired when forking via `/fork`.

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId - ID of the entry being forked from
  return { cancel: true }; // Cancel fork
  // OR
  return { skipConversationRestore: true }; // Fork but don't rewind messages
});

pi.on("session_fork", async (event, ctx) => {
  // event.previousSessionFile - previous session file
});
```

**Examples:** [confirm-destructive.ts](../examples/extensions/confirm-destructive.ts), [dirty-repo-guard.ts](../examples/extensions/dirty-repo-guard.ts), [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts), [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

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
  // event.fromExtension - whether extension provided it
});
```

**Examples:** [custom-compaction.ts](../examples/extensions/custom-compaction.ts)

#### session_before_tree / session_tree

Fired on `/tree` navigation.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;
  return { cancel: true };
  // OR provide custom summary:
  return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

**Examples:** [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

#### session_shutdown

Fired on exit (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state, etc.
});
```

**Examples:** [auto-commit-on-exit.ts](../examples/extensions/auto-commit-on-exit.ts)

### Agent Events

#### before_agent_start

Fired after user submits prompt, before agent loop. Can inject a message and/or modify the system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - user's prompt text
  // event.images - attached images (if any)
  // event.systemPrompt - current system prompt

  return {
    // Inject a persistent message (stored in session, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    // Replace the system prompt for this turn (chained across extensions)
    systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn...",
  };
});
```

**Examples:** [claude-rules.ts](../examples/extensions/claude-rules.ts), [pirate.ts](../examples/extensions/pirate.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [ssh.ts](../examples/extensions/ssh.ts)

#### agent_start / agent_end

Fired once per user prompt.

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this prompt
});
```

**Examples:** [chalk-logger.ts](../examples/extensions/chalk-logger.ts), [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts)

#### turn_start / turn_end

Fired for each turn (one LLM response + tool calls).

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
});
```

**Examples:** [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [status-line.ts](../examples/extensions/status-line.ts)

#### context

Fired before each LLM call. Modify messages non-destructively.

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

**Examples:** [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts)

### Model Events

#### model_select

Fired when the model changes via `/model` command, model cycling (`Ctrl+P`), or session restore.

```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model - newly selected model
  // event.previousModel - previous model (undefined if first selection)
  // event.source - "set" | "cycle" | "restore"
  
  const prev = event.previousModel 
    ? `${event.previousModel.provider}/${event.previousModel.id}` 
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;
  
  ctx.ui.notify(`Model changed (${event.source}): ${prev} -> ${next}`, "info");
});
```

Use this to update UI elements (status bars, footers) or perform model-specific initialization when the active model changes.

**Examples:** [model-status.ts](../examples/extensions/model-status.ts)

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

**Examples:** [chalk-logger.ts](../examples/extensions/chalk-logger.ts), [permission-gate.ts](../examples/extensions/permission-gate.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [protected-paths.ts](../examples/extensions/protected-paths.ts)

#### tool_result

Fired after tool executes. **Can modify result.**

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content, event.details, event.isError

  if (isBashToolResult(event)) {
    // event.details is typed as BashToolDetails
  }

  // Modify result:
  return { content: [...], details: {...}, isError: false };
});
```

**Examples:** [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts)

### User Bash Events

#### user_bash

Fired when user executes `!` or `!!` commands. **Can intercept.**

```typescript
pi.on("user_bash", (event, ctx) => {
  // event.command - the bash command
  // event.excludeFromContext - true if !! prefix
  // event.cwd - working directory

  // Option 1: Provide custom operations (e.g., SSH)
  return { operations: remoteBashOps };

  // Option 2: Full replacement - return result directly
  return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

**Examples:** [ssh.ts](../examples/extensions/ssh.ts), [interactive-shell.ts](../examples/extensions/interactive-shell.ts)

### Input Events

#### input

Fired when user input is received, after extension commands are checked but before skill and template expansion. The event sees the raw input text, so `/skill:foo` and `/template` are not yet expanded.

**Processing order:**
1. Extension commands (`/cmd`) checked first - if found, handler runs and input event is skipped
2. `input` event fires - can intercept, transform, or handle
3. If not handled: skill commands (`/skill:name`) expanded to skill content
4. If not handled: prompt templates (`/template`) expanded to template content
5. Agent processing begins (`before_agent_start`, etc.)

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - raw input (before skill/template expansion)
  // event.images - attached images, if any
  // event.source - "interactive" (typed), "rpc" (API), or "extension" (via sendUserMessage)

  // Transform: rewrite input before expansion
  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };

  // Handle: respond without LLM (extension shows its own feedback)
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  // Route by source: skip processing for extension-injected messages
  if (event.source === "extension") return { action: "continue" };

  // Intercept skill commands before expansion
  if (event.text.startsWith("/skill:")) {
    // Could transform, block, or let pass through
  }

  return { action: "continue" };  // Default: pass through to expansion
});
```

**Results:**
- `continue` - pass through unchanged (default if handler returns nothing)
- `transform` - modify text/images, then continue to expansion
- `handled` - skip agent entirely (first handler to return this wins)

Transforms chain across handlers. See [input-transform.ts](../examples/extensions/input-transform.ts).

## ExtensionContext

Every handler receives `ctx: ExtensionContext`:

### ctx.ui

UI methods for user interaction. See [Custom UI](#custom-ui) for full details.

### ctx.hasUI

`false` in print mode (`-p`), JSON mode, and RPC mode. Always check before using `ctx.ui`.

### ctx.cwd

Current working directory.

### ctx.sessionManager

Read-only access to session state:

```typescript
ctx.sessionManager.getEntries()       // All entries
ctx.sessionManager.getBranch()        // Current branch
ctx.sessionManager.getLeafId()        // Current leaf entry ID
```

### ctx.modelRegistry / ctx.model

Access to models and API keys.

### ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()

Control flow helpers.

### ctx.shutdown()

Request a graceful shutdown of pi.

- **Interactive mode:** Deferred until the agent becomes idle (after processing all queued steering and follow-up messages).
- **RPC mode:** Deferred until the next idle state (after completing the current command response, when waiting for the next command).
- **Print mode:** No-op. The process exits automatically when all prompts are processed.

Emits `session_shutdown` event to all extensions before exiting. Available in all contexts (event handlers, tools, commands, shortcuts).

```typescript
pi.on("tool_call", (event, ctx) => {
  if (isFatal(event.input)) {
    ctx.shutdown();
  }
});
```

## ExtensionCommandContext

Command handlers receive `ExtensionCommandContext`, which extends `ExtensionContext` with session control methods. These are only available in commands because they can deadlock if called from event handlers.

### ctx.waitForIdle()

Wait for the agent to finish streaming:

```typescript
pi.registerCommand("my-cmd", {
  handler: async (args, ctx) => {
    await ctx.waitForIdle();
    // Agent is now idle, safe to modify session
  },
});
```

### ctx.newSession(options?)

Create a new session:

```typescript
const result = await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
  setup: async (sm) => {
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Context from previous session..." }],
      timestamp: Date.now(),
    });
  },
});

if (result.cancelled) {
  // An extension cancelled the new session
}
```

### ctx.fork(entryId)

Fork from a specific entry, creating a new session file:

```typescript
const result = await ctx.fork("entry-id-123");
if (!result.cancelled) {
  // Now in the forked session
}
```

### ctx.navigateTree(targetId, options?)

Navigate to a different point in the session tree:

```typescript
const result = await ctx.navigateTree("entry-id-456", {
  summarize: true,
});
```

## ExtensionAPI Methods

### pi.on(event, handler)

Subscribe to events. See [Events](#events) for event types and return values.

### pi.registerTool(definition)

Register a custom tool callable by the LLM. See [Custom Tools](#custom-tools) for full details.

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),
    text: Type.Optional(Type.String()),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // Stream progress
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

    return {
      content: [{ type: "text", text: "Done" }],
      details: { result: "..." },
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme) { ... },
  renderResult(result, options, theme) { ... },
});
```

**Examples:** [hello.ts](../examples/extensions/hello.ts), [question.ts](../examples/extensions/question.ts), [questionnaire.ts](../examples/extensions/questionnaire.ts), [todo.ts](../examples/extensions/todo.ts), [truncated-tool.ts](../examples/extensions/truncated-tool.ts)

### pi.sendMessage(message, options?)

Inject a custom message into the session.

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, {
  triggerTurn: true,
  deliverAs: "steer",
});
```

**Options:**
- `deliverAs` - Delivery mode:
  - `"steer"` (default) - Interrupts streaming. Delivered after current tool finishes, remaining tools skipped.
  - `"followUp"` - Waits for agent to finish. Delivered only when agent has no more tool calls.
  - `"nextTurn"` - Queued for next user prompt. Does not interrupt or trigger anything.
- `triggerTurn: true` - If agent is idle, trigger an LLM response immediately. Only applies to `"steer"` and `"followUp"` modes (ignored for `"nextTurn"`).

**Examples:** [file-trigger.ts](../examples/extensions/file-trigger.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts)

### pi.sendUserMessage(content, options?)

Send a user message to the agent. Unlike `sendMessage()` which sends custom messages, this sends an actual user message that appears as if typed by the user. Always triggers a turn.

```typescript
// Simple text message
pi.sendUserMessage("What is 2+2?");

// With content array (text + images)
pi.sendUserMessage([
  { type: "text", text: "Describe this image:" },
  { type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } },
]);

// During streaming - must specify delivery mode
pi.sendUserMessage("Focus on error handling", { deliverAs: "steer" });
pi.sendUserMessage("And then summarize", { deliverAs: "followUp" });
```

**Options:**
- `deliverAs` - Required when agent is streaming:
  - `"steer"` - Interrupts after current tool, remaining tools skipped
  - `"followUp"` - Waits for agent to finish all tools

When not streaming, the message is sent immediately and triggers a new turn. When streaming without `deliverAs`, throws an error.

See [send-user-message.ts](../examples/extensions/send-user-message.ts) for a complete example.

### pi.appendEntry(customType, data?)

Persist extension state (does NOT participate in LLM context).

```typescript
pi.appendEntry("my-state", { count: 42 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      // Reconstruct from entry.data
    }
  }
});
```

**Examples:** [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [snake.ts](../examples/extensions/snake.ts), [tools.ts](../examples/extensions/tools.ts)

### pi.setSessionName(name)

Set the session display name (shown in session selector instead of first message).

```typescript
pi.setSessionName("Refactor auth module");
```

### pi.getSessionName()

Get the current session name, if set.

```typescript
const name = pi.getSessionName();
if (name) {
  console.log(`Session: ${name}`);
}
```

### pi.registerCommand(name, options)

Register a command.

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  }
});
```

Optional: add argument auto-completion for `/command ...`:

```typescript
import type { AutocompleteItem } from "@mariozechner/pi-tui";

pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
    const envs = ["dev", "staging", "prod"];
    const items = envs.map((e) => ({ value: e, label: e }));
    const filtered = items.filter((i) => i.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying: ${args}`, "info");
  },
});
```

**Examples:** [custom-footer.ts](../examples/extensions/custom-footer.ts), [custom-header.ts](../examples/extensions/custom-header.ts), [handoff.ts](../examples/extensions/handoff.ts), [pirate.ts](../examples/extensions/pirate.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [qna.ts](../examples/extensions/qna.ts), [send-user-message.ts](../examples/extensions/send-user-message.ts), [snake.ts](../examples/extensions/snake.ts), [summarize.ts](../examples/extensions/summarize.ts), [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for messages with your `customType`. See [Custom UI](#custom-ui).

### pi.registerShortcut(shortcut, options)

Register a keyboard shortcut.

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    ctx.ui.notify("Toggled!");
  },
});
```

**Examples:** [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts)

### pi.registerFlag(name, options)

Register a CLI flag.

```typescript
pi.registerFlag("plan", {
  description: "Start in plan mode",
  type: "boolean",
  default: false,
});

// Check value
if (pi.getFlag("--plan")) {
  // Plan mode enabled
}
```

**Examples:** [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts)

### pi.exec(command, args, options?)

Execute a shell command.

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

**Examples:** [auto-commit-on-exit.ts](../examples/extensions/auto-commit-on-exit.ts), [dirty-repo-guard.ts](../examples/extensions/dirty-repo-guard.ts), [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts)

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

Manage active tools.

```typescript
const active = pi.getActiveTools();  // ["read", "bash", "edit", "write"]
const all = pi.getAllTools();        // [{ name: "read", description: "Read file contents..." }, ...]
const names = all.map(t => t.name);  // Just names if needed
pi.setActiveTools(["read", "bash"]); // Switch to read-only
```

**Examples:** [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [tools.ts](../examples/extensions/tools.ts)

### pi.setModel(model)

Set the current model. Returns `false` if no API key is available for the model.

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
if (model) {
  const success = await pi.setModel(model);
  if (!success) {
    ctx.ui.notify("No API key for this model", "error");
  }
}
```

**Examples:** [preset.ts](../examples/extensions/preset.ts)

### pi.getThinkingLevel() / pi.setThinkingLevel(level)

Get or set the thinking level. Level is clamped to model capabilities (non-reasoning models always use "off").

```typescript
const current = pi.getThinkingLevel();  // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
pi.setThinkingLevel("high");
```

**Examples:** [preset.ts](../examples/extensions/preset.ts)

### pi.events

Shared event bus for communication between extensions:

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

## State Management

Extensions with state should store it in tool result `details` for proper branching support:

```typescript
export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  // Reconstruct state from session
  pi.on("session_start", async (_event, ctx) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "my_tool") {
          items = entry.message.details?.items ?? [];
        }
      }
    }
  });

  pi.registerTool({
    name: "my_tool",
    // ...
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      items.push("new item");
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Store for reconstruction
      };
    },
  });
}
```

## Custom Tools

Register tools the LLM can call via `pi.registerTool()`. Tools appear in the system prompt and can have custom rendering.

### Tool Definition

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google compatibility
    text: Type.Optional(Type.String()),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // Check for cancellation
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    // Run commands via pi.exec (captured from extension closure)
    const result = await pi.exec("some-command", [], { signal });

    // Return result
    return {
      content: [{ type: "text", text: "Done" }],  // Sent to LLM
      details: { data: result },                   // For rendering & state
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme) { ... },
  renderResult(result, options, theme) { ... },
});
```

**Important:** Use `StringEnum` from `@mariozechner/pi-ai` for string enums. `Type.Union`/`Type.Literal` doesn't work with Google's API.

### Overriding Built-in Tools

Extensions can override built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) by registering a tool with the same name. Interactive mode displays a warning when this happens.

```bash
# Extension's read tool replaces built-in read
pi -e ./tool-override.ts
```

Alternatively, use `--no-tools` to start without any built-in tools:
```bash
# No built-in tools, only extension tools
pi --no-tools -e ./my-extension.ts
```

See [examples/extensions/tool-override.ts](../examples/extensions/tool-override.ts) for a complete example that overrides `read` with logging and access control.

**Rendering:** If your override doesn't provide custom `renderCall`/`renderResult` functions, the built-in renderer is used automatically (syntax highlighting, diffs, etc.). This lets you wrap built-in tools for logging or access control without reimplementing the UI.

**Your implementation must match the exact result shape**, including the `details` type. The UI and session logic depend on these shapes for rendering and state tracking.

Built-in tool implementations:
- [read.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/read.ts) - `ReadToolDetails`
- [bash.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/bash.ts) - `BashToolDetails`
- [edit.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/edit.ts)
- [write.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/write.ts)
- [grep.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/grep.ts) - `GrepToolDetails`
- [find.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/find.ts) - `FindToolDetails`
- [ls.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/ls.ts) - `LsToolDetails`

### Remote Execution

Built-in tools support pluggable operations for delegating to remote systems (SSH, containers, etc.):

```typescript
import { createReadTool, createBashTool, type ReadOperations } from "@mariozechner/pi-coding-agent";

// Create tool with custom operations
const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});

// Register, checking flag at execution time
pi.registerTool({
  ...remoteRead,
  async execute(id, params, onUpdate, _ctx, signal) {
    const ssh = getSshConfig();
    if (ssh) {
      const tool = createReadTool(cwd, { operations: createRemoteOps(ssh) });
      return tool.execute(id, params, signal, onUpdate);
    }
    return localRead.execute(id, params, signal, onUpdate);
  },
});
```

**Operations interfaces:** `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`

See [examples/extensions/ssh.ts](../examples/extensions/ssh.ts) for a complete SSH example with `--ssh` flag.

### Output Truncation

**Tools MUST truncate their output** to avoid overwhelming the LLM context. Large outputs can cause:
- Context overflow errors (prompt too long)
- Compaction failures
- Degraded model performance

The built-in limit is **50KB** (~10k tokens) and **2000 lines**, whichever is hit first. Use the exported truncation utilities:

```typescript
import {
  truncateHead,      // Keep first N lines/bytes (good for file reads, search results)
  truncateTail,      // Keep last N lines/bytes (good for logs, command output)
  formatSize,        // Human-readable size (e.g., "50KB", "1.5MB")
  DEFAULT_MAX_BYTES, // 50KB
  DEFAULT_MAX_LINES, // 2000
} from "@mariozechner/pi-coding-agent";

async execute(toolCallId, params, onUpdate, ctx, signal) {
  const output = await runCommand();

  // Apply truncation
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;

  if (truncation.truncated) {
    // Write full output to temp file
    const tempFile = writeTempFile(output);

    // Inform the LLM where to find complete output
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
    result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    result += ` Full output saved to: ${tempFile}]`;
  }

  return { content: [{ type: "text", text: result }] };
}
```

**Key points:**
- Use `truncateHead` for content where the beginning matters (search results, file reads)
- Use `truncateTail` for content where the end matters (logs, command output)
- Always inform the LLM when output is truncated and where to find the full version
- Document the truncation limits in your tool's description

See [examples/extensions/truncated-tool.ts](../examples/extensions/truncated-tool.ts) for a complete example wrapping `rg` (ripgrep) with proper truncation.

### Multiple Tools

One extension can register multiple tools with shared state:

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;

  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });

  pi.on("session_shutdown", async () => {
    connection?.close();
  });
}
```

### Custom Rendering

Tools can provide `renderCall` and `renderResult` for custom TUI display. See [tui.md](tui.md) for the full component API.

Tool output is wrapped in a `Box` that handles padding and background. Your render methods return `Component` instances (typically `Text`).

#### renderCall

Renders the tool call (before/during execution):

```typescript
import { Text } from "@mariozechner/pi-tui";

renderCall(args, theme) {
  let text = theme.fg("toolTitle", theme.bold("my_tool "));
  text += theme.fg("muted", args.action);
  if (args.text) {
    text += " " + theme.fg("dim", `"${args.text}"`);
  }
  return new Text(text, 0, 0);  // 0,0 padding - Box handles it
}
```

#### renderResult

Renders the tool result:

```typescript
renderResult(result, { expanded, isPartial }, theme) {
  // Handle streaming
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  // Handle errors
  if (result.details?.error) {
    return new Text(theme.fg("error", `Error: ${result.details.error}`), 0, 0);
  }

  // Normal result - support expanded view (Ctrl+O)
  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }
  return new Text(text, 0, 0);
}
```

#### Best Practices

- Use `Text` with padding `(0, 0)` - the Box handles padding
- Use `\n` for multi-line content
- Handle `isPartial` for streaming progress
- Support `expanded` for detail on demand
- Keep default view compact

#### Fallback

If `renderCall`/`renderResult` is not defined or throws:
- `renderCall`: Shows tool name
- `renderResult`: Shows raw text from `content`

## Custom UI

Extensions can interact with users via `ctx.ui` methods and customize how messages/tools render.

**For custom components, see [tui.md](tui.md)** which has copy-paste patterns for:
- Selection dialogs (SelectList)
- Async operations with cancel (BorderedLoader)
- Settings toggles (SettingsList)
- Status indicators (setStatus)
- Working message during streaming (setWorkingMessage)
- Widgets above editor (setWidget)
- Custom footers (setFooter)

### Dialogs

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

**Examples:**
- `ctx.ui.select()`: [confirm-destructive.ts](../examples/extensions/confirm-destructive.ts), [dirty-repo-guard.ts](../examples/extensions/dirty-repo-guard.ts), [git-checkpoint.ts](../examples/extensions/git-checkpoint.ts), [permission-gate.ts](../examples/extensions/permission-gate.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [question.ts](../examples/extensions/question.ts), [questionnaire.ts](../examples/extensions/questionnaire.ts)
- `ctx.ui.confirm()`: [confirm-destructive.ts](../examples/extensions/confirm-destructive.ts)
- `ctx.ui.editor()`: [handoff.ts](../examples/extensions/handoff.ts)
- `ctx.ui.setEditorText()`: [handoff.ts](../examples/extensions/handoff.ts), [qna.ts](../examples/extensions/qna.ts)

#### Timed Dialogs with Countdown

Dialogs support a `timeout` option that auto-dismisses with a live countdown display:

```typescript
// Dialog shows "Title (5s)" → "Title (4s)" → ... → auto-dismisses at 0
const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { timeout: 5000 }
);

if (confirmed) {
  // User confirmed
} else {
  // User cancelled or timed out
}
```

**Return values on timeout:**
- `select()` returns `undefined`
- `confirm()` returns `false`
- `input()` returns `undefined`

#### Manual Dismissal with AbortSignal

For more control (e.g., to distinguish timeout from user cancel), use `AbortSignal`:

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { signal: controller.signal }
);

clearTimeout(timeoutId);

if (confirmed) {
  // User confirmed
} else if (controller.signal.aborted) {
  // Dialog timed out
} else {
  // User cancelled (pressed Escape or selected "No")
}
```

See [examples/extensions/timed-confirm.ts](../examples/extensions/timed-confirm.ts) for complete examples.

### Widgets, Status, and Footer

```typescript
// Status in footer (persistent until cleared)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Working message (shown during streaming)
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // Restore default

// Widget above editor (string array or factory function)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setWidget("my-widget", (tui, theme) => new Text(theme.fg("accent", "Custom"), 0, 0));
ctx.ui.setWidget("my-widget", undefined);  // Clear

// Custom footer (replaces built-in footer entirely)
ctx.ui.setFooter((tui, theme) => ({
  render(width) { return [theme.fg("dim", "Custom footer")]; },
  invalidate() {},
}));
ctx.ui.setFooter(undefined);  // Restore built-in footer

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();

// Custom editor (vim mode, emacs mode, etc.)
ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
ctx.ui.setEditorComponent(undefined);  // Restore default editor

// Theme management
const themes = ctx.ui.getAllThemes();  // [{ name: "dark", path: "/..." | undefined }, ...]
const lightTheme = ctx.ui.getTheme("light");  // Load without switching
const result = ctx.ui.setTheme("light");  // Switch by name
if (!result.success) {
  ctx.ui.notify(`Failed: ${result.error}`, "error");
}
ctx.ui.setTheme(lightTheme!);  // Or switch by Theme object
ctx.ui.theme.fg("accent", "styled text");  // Access current theme
```

**Examples:**
- `ctx.ui.setStatus()`: [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [status-line.ts](../examples/extensions/status-line.ts)
- `ctx.ui.setWidget()`: [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts)
- `ctx.ui.setFooter()`: [custom-footer.ts](../examples/extensions/custom-footer.ts)
- `ctx.ui.setHeader()`: [custom-header.ts](../examples/extensions/custom-header.ts)
- `ctx.ui.setEditorComponent()`: [modal-editor.ts](../examples/extensions/modal-editor.ts)
- `ctx.ui.setTheme()`: [mac-system-theme.ts](../examples/extensions/mac-system-theme.ts)

### Custom Components

For complex UI, use `ctx.ui.custom()`. This temporarily replaces the editor with your component until `done()` is called:

```typescript
import { Text, Component } from "@mariozechner/pi-tui";

const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
  const text = new Text("Press Enter to confirm, Escape to cancel", 1, 1);

  text.onKey = (key) => {
    if (key === "return") done(true);
    if (key === "escape") done(false);
    return true;
  };

  return text;
});

if (result) {
  // User pressed Enter
}
```

The callback receives:
- `tui` - TUI instance (for screen dimensions, focus management)
- `theme` - Current theme for styling
- `keybindings` - App keybinding manager (for checking shortcuts)
- `done(value)` - Call to close component and return value

See [tui.md](tui.md) for the full component API.

#### Overlay Mode (Experimental)

Pass `{ overlay: true }` to render the component as a floating modal on top of existing content, without clearing the screen:

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  { overlay: true }
);
```

For advanced positioning (anchors, margins, percentages, responsive visibility), pass `overlayOptions`. Use `onHandle` to control visibility programmatically:

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  {
    overlay: true,
    overlayOptions: { anchor: "top-right", width: "50%", margin: 2 },
    onHandle: (handle) => { /* handle.setHidden(true/false) */ }
  }
);
```

See [tui.md](tui.md) for the full `OverlayOptions` API and [overlay-qa-tests.ts](../examples/extensions/overlay-qa-tests.ts) for examples.

**Examples:** [handoff.ts](../examples/extensions/handoff.ts), [plan-mode/index.ts](../examples/extensions/plan-mode/index.ts), [preset.ts](../examples/extensions/preset.ts), [qna.ts](../examples/extensions/qna.ts), [snake.ts](../examples/extensions/snake.ts), [summarize.ts](../examples/extensions/summarize.ts), [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts), [overlay-test.ts](../examples/extensions/overlay-test.ts)

### Custom Editor

Replace the main input editor with a custom implementation (vim mode, emacs mode, etc.):

```typescript
import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (matchesKey(data, "escape") && this.mode === "insert") {
      this.mode = "normal";
      return;
    }
    if (this.mode === "normal" && data === "i") {
      this.mode = "insert";
      return;
    }
    super.handleInput(data);  // App keybindings + text editing
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((_tui, theme, keybindings) =>
      new VimEditor(theme, keybindings)
    );
  });
}
```

**Key points:**
- Extend `CustomEditor` (not base `Editor`) to get app keybindings (escape to abort, ctrl+d, model switching)
- Call `super.handleInput(data)` for keys you don't handle
- Factory receives `theme` and `keybindings` from the app
- Pass `undefined` to restore default: `ctx.ui.setEditorComponent(undefined)`

See [tui.md](tui.md) Pattern 7 for a complete example with mode indicator.

**Examples:** [modal-editor.ts](../examples/extensions/modal-editor.ts)

### Message Rendering

Register a custom renderer for messages with your `customType`:

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  const { expanded } = options;
  let text = theme.fg("accent", `[${message.customType}] `);
  text += message.content;

  if (expanded && message.details) {
    text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
  }

  return new Text(text, 0, 0);
});
```

Messages are sent via `pi.sendMessage()`:

```typescript
pi.sendMessage({
  customType: "my-extension",  // Matches registerMessageRenderer
  content: "Status update",
  display: true,               // Show in TUI
  details: { ... },            // Available in renderer
});
```

### Theme Colors

All render functions receive a `theme` object:

```typescript
// Foreground colors
theme.fg("toolTitle", text)   // Tool names
theme.fg("accent", text)      // Highlights
theme.fg("success", text)     // Success (green)
theme.fg("error", text)       // Errors (red)
theme.fg("warning", text)     // Warnings (yellow)
theme.fg("muted", text)       // Secondary text
theme.fg("dim", text)         // Tertiary text

// Text styles
theme.bold(text)
theme.italic(text)
theme.strikethrough(text)
```

## Error Handling

- Extension errors are logged, agent continues
- `tool_call` errors block the tool (fail-safe)
- Tool `execute` errors are reported to the LLM with `isError: true`

## Mode Behavior

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI | Normal operation |
| RPC | JSON protocol | Host handles UI |
| Print (`-p`) | No-op | Extensions run but can't prompt |

In print mode, check `ctx.hasUI` before using UI methods.
