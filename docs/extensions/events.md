# Event Reference

Extensions subscribe to lifecycle events via `pi.on(event, handler)`.

## Quick Reference

| Event | When | Can Modify |
|-------|------|------------|
| `session_start` | Initial session load | - |
| `session_before_switch` | Before `/new` or `/resume` | Cancel |
| `session_switch` | After session switch | - |
| `session_before_fork` | Before `/fork` | Cancel, skip restore |
| `session_fork` | After fork | - |
| `session_before_compact` | Before compaction | Cancel, custom summary |
| `session_compact` | After compaction | - |
| `session_before_tree` | Before `/tree` navigation | Cancel, custom summary |
| `session_tree` | After tree navigation | - |
| `session_shutdown` | On exit (Ctrl+C, SIGTERM) | - |
| `before_agent_start` | After prompt, before agent | Inject message, system prompt |
| `agent_start` | Agent loop starts | - |
| `agent_end` | Agent loop ends | - |
| `turn_start` | Turn starts | - |
| `turn_end` | Turn ends | - |
| `context` | Before each LLM call | Messages |
| `tool_call` | Before tool executes | Block |
| `tool_result` | After tool executes | Result |
| `input` | User input received | Transform, handle |
| `model_select` | Model changes | - |

## Session Events

### session_start

```typescript
pi.on("session_start", async (_event, ctx) => {
  const sessionFile = ctx.sessionManager.getSessionFile();
  ctx.ui.notify(`Session: ${sessionFile ?? "ephemeral"}`, "info");
});
```

### session_before_switch / session_switch

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason - "new" or "resume"
  // event.targetSessionFile - session we're switching to (resume only)

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

### session_before_fork / session_fork

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId - ID of entry being forked from
  return { cancel: true };  // Cancel fork
  // OR
  return { skipConversationRestore: true };  // Fork without messages
});

pi.on("session_fork", async (event, ctx) => {
  // event.previousSessionFile - previous session file
});
```

### session_before_compact / session_compact

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

### session_before_tree / session_tree

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  return { cancel: true };
  // OR provide custom summary:
  return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

### session_shutdown

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Cleanup, save state, etc.
});
```

## Agent Events

### before_agent_start

Inject a message and/or modify system prompt:

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - user's prompt text
  // event.images - attached images
  // event.systemPrompt - current system prompt

  return {
    // Inject a persistent message (stored in session, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context",
      display: true,
    },
    // Modify system prompt for this turn (chained across extensions)
    systemPrompt: event.systemPrompt + "\n\nExtra instructions...",
  };
});
```

### agent_start / agent_end

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this prompt
});
```

### turn_start / turn_end

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
});
```

### context

Modify messages before each LLM call:

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

## Tool Events

### tool_call

Block or modify tool execution:

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // event.toolName - "bash", "read", etc.
  // event.toolCallId
  // event.input - tool parameters

  // Built-in tools: no type params needed
  if (isToolCallEventType("bash", event)) {
    // event.input is { command: string; timeout?: number }
    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command" };
    }
  }
});
```

### tool_result

Modify tool result (handlers chain like middleware):

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

## Input Events

### input

Intercept, transform, or handle user input before agent processing:

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - raw input (before skill/template expansion)
  // event.images - attached images
  // event.source - "interactive", "rpc", or "extension"

  // Transform: rewrite input
  if (event.text.startsWith("?quick ")) {
    return { action: "transform", text: `Brief: ${event.text.slice(7)}` };
  }

  // Handle: respond without LLM
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  return { action: "continue" };  // Pass through
});
```

**Results:** `continue` | `transform` | `handled`

## Model Events

### model_select

```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model - newly selected model
  // event.previousModel - previous model (undefined if first)
  // event.source - "set" | "cycle" | "restore"

  const prev = event.previousModel
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;

  ctx.ui.notify(`Model: ${prev} -> ${next}`, "info");
});
```
