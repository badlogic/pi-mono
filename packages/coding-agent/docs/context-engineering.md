# Context Engineering

Pi supports **context engineering** via hooks that can shape what is sent to the model at well-defined boundaries inside the agent loop.

This document focuses on **how to use** the hook surface (what events exist, what data you get, what you can return).

If you’re building custom context strategies, `/context` is the primary debugging surface.

- `/context` shows a **concise summary** by default.
- `/context --full` shows the full envelope dump.
- `/context --ephemeral` includes request-only ephemeral hook application.

It renders the effective ContextEnvelope, and it can optionally render persisted transforms via hook-provided renderers (see [ContextTransformDisplay renderers](#contexttransformdisplay-renderers)).

## Key idea: the Context Envelope

Every provider request is modeled as a single **`ContextEnvelope`**:

- **System**: `system.parts[]` (structured) + `system.compiled` (string sent to provider)
- **Tools**: `tools[]` (tool definitions: `name`/`description`/`parameters`)
- **Messages**:
  - `messages.cached[]` — the “stable” conversation history intended to be cacheable
  - `messages.uncached[]` — a request-only tail appended **last**
- **Options**: generation knobs (`reasoning`, `temperature`, `maxTokens`)
- **Meta**: request metadata for hooks (`model`, `limit`, `turnIndex`, `requestIndex`, `signal`, …)

Hooks operate on this envelope (not just messages).

## Cached vs uncached messages

Pi enforces:

- the provider receives: `messages.cached + messages.uncached`
- uncached messages are always appended **last**

Any patch op that modifies cached content must include an explicit `invalidateCacheReason`.

## The `context` hook

Hooks subscribe to a single `context` event and branch on `event.reason`:

```ts
type ContextReason = "before_request" | "ephemeral" | "turn_end";

interface ContextEvent {
  type: "context";
  reason: ContextReason;
  state: { envelope: ContextEnvelope };
}
```

### When it runs

- `context(before_request)`
  - runs before **each** provider call (including tool follow-up requests)
  - if you return a patch, it is persisted to the session as a `context_transform` entry

- `context(ephemeral)`
  - runs before the provider call
  - patches apply to **this request only** (not persisted / not replayed)

- `context(turn_end)`
  - runs after a full turn (assistant message + tool results)
  - if you return a patch, it is persisted to the session as a `context_transform` entry

### Return value

A `context` handler returns patch ops (plus optional display metadata):

```ts
interface ContextResult {
  patch?: ContextPatchOp[];
  transformerName?: string;
  display?: {
    title: string;
    summary?: string;
    markdown?: string;
    rendererId?: string;
    rendererProps?: unknown;
  };
}
```

### Patch operations

Patch ops are domain-specific and versioned at the session-entry layer.

Common operations:

- system:
  - `system_part_set`, `system_part_remove`, `system_parts_replace`
- tools:
  - `tools_replace`, `tools_remove`
- messages:
  - `messages_cached_replace`
  - `messages_uncached_append`
- options:
  - `options_set`
- compaction:
  - `compaction_apply`

See `ContextPatchOp` in `@mariozechner/pi-agent-core` for the authoritative list.

### System prompt parts

The system prompt is split into stable `system.parts[]` so hooks can target sections precisely.

Default part names produced by the coding agent:

- `base`
- `project_context`
- `skills`
- `runtime`

(`system.compiled` is always the concatenation of `system.parts` with no additional separators.)

### Tool patching

`envelope.tools` contains **tool definitions** (`name`, `description`, `parameters`).

If you patch tools:

- your patch must return tool definitions (not executors)
- when executing the request, Pi matches each definition to a loaded tool implementation by `name`
  - if a definition references an unknown tool name, the request fails

## Persistence and replay (high level)

Patches returned from `context(before_request)` and `context(turn_end)` are stored in the session as `context_transform` entries.

When rebuilding the envelope for a new request, Pi walks the active session path and applies transforms in a deterministic way:

- `context_transform` entries are replayed in order (hook code is not rerun)
- compaction is represented as a `compaction_apply` patch op (either stored in a `context_transform` entry or derived from legacy `compaction` entries)
- request-only context is logged as `ephemeral` entries but **never** replayed

## ContextTransformDisplay renderers

Persisted `context_transform` entries can carry optional `display` metadata.

If a transform sets `display.rendererId`, interactive `/context` can call a hook-registered renderer to show a richer view than plain markdown.

### End-user / hook-author workflow

1) Return `display` from your `context` handler (for persisted transforms):

```ts
return {
  transformerName: "my-transform",
  display: {
    title: "My Transform",
    summary: "…",
    // Optional: also show a transcript item in the chat UI
    // (this is NOT sent to the provider and is excluded from compaction/context).
    showInChat: true,
    rendererId: "my-transform-renderer",
    rendererProps: { /* JSON-serializable */ },
  },
  patch: [ ... ],
};
```

2) Register the renderer in your hook:

```ts
import { Text } from "@mariozechner/pi-tui";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.registerContextTransformRenderer("my-transform-renderer", (transform, options, theme) => {
    return new Text(theme.bold(transform.display?.title ?? transform.transformerName), 1, 0);
  });
}
```

3) Run `/context` in interactive mode.

- If a renderer is registered and the transform’s `display.rendererId` matches, Pi renders that component.
- Otherwise, Pi falls back to the markdown envelope view.

### How it’s implemented

- `display` is persisted on the `context_transform` entry.
- Hooks register renderers by ID via `pi.registerContextTransformRenderer(rendererId, renderer)`.
- The interactive `/context` command enumerates `context_transform` entries on the active session path and calls the renderer for any entry whose `display.rendererId` matches a registered renderer.
- Other surfaces (RPC/HTML/tree) cannot render interactive TUI components, so they fall back to `display.title`/`display.summary`/`display.markdown`.
- If `display.showInChat` is set, Pi also appends a transcript-only `contextTransform` message immediately after persisting the transform. This message is rendered in the chat UI (and HTML export), but is never sent to the provider.

## The `message_end` hook

Hooks can also mutate (or filter) finalized messages before they are persisted and become future context:

```ts
interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}

interface MessageEndResult {
  // Replace the message, or return null to filter it.
  message?: AgentMessage | null;
}
```

This is useful for redaction/normalization of tool output and other policies.

## Examples

### Add a persistent marker before every request

```ts
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("context", async (event) => {
    if (event.reason !== "before_request") return;

    const marker = { role: "user", content: "[marker]", timestamp: Date.now() };

    return {
      transformerName: "marker",
      patch: [
        {
          op: "messages_cached_replace",
          scope: "cached",
          messages: [...event.state.envelope.messages.cached, marker],
          invalidateCacheReason: "add marker",
        },
      ],
    };
  });
}
```

### Inject request-only ephemeral context

```ts
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("context", async (event) => {
    if (event.reason !== "ephemeral") return;

    const eph = { role: "user", content: "[request-only]", timestamp: Date.now() };

    return {
      patch: [{ op: "messages_uncached_append", scope: "uncached", messages: [eph] }],
    };
  });
}
```

### Persist a system prompt part change

```ts
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("context", async (event) => {
    if (event.reason !== "turn_end") return;

    return {
      transformerName: "system-policy",
      patch: [
        {
          op: "system_part_set",
          scope: "cached",
          partName: "policy",
          text: "\n\n# Policy\n\nNever output secrets.",
          invalidateCacheReason: "add policy section",
        },
      ],
    };
  });
}
```

## Related docs

- [hooks.md](./hooks.md)
- [session.md](./session.md)
- [rpc.md](./rpc.md)
