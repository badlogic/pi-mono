# Context Engineering

Pi supports **context engineering** via hooks that can shape what is sent to the model at well-defined boundaries inside the agent loop.

This document focuses on **how to use** the hook surface (what events exist, what data you get, what you can return).

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

When rebuilding the envelope for a new request, Pi:

1. walks the active session path
2. applies the last `compaction` entry (if any)
3. replays `context_transform` patches in order

Hook code is not rerun during replay; only the stored patches are applied.

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
