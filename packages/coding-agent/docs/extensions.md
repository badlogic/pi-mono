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
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)
- Games while you wait (see `snake.ts` example)

See [examples/extensions/](../examples/extensions/) for working implementations.

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
  "extensions": ["/path/to/extension.ts"]
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
    "lodash": "^4.0.0"
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
    // Handle event
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("--my-flag", { ... });
}
```

Extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

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
  ├─► before_agent_start (can inject message, append to system prompt)
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

#### session_shutdown

Fired on exit (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

Fired after user submits prompt, before agent loop. Can inject a message and/or append to the system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - user's prompt text
  // event.images - attached images (if any)

  return {
    // Inject a persistent message (stored in session, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    // Append to system prompt for this turn only
    systemPromptAppend: "Extra instructions for this turn...",
  };
});
```

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
  // event.turnIndex, event.message, event.toolResults
});
```

#### context

Fired before each LLM call. Modify messages non-destructively.

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify
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

## ExtensionContext

Every handler receives `ctx: ExtensionContext`:

### ctx.ui

UI methods for user interaction:

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"

// Status in footer
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Widget above editor
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setWidget("my-widget", undefined);  // Clear

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();
```

**Custom components:**

```typescript
const result = await ctx.ui.custom((tui, theme, done) => {
  const component = new MyComponent();
  component.onComplete = (value) => done(value);
  return component;
});
```

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

## ExtensionCommandContext

Slash command handlers receive `ExtensionCommandContext`, which extends `ExtensionContext` with:

```typescript
await ctx.waitForIdle();              // Wait for agent to finish
await ctx.newSession({ ... });        // Create new session
await ctx.branch(entryId);            // Branch from entry
await ctx.navigateTree(targetId);     // Navigate tree
```

## ExtensionAPI Methods

### pi.on(event, handler)

Subscribe to events. See [Events](#events).

### pi.registerTool(definition)

Register a custom tool callable by the LLM:

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
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    return {
      content: [{ type: "text", text: "Done" }],
      details: { result: "..." },
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", "my_tool ") + args.action, 0, 0);
  },

  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) return new Text("Working...", 0, 0);
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  },
});
```

**Important:** Use `StringEnum` from `@mariozechner/pi-ai` for string enums (Google API compatible).

### pi.sendMessage(message, options?)

Inject a message into the session:

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, {
  triggerTurn: true,          // Trigger LLM response if idle
  deliverAs: "steer",         // "steer", "followUp", or "nextTurn"
});
```

### pi.appendEntry(customType, data?)

Persist extension state (does NOT participate in LLM context):

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

### pi.registerCommand(name, options)

Register a command:

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  }
});
```

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for messages with your `customType`:

```typescript
pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  return new Text(theme.fg("accent", `[INFO] `) + message.content, 0, 0);
});
```

### pi.registerShortcut(shortcut, options)

Register a keyboard shortcut:

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    ctx.ui.notify("Toggled!");
  },
});
```

### pi.registerFlag(name, options)

Register a CLI flag:

```typescript
pi.registerFlag("--plan", {
  description: "Start in plan mode",
  type: "boolean",
  default: false,
});

// Check value
if (pi.getFlag("--plan")) {
  // Plan mode enabled
}
```

### pi.exec(command, args, options?)

Execute a shell command:

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

Manage active tools:

```typescript
const active = pi.getActiveTools();  // ["read", "bash", "edit", "write"]
pi.setActiveTools(["read", "bash"]); // Switch to read-only
```

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
