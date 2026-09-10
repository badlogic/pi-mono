# Handoff: outstanding pico decisions

For `packages/agent/docs/pico/` at `08dc60bc5`. Everything below came out of design review and is
not yet in the documents. Nothing here introduces a primitive. Two parts: harness-side items, then
the presentation side (renderers and layouts), which is client code but constrains two harness
fields.

Verified absent upstream at `08dc60bc5`: `orphaned`, preview coalescing, kinds after open, hook
scratch, session lock, `Call` ergonomics, `byTaskId`, the renderer registry.

---

# Part 1 — Harness

## 1.1 Open degrades on missing kinds; it never refuses

Entry kinds already degrade correctly (stored facets carry projection, head and edits). Task kinds
do not: an unknown live task kind still rejects at open, so uninstalling a plugin makes a session
unopenable.

- **Background task, unknown kind**: parked. Not started, not recovered, not counted for idleness,
  reported. It resumes through `recover` when the kind is registered again.
- **Foreground task, unknown kind**: cannot be parked (it would keep the conversation busy forever)
  and cannot run. Open settles it with the reserved terminal status `orphaned`, which every kind
  has by definition, and reports it. post_tools treats a call whose tool task ended `orphaned` as a
  call with no result and writes a "tool unavailable" error result, so the exchange resolves and
  the input group is settled rather than stuck.
- **Terminal tasks of unknown kinds**: untouched, they are history.
- `inspect(call)` returns `{ start, inflight, orphaned }`.

Where: §5.2 (the paragraph that currently says an unknown live kind rejects), §6.4 Open, §9.1
`inspect`, §8.3 post_tools, and the guide's "Opening".

## 1.2 Kinds may be registered after open

A plugin reload adds entry and task kinds. Registration at any time is fine; removing a task kind
is refused while live tasks of that kind exist; changing the shape of a live kind is a process
replacement, as `plugins.md` already says. This is what makes 1.1's parking useful.

Where: §9.5 near `Harness.open`'s registries.

## 1.3 A session lock at open

`08dc60bc5` says no renewable lease is required, and that is right for telemetry and versioning,
but nothing addresses two processes opening the same session after a crash. Add the minimum: a lock
file next to the JSONL (a lease row in SQLite) taken at open and released at close; a live lock
refuses to open; a stale one is taken over after a timeout. Not renewable, not on the hot path.

Where: §1 "one writer per session", §6.4 Open/Close, §7.4/§7.5.

## 1.4 Preview delivery is coalesced

Scratch commits are never delayed, but `task_output` delivery to watchers is coalesced per task to
a frame interval (the rules in `docs/mobile-handoff/01-harness/04-tool-output/rate-limiting.md`),
so a fast stream produces one event per frame instead of one per token. Without this a TUI redraws
per token.

Where: §9.4, next to the tracker paragraph.

## 1.5 Hook handlers receive the task's scratch

A handler that waits on a person (approval, a question) must be able to memoize its answer durably,
or a crash mid-wait re-asks and a crash after the answer asks again. Give handlers `scratch` and
the task id in their context, and state the pattern: read-then-set in one scratch commit, first
writer wins; a crash before the answer asks again, a crash after replays to the same answer; the
memo retires with the task. This replaces `plugins.md`'s `memoOnce` and invocation-memo API, and it
is the same shape the question extension needs.

```typescript
h.hooks.on(toolKind, 'before_tool', async ({ toolName, args, scratch, taskId }, call) => {
  if (toolName !== 'bash') return;
  const decision = scratchValue<'allow' | 'deny'>('approval');
  let d = await scratch(sc => sc.value(decision).get(), call);
  if (d === undefined) {
    d = await approvals.ask(taskId, args, call);        // keyed instance every presentation observes
    d = await scratch(sc => sc.value(decision).get() ?? (sc.value(decision).set(d), d), call);
  }
  return d === 'allow' ? { args } : { block: { reason: 'denied by user' } };
});
```

Where: §8.7 and the guide's Hooks section.

## 1.6 `Call` ergonomics

The required final `Call` is consistent with Chord and carries cancellation, telemetry and
invocation identity; keep it. The cost is `undefined` placeholders and noise in every client line.
Two mitigations, neither changing the model:

- Options-object form for the multi-argument methods: `c.prompt({ input, requestId }, call)`,
  `c.fork({ at, abort }, call)`.
- A bound handle for callers that have one Call per request: `h.for(call)` returns the same
  interface with Call pre-applied. Task code keeps the explicit form, because its Call changes per
  invocation.

Where: §9.1, and the guide's "Calls and cancellation".

## 1.7 Read before the commit, not inside the builder

Async Tx builders are necessary (post_tools reads its tool tasks) but they make the line's duration
depend on storage reads inside plans. State the discipline: a builder may read, and a plan that
needs more than a couple of reads should do them before the commit and pass values in. Never await
an external effect, a driver waiter or another line operation inside a builder (already said; keep
it adjacent).

Where: §9.2, under the async-builder paragraph.

## 1.8 Work plan additions

- **Budget adoption** as its own package, not a paragraph: adopting a non-delegating tool's
  in-flight work after the budget expires needs an explicit transfer of effect and sink ownership
  before the source invocation releases its slot. The job-first path ships first.
- **Package 21**: a versioned wire schema generated from the view, event, controller and approval
  types, for non-JS clients and SDKs.
- **Package 22**: a permission policy plugin over `before_tool` (ask always / once per session /
  never for read-only / by sandbox mode) with its typed request/response in that schema.
- **Package 23**: lane-JSONL → pico session migration, or a documented cutover; decide before lanes
  become the installed base.
- **Copy, never import**: nothing under `src/harness/pico/` imports from `runtime/`, `session/`,
  `agent-harness.ts` or the `dom`/`pico`/`pico2` spikes. Reusable code (`ExecutionEnv`, output
  capture, the built-in tools, prompt builders, telemetry helpers) is copied in and owned there;
  pico must build with the rest of `src/harness` deleted. Real dependencies are `chord` and `pi-ai`.

Where: `pico-work.md`.

---

# Part 2 — Presentation

## 2.1 Task provenance is `byTaskId`, not `JobState.origin`

`origin: { tool, task, callId }` is a kind-specific enum for something the harness knows
generically. Replace it with a field the `Tx` fills from the committing invocation:

```typescript
interface Task { …; readonly byTaskId?: Id }   // task whose commit created it; absent = created outside any task
```

A tool's job has `byTaskId` = the tool task, so a renderer reads that task, `toolKind.is(t)`, and
uses the tool's component. A schedule is a job with `every` in its own state; nothing else marks it.
Subagent tasks chain `byTaskId` up to the `run`/`spawn` tool. `Entry.byTaskId` already exists; this
makes tasks symmetric. Remove `origin` from `JobState`, from the bash example in §8.3 and from the
notice text (derive it from the creating task).

Where: §5.1, §8.3, §8.6.

## 2.2 `!cmd` is a client-owned task kind

User-run bash is initiated by the UI, not by the model or a tool, so it is its own kind owned by
the coding agent (or its bash plugin), sharing the exec-into-scratch helper with `jobKind`. Its
settlement writes the transcript entry in the same commit as `settle`, so a client that dies in
between leaves nothing to repair:

```typescript
const userBashKind = defineTaskKind({
  kind: 'pi.user_bash',
  initialStatus: 'planned',
  roles: { planned: 'start', running: 'inflight', done: 'terminal', killed: 'terminal', lost: 'terminal' },
  preview: { init: scratch => scratch.value(output).get() ?? emptyOutput() },

  async execute(task, runtime, call) {
    await runtime.commit(tx => tx.patch(task.id, { status: 'running' }), call);
    const result = await execIntoScratch(runtime, task.state, call);       // same helper as jobKind
    const out = runtime.preview.state;
    await runtime.commit(tx => {
      tx.entry(userBashKind.entry, {
        data: { cmd: task.state.cmd, exitCode: result.exitCode, output: out },
        model: task.state.includeInContext ? [userBashMessage(task.state.cmd, out, result.exitCode)] : undefined,
      });
      tx.settle(task.id, 'done', { ...task.state, exitCode: result.exitCode });
    }, call);
  },
  async recover(task, runtime, call) { await runtime.commit(tx => tx.settle(task.id, 'lost', task.state), call); },
  async abort(task, runtime, call)   { await runtime.commit(tx => tx.settle(task.id, 'killed', task.state), call); },
});

// the "!" handler
await c.commit(tx => tx.task(userBashKind, { background: true, state: { cmd, cwd, includeInContext, limits } }), call);
// Escape → h.abortTask(id, call); the renderer's task_start / task_output / entry cases do the rest
```

This is the pattern for any client-owned "thing that runs and should appear in the transcript": a
kind, not a flag on a built-in. Use it as the guide's example of a client-defined task kind; it is
better than the reminder.

Where: the guide's "Writing Kinds".

## 2.3 Two rendering styles are first-class

§9.4 presents `apply(view)` diffing as the way to render. It is one of two, and the other is the
coding agent's interactive mode unchanged:

- **Event-driven**: `task_start` on a generation makes a streaming component; `task_output` updates
  it from the view's preview; `task_start` on a tool makes a tool component; `task_end` retires it;
  `entry` finalizes. Bookkeeping is one streaming component and one map, as today.
- **View-driven**: `apply(view)` diffing against what was last drawn, for clients that attach
  mid-turn or resnapshot.

The view is authoritative in both: it is what a client renders on attach, and it has been folded
before the listener runs. Rewrite the "The view is authoritative and the events are wake-ups"
paragraph accordingly, and lead the guide's Rendering section with the event switch.

Mapping from `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (`handleEvent`,
`renderSessionEntries`):

| interactive mode | pico |
|---|---|
| `agent_start` / `turn_start` / `message_start(assistant)` | `task_start`, `generationKind.is(t)` |
| `message_update`, including tool components born from streaming tool calls (keyed by call id) | `task_output` on the generation; preview is the partial `AssistantMessage` |
| `message_end`; aborted/error → pending tools get error results, else `setArgsComplete` | `entry`, `assistantKind.is(e)` |
| `tool_execution_start` / `_update` / `_end` | `task_start` / `task_output` / `task_end` on the tool task; result via `entry`, `toolResultKind.is(e)`, keyed by `e.key` |
| `compaction_start` / `_end` | `task_start` / `task_end`, `collapseKind.is(t)`; re-render on the summary `entry` |
| `auto_retry_start` / `_end` | `task_update` to/from `retry_wait`; failure on `task_end` `failed` |
| `summarization_retry_*` | `task_update` on the collapse task |
| `agent_end` / `agent_settled` | after any `task_end`: no live foreground task in the view |
| `queue_update` | `inbox` |
| `thinking_level_changed` | `value`, `addr === generationKind.config.thinking` |
| `session_info_changed` | session watch `value` |
| `entry_appended(custom)` | `entry` of a plugin or unregistered kind |
| `bash_execution_update` | `task_output` on a `pi.user_bash` task (2.2) |

One map more than today: tool task id → call id, because tool components are created while the
assistant message streams (by call id) and only later associated with their task.

## 2.4 Typed preview access

Renderers should not cast. The view offers a typed accessor witnessed by the kind, alongside the
raw map the reducer and the wire use:

```typescript
interface ConversationView {
  readonly previews: ReadonlyMap<Id, JsonValue>;                          // raw, kind-free
  preview<P>(kind: TaskKind<any, any, any, P>, task: Id): P | undefined;  // typed; undefined if missing or another kind
}
const msg = w.view.preview(generationKind, event.task);   // AssistantMessage | undefined
const out = w.view.preview(toolKind, event.task);         // ToolOutputState | undefined
```

`kind.is(task)` already narrows `task.state` in the `task_*` cases.

Where: §9.4 and every example that currently casts.

## 2.5 Renderer registry and layouts

Rendering has two jobs and the client keeps them apart:

- **Renderers**, one per kind, replaceable: `renderers.entry(kind, previous => …)` and
  `renderers.task(kind, previous => ({ start, output?, update?, end }))`. Built-ins register the
  same way, so a plugin replaces or wraps one by re-registering under the same kind and receiving
  the previous renderer. An unregistered kind gets a generic fallback: model text or collapsed
  data for entries, kind + status + preview for tasks. Renderers never parent components.
- **Layouts**, pure functions over the ordered list of rendered blocks:
  `Layout = (blocks: Block[], view) => LayoutNode[]`, where a node is a block or a group
  `{ key, label, collapsed, children }`. Applied in registration order; the client reconciles the
  tree with the chat container by key and keeps open/closed state by key.

Grouping tool calls per exchange and collapsing a run until its final answer are each about ten
lines of layout, and they compose. Hydration on attach and live rendering share one path: build
blocks from `view.entries` and `view.tasks`, run the layouts, reconcile. The non-rendering
concerns of today's handler (Escape-handler swaps for retry and compaction, the working indicator,
the post-summary re-render, shutdown checks) stay in the mode; a plugin does not get to hijack
Escape.

This is presentation-side only, the contribution shape `plugins.md` already describes for tool
renderers, keyed by kind string on the wire and by kind object in code. It belongs in the guide's
Rendering section and in `pico-work.md` package 20 as the TUI's parity target.
