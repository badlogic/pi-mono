# Context Engineering

"Context engineering refers to the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference, including all the other information that may land there outside of the prompts." – Anthropic (12/29/25)

Reference: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Pi implements context engineering via **hooks** that can shape what is sent to the model at **well-defined boundaries inside the agent loop**, with explicit support for:

- prompt caching discipline (cached vs uncached)
- deterministic “patch-only replay” on resume
- request-only (ephemeral) experimentation without rewriting session history

This is an advanced feature. Misuse can:
- increase cost (by invalidating provider prompt caches)
- reduce quality (by removing important history)
- introduce confusing behavior (by injecting transient context)

## Key idea: the Context Envelope

Every provider request can be modeled as a single **ContextEnvelope**:

- **System**: `system.parts[]` (structured) + `system.compiled` (string sent to provider)
- **Tools**: `tools[]` (tool **definitions**: name/description/schema)
- **Messages**: split into
  - `messages.cached[]` — persistent conversation history intended to be cached
  - `messages.uncached[]` — request-only tail, appended **last**
- **Options**: generation knobs (`reasoning`, `temperature`, `maxTokens`)

Pi’s context hooks operate on this envelope (not just messages).

## Tools are part of the request contract (not just prompt text)

Tool calling providers do not treat tools as “advice”. Tools are a **structured interface contract**:

- the model is conditioned on the tool schemas/availability you send
- the runtime validates tool call arguments against those schemas
- the runtime executes tool calls by name

So context engineering sometimes needs to patch tool **definitions** (schemas/descriptions) to:

- reliably gate capability (remove/disable tools)
- align model outputs with what validation expects (schema overrides)
- reduce cost by shrinking the tool surface area

### Persistability constraint

Session files are JSONL. Persisted transforms must be serializable.

Tool **implementations** include executable functions, which are not serializable. Therefore:

- patch ops operate on tool **definitions** (serializable)
- at runtime, definitions are **rehydrated** to implementations by tool name

If a patched definition references a tool name that has no implementation loaded, the tool is omitted and any call will fail at runtime.

## Cached vs uncached (and why you must care)

Pi enforces a strict invariant:

- the provider always receives: `cachedMessages + uncachedMessages`
- uncached messages are always appended **last**

### Cache invalidation enforcement

Any patch op that modifies **cached** regions must include an explicit `invalidateCacheReason`.

If a hook modifies cached content without a reason, Pi throws (fail-fast). This is intentional: it prevents accidental prompt-cache busting.

Background on caching:
- https://platform.openai.com/docs/guides/prompt-caching

## Hook boundaries

Pi supports three orthogonal hook families:

1) **Persistent context transforms** (`context` hook, reasons: `before_request`, `turn_end`)
- Produces patch ops that update the durable “cached” state.
- Patch ops are persisted to the session file (`context_transform` entries).
- Effects apply to subsequent requests (including tool-followups and future prompts) via deterministic patch replay.

2) **Request-only context transforms** (`context` hook, reason: `ephemeral`)
- Operates on a request-local copy of the envelope.
- May add uncached tail content and/or temporarily prune/reorder cached content.
- Not persisted for replay. (Optionally logged for observability.)
- If it touches cached content, it must still declare `invalidateCacheReason` because it will invalidate prompt caching for that request.

3) **Per-message transforms** (`message` hook)
- Transforms finalized messages (`message_end`) before they are:
  - shown to the user
  - persisted
  - used as future context

## Mental model: turn vs request

- A **turn** is one assistant message plus its tool calls/results.
- A **request** is an individual provider call that produces one assistant message.
  - One turn can include multiple requests if tools are invoked.

## Choosing the right hook

- Need request-only context that should not become history? Use `context(ephemeral)`.
- Need to rewrite the durable request envelope before the next assistant call (including tool-followups)? Use `context(before_request)`.
- Need to apply a policy after seeing the entire turn (assistant + tool results)? Use `context(turn_end)`.
- Need to normalize or redact individual messages/tool results as they are finalized? Use the `message` hook.

If you want to inject persisted, user-visible context (not just shape the request), prefer:
- `before_agent_start` (inject once per user prompt)
- `sendMessage()` (inject any time; persisted as a custom message)

## How the pipeline runs (ordering)

For the lifecycle diagram, see [hooks.md – Lifecycle](./hooks.md#lifecycle).

The important ordering rules are:

1) **Patch replay** (persistent) — deterministic; does not execute hook code
2) `context(before_request)` (persistent) — cached patch ops; persisted
3) Built-in compaction preflight (optional; persistent)
4) `context(ephemeral)` (request-only) — applied to request-local envelope
5) Provider call
6) `message` hook — runs on finalized messages (`message_end`)
7) `context(turn_end)` (persistent) — cached patch ops; persisted
8) Built-in compaction evaluation (overflow/threshold) (optional)

## The `context` hook API

Hooks subscribe to a single `context` event and discriminate via `event.reason`:

```ts
type ContextReason = "before_request" | "ephemeral" | "turn_end";

interface ContextEvent {
  type: "context";
  reason: ContextReason;
  state: { envelope: ContextEnvelope };
}
```

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

### Boundary enforcement rules

Pi enforces:

- `context(before_request)` and `context(turn_end)`
  - may only emit patch ops that target durable state (`scope: "cached"`)
  - cached patch ops **must** include `invalidateCacheReason`

- `context(ephemeral)`
  - applies to a request-local envelope only (never replayed)
  - may emit `scope: "cached"` and/or `scope: "uncached"` patch ops
  - any cached patch op still requires `invalidateCacheReason` (because it will bust caching)

### Patch operations

Patch ops are domain-specific and versioned at the session-entry layer.

Common operations:

- system:
  - `system_part_set`, `system_part_remove`, `system_parts_replace`
- tools (definitions, not executors):
  - `tools_replace`, `tools_remove`
- messages:
  - `messages_cached_replace`
  - `messages_uncached_append`
- options:
  - `options_set`
- compaction:
  - `compaction_apply` (built-in)

See `ContextPatchOp` in `@mariozechner/pi-ai` for the authoritative list.

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

## Session persistence

Sessions are append-only JSONL. In the session-tree format, entries also carry `id`/`parentId` and only the **active path** is considered when rebuilding context.

Context engineering adds (or extends) these entry types:

### `context_transform` (persistent)

```json
{
  "type": "context_transform",
  "schemaVersion": 1,
  "transformerName": "redact",
  "timestamp": "2025-12-28T00:00:00.000Z",
  "patch": [
    {
      "op": "messages_cached_replace",
      "scope": "cached",
      "messages": [{"role":"user","content":"...","timestamp": 0}],
      "invalidateCacheReason": "redact secrets"
    }
  ],
  "display": {
    "title": "Redaction",
    "summary": "Removed secrets"
  }
}
```

Notes:
- Persistent transforms are replayed deterministically at request boundary.
- Hook code is **not** rerun during replay; only patches are applied.

### `ephemeral` (request-only, never replayed)

```json
{
  "type": "ephemeral",
  "timestamp": "2025-12-28T00:00:00.000Z",
  "messages": [
    {"role":"user","content":"[ephemeral]","timestamp": 0}
  ]
}
```

## Built-in compaction

Compaction is implemented as a **patch-based** context transform:
- persisted as `type: "context_transform"` with a `compaction_apply` patch op
- applied via the same deterministic patch replay mechanism as any other persistent transform

Legacy on-disk entries (`type: "compaction"`) are migrated on load.

### When auto-compaction runs

Auto-compaction is evaluated after `turn_end`:

- Overflow-triggered: the model returned a context overflow error.
  - compaction runs
  - the agent schedules an automatic retry

- Threshold-triggered: the conversation is approaching the model’s context window.
  - compaction runs
  - no retry is scheduled

Manual compaction (`/compact` or RPC `compact`) uses the same machinery.

## Debugging: `/context` and RPC

- Interactive mode: `/context` renders the current context envelope.
- RPC mode: `get_context` returns a markdown rendering of the envelope.

## Error handling

- `context` hook errors are treated as fatal for the current request (fail-fast).
  - This prevents silently proceeding with an unexpectedly unpatched or partially patched envelope.
- `message` hook errors are reported, but the original message is used.

If you write long-running `context` hooks (e.g. those that call an LLM), respect `event.state.envelope.meta.signal` for cancellation.

## Related docs

- [hooks.md](./hooks.md)
- [session.md](./session.md)
- [rpc.md](./rpc.md)
