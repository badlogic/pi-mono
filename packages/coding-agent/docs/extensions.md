> pi can create extensions. Ask it to build one for your use case.

# Extensions

Extensions are TypeScript modules that extend pi's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more.

**Key capabilities:**
- **Custom tools** - Register tools the LLM can call via `pi.registerTool()`
- **Event interception** - Block or modify tool calls, inject context, customize compaction
- **User interaction** - Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()`
- **Custom commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** - Store state that survives restarts via `pi.appendEntry()`
- **Custom rendering** - Control how tool calls/results and messages appear in TUI

See [Examples Reference](#examples-reference) for working implementations.

## Table of Contents

- [Quick Start](#quick-start)
- [Extension Locations](#extension-locations)
- [Available Imports](#available-imports)
- [Writing an Extension](#writing-an-extension)
- [Events](#events)
- [ExtensionContext](#extensioncontext)
- [ExtensionCommandContext](#extensioncommandcontext)
- [ExtensionAPI Methods](#extensionapi-methods)
- [State Management](#state-management)
- [Custom Tools](#custom-tools)
- [Custom UI](#custom-ui)
- [Error Handling](#error-handling)
- [Mode Behavior](#mode-behavior)
- [Examples Reference](#examples-reference)

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
  "packages": ["npm:@foo/bar@1.0.0", "git:github.com/user/repo@v1"],
  "extensions": ["/path/to/extension.ts"]
}
```

Manage packages with CLI:

```bash
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo
pi remove npm:@foo/bar
pi list
pi update
```

**Package filtering:** Selectively load resources:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-extensions",
      "extensions": ["extensions/oracle.ts"],
      "skills": [],
      "themes": [],
      "prompts": []
    }
  ]
}
```

- Omit key = load all, empty array = load none
- Glob patterns and `!exclusions` supported
- User filters layer on top of manifest filters

**Package deduplication:** If same package in global and project settings, project wins.

**Discovery rules:**

1. Direct files: `extensions/*.ts` → loaded directly
2. Subdirectory with index: `extensions/myext/index.ts` → single extension
3. Subdirectory with package.json: `extensions/myext/package.json` with `"pi"` field → loads declared paths

```json
// package.json with pi manifest
{
  "name": "my-extension-pack",
  "keywords": ["pi-package"],
  "dependencies": { "zod": "^3.0.0" },
  "pi": {
    "extensions": ["./src/index.ts"],
    "skills": ["./skills/"],
    "prompts": ["./prompts/"],
    "themes": ["./themes/"]
  }
}
```

Run `npm install` in extensions with dependencies.

## Available Imports

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `@sinclair/typebox` | Schema definitions for tool parameters |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@mariozechner/pi-tui` | TUI components for custom rendering |

npm dependencies work if you add `package.json` next to extension. Node.js built-ins available.

## Writing an Extension

Export a default function receiving `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("event_name", async (event, ctx) => { ... });
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Extensions loaded via [jiti](https://github.com/unjs/jiti), TypeScript works without compilation.

**Styles:** Single file, directory with `index.ts`, or package with `package.json` for npm dependencies.

## Events

### Lifecycle Overview

```
pi starts → session_start

user sends prompt
  ├─► (extension commands bypass if found)
  ├─► input (can intercept/transform)
  ├─► (skill/template expansion)
  ├─► before_agent_start (inject message, modify system prompt)
  ├─► agent_start
  │   ┌─── turn (repeats while LLM calls tools) ───┐
  │   ├─► turn_start
  │   ├─► context (modify messages)
  │   │   LLM responds:
  │   │     ├─► tool_call (can block)
  │   │     └─► tool_result (can modify)
  │   └─► turn_end
  └─► agent_end

/new, /resume → session_before_switch → session_switch
/fork → session_before_fork → session_fork
/compact → session_before_compact → session_compact
/tree → session_before_tree → session_tree
/model, Ctrl+P → model_select
exit → session_shutdown
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
Fired on `/new` or `/resume`. Can cancel.

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason: "new" | "resume"
  // event.targetSessionFile (only for "resume")
  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});
```

#### session_before_fork / session_fork
Fired on `/fork`. Can cancel or skip conversation restore.

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId
  return { cancel: true };
  // OR: return { skipConversationRestore: true };
});
```

#### session_before_compact / session_compact
Fired on compaction. Can cancel or provide custom summary. See [compaction.md](compaction.md).

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // event.preparation, event.branchEntries, event.customInstructions, event.signal
  return { cancel: true };
  // OR: return { compaction: { summary: "...", firstKeptEntryId: "...", tokensBefore: 0 } };
});
```

#### session_before_tree / session_tree
Fired on `/tree` navigation. Can cancel or provide custom summary.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  // event.preparation, event.signal
  return { cancel: true };
  // OR: return { summary: { summary: "...", details: {} } };
});
```

#### session_shutdown
Fired on exit (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state
});
```

### Agent Events

#### before_agent_start
Fired after user submits prompt, before agent loop. Can inject message and/or modify system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt, event.images, event.systemPrompt
  return {
    message: { customType: "my-ext", content: "Context", display: true },
    systemPrompt: event.systemPrompt + "\n\nExtra instructions...",
  };
});
```

#### agent_start / agent_end
Fired once per user prompt.

```typescript
pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this prompt
});
```

#### turn_start / turn_end
Fired for each turn (one LLM response + tool calls).

```typescript
pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
});
```

#### context
Fired before each LLM call. Modify messages non-destructively.

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify
  return { messages: event.messages.filter(m => !shouldPrune(m)) };
});
```

### Model Events

#### model_select
Fired when model changes via `/model`, Ctrl+P, or session restore.

```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model, event.previousModel, event.source ("set" | "cycle" | "restore")
});
```

### Tool Events

#### tool_call
Fired before tool executes. **Can block.**

```typescript
pi.on("tool_call", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  if (shouldBlock(event)) return { block: true, reason: "Not allowed" };
});
```

#### tool_result
Fired after tool executes. **Can modify result.**

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input, event.content, event.details, event.isError
  if (isBashToolResult(event)) { /* event.details typed as BashToolDetails */ }
  return { content: [...], details: {...}, isError: false };
});
```

Type guards: `isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`

### User Bash Events

#### user_bash
Fired on `!` or `!!` commands. Can intercept.

```typescript
pi.on("user_bash", (event, ctx) => {
  // event.command, event.excludeFromContext, event.cwd
  return { operations: remoteBashOps };
  // OR: return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

### Input Events

#### input
Fired after extension commands checked, before skill/template expansion.

```typescript
pi.on("input", async (event, ctx) => {
  // event.text, event.images, event.source ("interactive" | "rpc" | "extension")
  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }
  return { action: "continue" };
});
```

Results: `continue` (default), `transform`, `handled`

## ExtensionContext

Every handler receives `ctx: ExtensionContext`:

| Property/Method | Description |
|-----------------|-------------|
| `ui` | UI methods. See [Custom UI](#custom-ui) |
| `hasUI` | `false` in print/RPC mode |
| `cwd` | Current working directory |
| `sessionManager` | Read-only: `getEntries()`, `getBranch()`, `getLeafId()` |
| `modelRegistry` | Model and API key access |
| `model` | Current model (may be undefined) |
| `isIdle()` | Whether agent is idle |
| `abort()` | Abort current operation |
| `hasPendingMessages()` | Whether messages are queued |
| `shutdown()` | Request graceful exit |
| `getContextUsage()` | Returns `{ tokens, contextWindow, percent, ... }` |
| `compact(options?)` | Trigger compaction with `onComplete`/`onError` callbacks |

## ExtensionCommandContext

Command handlers get `ExtensionCommandContext` (extends `ExtensionContext`):

| Method | Description |
|--------|-------------|
| `waitForIdle()` | Wait for agent to finish streaming |
| `newSession(options?)` | Create new session with optional `parentSession` and `setup` callback |
| `fork(entryId)` | Fork from entry, creating new session file |
| `navigateTree(targetId, options?)` | Navigate tree with `summarize`, `customInstructions`, `replaceInstructions`, `label` |

## ExtensionAPI Methods

### Event Subscription

```typescript
pi.on(event, handler)  // See Events section
```

### Tool Registration

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  parameters: Type.Object({ ... }),
  async execute(toolCallId, params, onUpdate, ctx, signal) { ... },
  renderCall?(args, theme) { ... },
  renderResult?(result, options, theme) { ... },
})
```

### Message Injection

```typescript
// Custom message
pi.sendMessage({ customType: "my-ext", content: "...", display: true, details: {} }, {
  triggerTurn: true,
  deliverAs: "steer" | "followUp" | "nextTurn"
});

// User message (always triggers turn)
pi.sendUserMessage("text" | [{ type: "text", text: "..." }], {
  deliverAs: "steer" | "followUp"  // required when streaming
});
```

### State Persistence

```typescript
pi.appendEntry("my-state", { count: 42 });  // Does NOT go to LLM
```

### Session Metadata

```typescript
pi.setSessionName(name)
pi.getSessionName()
pi.setLabel(entryId, label)
```

### Command Registration

```typescript
pi.registerCommand("name", {
  description: "...",
  getArgumentCompletions?: (prefix) => AutocompleteItem[] | null,
  handler: async (args, ctx) => { ... }
});
```

### Message Rendering

```typescript
pi.registerMessageRenderer("customType", (message, { expanded }, theme) => Component | undefined);
```

### Shortcuts and Flags

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "...",
  handler: async (ctx) => { ... }
});

pi.registerFlag("plan", { description: "...", type: "boolean", default: false });
pi.getFlag("--plan")
```

### Shell Execution

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### Tool Management

```typescript
pi.getActiveTools()      // ["read", "bash", "edit", "write"]
pi.getAllTools()         // [{ name, description }, ...]
pi.setActiveTools(names)
```

### Model and Thinking

```typescript
await pi.setModel(model)     // Returns false if no API key
pi.getThinkingLevel()        // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
pi.setThinkingLevel(level)
```

### Provider Registration

```typescript
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "PROXY_API_KEY",
  api: "anthropic-messages",
  headers?: { ... },
  authHeader?: true,
  models?: [{ id, name, reasoning, input, cost, contextWindow, maxTokens, compat? }],
  oauth?: { name, login, refreshToken, getApiKey, modifyModels? },
  streamSimple?: (model, context, options) => AssistantMessageEventStream
});
```

See [custom-provider.md](custom-provider.md) for details.

### Event Bus

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

## State Management

Store state in tool result `details` for proper branching:

```typescript
let items: string[] = [];

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
  async execute(...) {
    items.push("new");
    return { content: [...], details: { items: [...items] } };
  },
});
```

## Custom Tools

### Tool Definition

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google compatibility
    text: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params, onUpdate, ctx, signal) {
    if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
    return { content: [{ type: "text", text: "Done" }], details: {} };
  },
  renderCall(args, theme) { ... },
  renderResult(result, { expanded, isPartial }, theme) { ... },
});
```

### Overriding Built-in Tools

Register tool with same name (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`). Built-in renderer used if no custom render functions. Must match exact result shape including `details` type.

Use `--no-tools -e ./my-extension.ts` to start with only extension tools.

### Remote Execution

Built-in tools support pluggable operations:

```typescript
import { createReadTool, type ReadOperations } from "@mariozechner/pi-coding-agent";

const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});
```

Interfaces: `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`

### Output Truncation

Tools MUST truncate output. Built-in limit: 50KB / 2000 lines.

```typescript
import { truncateHead, truncateTail, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
if (truncation.truncated) {
  // Write full to temp file, inform LLM
}
```

### Custom Rendering

```typescript
import { Text } from "@mariozechner/pi-tui";

renderCall(args, theme) {
  return new Text(theme.fg("toolTitle", "my_tool ") + args.action, 0, 0);
}

renderResult(result, { expanded, isPartial }, theme) {
  if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);
  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) text += "\n  " + theme.fg("dim", item);
  }
  return new Text(text, 0, 0);
}
```

Use `keyHint(action, description)` for keybinding hints.

## Custom UI

See [tui.md](tui.md) for full component API.

### Dialogs

```typescript
const choice = await ctx.ui.select("Pick:", ["A", "B", "C"]);
const ok = await ctx.ui.confirm("Delete?", "Cannot be undone");
const name = await ctx.ui.input("Name:", "placeholder");
const text = await ctx.ui.editor("Edit:", "prefill");
ctx.ui.notify("Done!", "info" | "warning" | "error");
```

Dialogs support `timeout` (auto-dismiss with countdown) and `signal` (manual abort):

```typescript
const ok = await ctx.ui.confirm("Title", "Message", { timeout: 5000 });
```

### Widgets, Status, Footer, Header

```typescript
ctx.ui.setStatus("key", "text" | undefined);
ctx.ui.setWorkingMessage("Custom loading..." | undefined);
ctx.ui.setWidget("key", ["Line 1", "Line 2"], { placement: "aboveEditor" | "belowEditor" });
ctx.ui.setWidget("key", (tui, theme) => Component);
ctx.ui.setFooter((tui, theme, footerData) => Component | undefined);
ctx.ui.setHeader((tui, theme) => Component | undefined);
ctx.ui.setTitle("Window title");
```

### Editor

```typescript
ctx.ui.setEditorText("prefill");
ctx.ui.getEditorText();
ctx.ui.setEditorComponent((tui, theme, keybindings) => EditorComponent | undefined);
```

### Theme

```typescript
ctx.ui.theme.fg("accent", "text")
ctx.ui.getAllThemes()
ctx.ui.getTheme("light")
ctx.ui.setTheme("light" | themeObject)
```

### Custom Components

```typescript
const result = await ctx.ui.custom<T>((tui, theme, keybindings, done) => {
  return { render(width) { ... }, handleInput(data) { ... }, invalidate() { ... } };
}, { overlay?: true, overlayOptions?: { anchor, width, margin, ... }, onHandle?: (handle) => {} });
```

### Message Rendering

```typescript
pi.registerMessageRenderer("my-ext", (message, { expanded }, theme) => {
  return new Text(theme.fg("accent", message.content), 0, 0);
});
```

## Error Handling

- Extension errors logged, agent continues
- `tool_call` errors block the tool (fail-safe)
- Tool `execute` errors reported to LLM with `isError: true`

## Mode Behavior

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI | Normal operation |
| RPC | JSON protocol | Host handles UI |
| Print (`-p`) | No-op | Check `ctx.hasUI` |

## Examples Reference

All examples in [examples/extensions/](../examples/extensions/).

| Example | Description | Key APIs |
|---------|-------------|----------|
| **Tools** |
| `hello.ts` | Minimal tool registration | `registerTool` |
| `question.ts` | Tool with user interaction | `registerTool`, `ui.select` |
| `questionnaire.ts` | Multi-step wizard tool | `registerTool`, `ui.custom` |
| `todo.ts` | Stateful tool with persistence | `registerTool`, `appendEntry`, `renderResult` |
| `truncated-tool.ts` | Output truncation example | `registerTool`, `truncateHead` |
| `tool-override.ts` | Override built-in read tool | `registerTool` |
| **Commands** |
| `pirate.ts` | Modify system prompt | `registerCommand`, `before_agent_start` |
| `summarize.ts` | Conversation summary | `registerCommand`, `ui.custom` |
| `handoff.ts` | Cross-provider handoff | `registerCommand`, `ui.editor` |
| `qna.ts` | Q&A with custom UI | `registerCommand`, `ui.custom` |
| `send-user-message.ts` | Inject user messages | `registerCommand`, `sendUserMessage` |
| `shutdown-command.ts` | Graceful shutdown | `registerCommand`, `shutdown()` |
| **Events & Gates** |
| `permission-gate.ts` | Block dangerous commands | `on("tool_call")`, `ui.confirm` |
| `protected-paths.ts` | Block writes to paths | `on("tool_call")` |
| `confirm-destructive.ts` | Confirm session changes | `on("session_before_*")` |
| `dirty-repo-guard.ts` | Warn on dirty git repo | `on("session_before_*")`, `exec` |
| `input-transform.ts` | Transform user input | `on("input")` |
| `model-status.ts` | React to model changes | `on("model_select")` |
| **Compaction & Sessions** |
| `custom-compaction.ts` | Custom compaction summary | `on("session_before_compact")` |
| `trigger-compact.ts` | Trigger compaction manually | `compact()` |
| `git-checkpoint.ts` | Git stash on turns | `on("turn_end")`, `exec` |
| `auto-commit-on-exit.ts` | Commit on shutdown | `on("session_shutdown")`, `exec` |
| **UI Components** |
| `status-line.ts` | Footer status indicator | `setStatus` |
| `custom-footer.ts` | Replace footer | `setFooter` |
| `custom-header.ts` | Replace startup header | `setHeader` |
| `modal-editor.ts` | Vim-style editor | `setEditorComponent` |
| `rainbow-editor.ts` | Custom editor styling | `setEditorComponent` |
| `widget-placement.ts` | Widget positioning | `setWidget` |
| `overlay-test.ts` | Overlay components | `ui.custom`, overlay options |
| `overlay-qa-tests.ts` | Comprehensive overlay tests | `ui.custom`, all overlay options |
| `notify.ts` | Simple notifications | `ui.notify` |
| `timed-confirm.ts` | Dialogs with timeout | `ui.confirm`, timeout/signal |
| **Complex Extensions** |
| `plan-mode/` | Full plan mode implementation | All APIs |
| `preset.ts` | Saveable presets (model, tools) | `registerCommand`, `registerShortcut`, `registerFlag`, `setModel`, `setActiveTools` |
| `tools.ts` | Toggle tools on/off | `registerCommand`, `setActiveTools`, `SettingsList` |
| `claude-rules.ts` | Load rules from files | `on("before_agent_start")` |
| `file-trigger.ts` | File watcher triggers | `sendMessage` |
| **Remote & Sandbox** |
| `ssh.ts` | SSH remote execution | `registerFlag`, `on("user_bash")`, tool operations |
| `interactive-shell.ts` | Persistent shell | `on("user_bash")` |
| `sandbox/` | Sandboxed execution | Tool operations |
| `subagent/` | Spawn sub-agents | `exec`, tool registration |
| **Games & Fun** |
| `snake.ts` | Snake game | `registerCommand`, `ui.custom` |
| `space-invaders.ts` | Space Invaders game | `registerCommand`, `ui.custom` |
| `doom-overlay/` | Doom in overlay | `ui.custom`, overlay |
| **Providers** |
| `custom-provider-anthropic/` | Custom Anthropic proxy | `registerProvider` |
| `custom-provider-gitlab-duo/` | GitLab Duo integration | `registerProvider`, OAuth |
| **Misc** |
| `mac-system-theme.ts` | Auto-switch theme | `setTheme` |
| `antigravity-image-gen.ts` | Image generation | `registerTool`, Google Antigravity |
| `inline-bash.ts` | Inline bash execution | `on("tool_call")` |
| `with-deps/` | Extension with npm deps | Package structure |
