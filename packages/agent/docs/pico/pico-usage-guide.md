# pico

Durable agent harness for pi: one session file, any number of conversations, every piece of work
recorded as a task that survives a crash, and a view any UI can render.

**Note**: this guide is about using the harness. `pico-v3.md` is the design and the reference for
why things are the way they are.

## Table of Contents

- [The Mental Model](#the-mental-model)
- [Calls and Cancellation](#calls-and-cancellation)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Sessions and Conversations](#sessions-and-conversations)
  - [Opening](#opening)
  - [What Happens on Reopen](#what-happens-on-reopen)
  - [Closing](#closing)
- [Configuration](#configuration)
  - [Settings Declared by Kinds](#settings-declared-by-kinds)
  - [Reading and Writing](#reading-and-writing)
  - [What Is Rewindable](#what-is-rewindable)
- [System Prompt and Tool Loadout](#system-prompt-and-tool-loadout)
  - [How It Works](#how-it-works)
  - [Answering the Hook](#answering-the-hook)
  - [Changing the Loadout](#changing-the-loadout)
  - [Sections from Plugins](#sections-from-plugins)
  - [Subagents Have Their Own](#subagents-have-their-own)
  - [Compaction, Forks and Restarts](#compaction-forks-and-restarts)
- [Prompting](#prompting)
  - [prompt, accept, drive](#prompt-accept-drive)
  - [Input While Busy](#input-while-busy)
  - [Aborting](#aborting)
- [Watching](#watching)
  - [The View](#the-view)
  - [Events](#events)
  - [Rendering](#rendering)
  - [Remote Clients](#remote-clients)
  - [Session Watch](#session-watch)
- [Forks](#forks)
- [Compaction and Reset](#compaction-and-reset)
- [Subagents](#subagents)
- [Jobs and Schedules](#jobs-and-schedules)
- [Plugin State](#plugin-state)
  - [Values and Lists](#values-and-lists)
  - [Atomic Commits](#atomic-commits)
- [Writing Tools](#writing-tools)
  - [The Sink](#the-sink)
  - [Diagnostics](#diagnostics)
  - [Long-Running Tools](#long-running-tools)
- [Hooks](#hooks)
- [Writing Kinds](#writing-kinds)
  - [Entry Kinds](#entry-kinds)
  - [Task Kinds](#task-kinds)
- [Recovery](#recovery)
- [Storage Backends](#storage-backends)

## The Mental Model

A **session** is one storage file (or one row set in SQLite). It holds **conversations**. A
conversation has three things:

- a **transcript**: an append-only list of immutable **entries**. User messages, assistant messages,
  tool results, summaries, system instructions, and anything a plugin wants to record. Entries are
  never edited or reordered.
- **tasks**: the units of work. Generating a response is a task, running a tool is a task, so is
  compacting, running a background process, or anything a plugin wants done. A task has a status
  that changes as it runs and is written to storage at every step, which is what makes a crash
  recoverable.
- **state**: keyed **values** and **lists**, for the model in use, plan mode, a game board, whatever
  a plugin needs to remember.

What the model sees, the **context**, is not stored as a list. Each entry may store `model`
messages, a **head** boundary, and **edits** that omit or replace earlier model messages. The harness
prepends the newest head, reads forward from its stored boundary, folds retained edits, then performs
request-local tool and provider normalization. Compaction appends a head; tool-result pruning
appends an edit. Forks, compaction and reset never mutate old entries.

Every id is a session sequence number, minted when the write is built and never changed:

```typescript
type Id = number;
```

All writes happen through **commits**: a closure that runs on the session's single write line,
where everything inside it lands together or not at all. Tasks run concurrently; writes never do.

Nothing runs by itself. Opening a session starts nothing. **Driving** a conversation is what makes
its tasks execute, and a `prompt` is just accept + drive + read the answer. A UI **watches** a
conversation and gets a **view** it can render from directly.

## Calls and cancellation

Every asynchronous harness, conversation and task-runtime operation takes a required final `Call`.
`Call` is a type alias of Chord `Context`: it carries an abort signal, telemetry parent and, for task
code, a private typed invocation identity. It is not model context. No casts or admission helpers
are needed. Pure accessors, synchronous registrations and methods inside a transaction take no Call.

```typescript
import type { Call } from '@earendil-works/pi-agent';
import { BACKGROUND_CONTEXT, withCancel } from '@earendil-works/chord/context';

const call: Call = BACKGROUND_CONTEXT; // host call, without cancellation
const { context: waitingCall, cancel } = withCancel(call);
const waiting = conversation.drive(waitingCall);
cancel();                            // removes this waiter; does not abort durable work
await waiting;                       // rejects with cancellation
```

Tasks receive `(task, runtime: TaskRuntime, call: Call)` and forward `call`. Tools receive
`(toolCallId, params, out, runtime: ToolRuntime, call: Call)`. Environment/provider/hook operations
interpret the signal; custom handlers must cooperate. Derive a Call for nested telemetry or a tighter
deadline and pass it onward. The driver does not inherit a drive caller's signal into task execution.

The line reads task identity through a private `createContextKey<Invocation>`; Chord returns the
correct type from `call.value(key)`. Derived calls preserve that exact object. Stale task writes
reject. No invocation identity is serialized over RPC; trusted host bindings supply it locally.
Deliberately using an unrelated host Call or ignoring cancellation is an in-process escape, not
something a facade or type can prevent.

## Installation

```bash
npm install @earendil-works/pi-agent
```

## Quick Start

```typescript
import { Harness, JsonlStorage, type Call } from '@earendil-works/pi-agent';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { readTool, writeTool, bashTool } from '@earendil-works/pi-agent/tools';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

const call: Call = BACKGROUND_CONTEXT;

// One file per session. Reopening the same file resumes it.
const storage = await JsonlStorage.open('./session.jsonl');

// The built-in kinds (generation, tool, post_tools, collapse, job; the entry kinds) and the
// subagent and job tools are registered by open. You add models and the tools you want. Nothing runs yet.
const h = await Harness.open(storage, {
  models: builtinModels(),
  tools: [readTool, writeTool, bashTool],
}, call);
const { generation: generationKind } = h.kinds;   // the registered kinds, for config and hooks

const c = await h.root(call);

// Config is declared by the kinds that read it. The generation kind declares model, thinking and
// selected tools; `settings` is shorthand for its config.
await c.settings.set({
  model: { provider: 'anthropic', modelId: 'claude-opus-5' },
  thinking: 'high',
  selectedTools: ['read', 'write', 'bash'],
}, call);

// The system prompt is not stored as config. Each turn the harness asks this hook what the
// instructions should be right now, compares with what the transcript says the model was told,
// and writes only the difference. See "System Prompt and Tool Loadout".
c.hooks.on(generationKind, 'system_instructions', async ({ config }, call) => ({
  sections: {
    identity: 'You are a careful engineer working in this repository.',
    cwd: `Working directory: ${process.cwd()}`,
  },
  tools: h.tools.select(config.selectedTools),   // complete tool definitions
}), { subtree: true });

// Watch the conversation. `view` is a plain object a UI renders from; attach whenever you like,
// the view is complete as of the moment you attach and events follow from there.
const w = await h.watch(c.id, { tail: 100 }, call);
w.start(event => {
  if (event.type === 'task_output') {
    // the generation's preview is the partial assistant message; a tool's is its output so far
    const preview = w.view.previews.get(event.task);
    process.stdout.write(renderPreview(preview));
  }
  if (event.type === 'entry') console.log(`\n[entry ${event.entry.id} ${event.entry.kind}]`);
});

// accept the input, drive the conversation until it is idle, return the answer to that input
const answer = await c.prompt('Inspect the parser and list the public API', undefined, call);
console.log(answer?.model[0]?.content);

w.unsubscribe();
await h.close(call);   // cancels nothing durable; reopening the file continues exactly here
```

Run it, kill it in the middle, run it again: the second run recovers whatever was in flight
(publishing a partial answer, rerunning or reporting an interrupted tool) and continues. That is the
whole point.

Snippets below assume `h`, `c` and `call` set up like this. Optional options before Call are passed
as `undefined` when unused. A task or hook always forwards its supplied Call, not this host root.

## Sessions and Conversations

### Opening

`Harness.open(storage, options, call)` takes the storage backend and everything that defines behaviour:

| option | what it is |
|---|---|
| `models` | a pi-ai `Models` collection |
| `tools` | what the model may call, besides the built-in `subagent` and `job` tools; a `ToolRegistry` or an array |
| `kinds` | plugin entry and task kinds, added to the built-ins |
| `replace` | a built-in kind swapped by name (`{ generation: myGenerationKind }`); it must keep the statuses and hook names |
| `rootValues` | initial values for the root conversation on a fresh session |

The built-in kinds are registered by `open` itself, because `accept`, `prompt`, `steer` and
`collapse` cannot work without them. Refer to whatever is registered through `h.kinds`:

```typescript
h.kinds.generation   // config: model, thinking, selectedTools, ...; hooks: system_instructions, before_request, on_yield
h.kinds.tool         // hooks: before_tool, after_tool
h.kinds.collapse     // hooks: before_collapse
h.kinds.job
```

A replacement is usually a wrapper that delegates to the original for everything it doesn't
change:

```typescript
import { generationKind } from '@earendil-works/pi-agent/kinds';
const h = await Harness.open(storage, { models, tools, replace: {
  generation: { ...generationKind, async execute(task, runtime, call) { await audit(task); return generationKind.execute(task, runtime, call); } },
}}, call);
```

Open checks the recorded kind strings without scanning the transcript and reports live work, but
starts nothing. An unregistered historical entry kind is reported, not rejected: its stored
`model`, `head` and `edits` still build context, while its typed data and custom renderer are
unavailable. A live task kind is still required.

```typescript
const { start, inflight, orphaned, parked } = await h.inspect(call);
// start: tasks that never began or must begin again (a planned tool, a retry, a scheduled job)
// inflight: tasks the last process was running when it stopped; recover() will handle them
// orphaned: foreground tasks whose kind is missing (a plugin was uninstalled); settled at open
// parked:   background tasks whose kind is missing; they resume when it is registered again
```

### What Happens on Reopen

Nothing, until something drives a conversation. `h.drive()` starts and recovers eligible foreground
and background work across the session; `c.drive()` does the same for one conversation's ownership
scope. Each promise resolves when its scope has no live foreground task. Its attached background
work remains served afterwards. A UI usually attaches a watch to what it shows and drives that.

```typescript
const h = await Harness.open(storage, opts, call);
void h.drive(call).catch(error => console.error(error)); // resume; report session faults
```

### Closing

```typescript
await h.close(call);         // cancel in-process work, write nothing; everything resumes on the next open
await h.shutdown(call);      // mark live tasks, wait for abort cleanup, close; queued input survives
```

`close` is the normal exit: it stops admission on the commit line, then signals and joins owned
invocations outside it, without writing task outcomes. Earlier line operations have already finished;
later mutations reject. Close waits for actual invocation completion, regardless of caller cancellation.
An uncooperative task can delay it indefinitely.

`shutdown` closes normal admission and atomically marks live tasks only. Queued input and its queued
result records remain stored, including in idle conversations. Fresh abort handlers resolve their
already-running input groups and finish cleanup. Built-in child cleanup marks tasks only, never drains
child queues, including after a crash and reopen. Shutdown waits for both live tasks and running calls
to disappear before closing. Preserved queues create no work by inference on reopen/drive.

Once admitted, caller cancellation does not abandon shutdown. Repeated lifecycle calls share
completion; explicit close interrupting shutdown makes shutdown reject. Task calls cannot invoke
host lifecycle methods.

## Configuration

### Settings Declared by Kinds

There is no settings object. A task kind declares the values it reads, typed, and that declaration
is the only place the address is spelled:

```typescript
generationKind.config
// {
//   model:         conversationValue<ModelRef>('pi.model', { rewind: true }),
//   thinking:      conversationValue<ThinkingLevel>('pi.thinking', { rewind: true }),
//   selectedTools: conversationValue<string[]>('pi.tools.selected', { rewind: true }),
//   profile:       conversationValue<string>('pi.prompt.profile', { rewind: true }),
//   budgetMs:      conversationValue<number>('pi.tool.budget', { rewind: false }),
// }
```

A UI can list what a conversation is configured with by walking the registered kinds' `config`;
a plugin declares its own values the same way (see [Task Kinds](#task-kinds)).

### Reading and Writing

```typescript
// all of a kind's values, one batched read
const { model, thinking } = await c.config(generationKind).get(call);

// some of them, one commit
await c.config(generationKind).set({ thinking: 'low' }, call);

// `settings` is config(generationKind), because that is what every UI touches
await c.settings.set({ model: { provider: 'openai', modelId: 'gpt-5.6' } }, call);

// one value, one point read, by its declared address
const tools = await c.value(generationKind.config.selectedTools).get(call);
```

A change is a normal commit: it appears in the watch stream as a `value` event, and the next
generation picks it up. Nothing is cached in memory that could disagree with storage.

### What Is Rewindable

A value is either **rewindable** (its history is kept, a fork at an entry sees the value in force
there) or **sticky** (current only; the UI's present, not the conversation's history). Model,
thinking and selected tools are rewindable: forking at yesterday's answer gets yesterday's model.
Something like `ui.expanded` is sticky.

Children created by `spawn` don't inherit history; they are initialized explicitly (see
[Subagents](#subagents)).

## System Prompt and Tool Loadout

### How It Works

pi-ai models the system prompt as messages in the transcript: the first rendered prompt of a
session is the provider's stable, cached baseline, and later changes are appended as
`SystemMessage`s that say what changed (and carry `toolsAdded`/`toolsRemoved` with complete tool
definitions). pico is built on that, and keeps two things apart:

- **What you want right now.** Config (model, thinking, selected tools, a profile) plus whatever
  the host has: cwd, skills, context files, the tool catalogue. The host answers a hook with it
  each turn. None of it is stored.
- **What the model has been told.** `system` entries in the transcript: structured `data` for the
  baseline or delta and the exact materialized `SystemMessage` in `model`. These are immutable facts
  about requests that happened, so they fork and compact like every other entry.

At the top of every turn the generation renders the first, folds the second out of the context, and
appends the difference, if any, with both its structured data and model message before it projects
the request. The host keeps rendering "the whole prompt" the way it always did; the harness turns
that into append-only deltas.

### Answering the Hook

The hook is `system_instructions` on the generation kind. It returns keyed **sections** (rendered
in the order given) and the **tool definitions** the model may call. Register it on the conversation
with `subtree: true` so subagents inherit it unless they register their own:

```typescript
c.hooks.on(generationKind, 'system_instructions', async ({ conversationId, config }, call) => ({
  sections: {
    identity:      IDENTITY,
    cwd:           `Working directory: ${cwd}`,
    context_files: await renderContextFiles(cwd, call),      // AGENTS.md and friends
    skills:        skills.render(),
  },
  tools: h.tools.select(config.selectedTools),         // complete definitions, from the catalogue
}), { subtree: true });
```

After the first turn the transcript holds what was sent:

```text
10 user      "Inspect the parser"
11 system    { baseline, sections: [identity, cwd, context_files, skills], tools: [read, write, bash] }
12 assistant ...
```

The tool definitions are stored in full, not as names, and the model message is materialized in the
same append. A later change to a tool's description is therefore a change the model gets told about,
and an old transcript is sent the way it was originally recorded without running entry-kind code.

### Changing the Loadout

Every change is either a config write or something the host renders differently. Nothing is
written at that moment; the next generation notices and appends one entry:

```typescript
await c.settings.set({ selectedTools: ['read', 'write', 'bash', 'grep'] }, call);
// next turn → 20 system { toolsAdded: [grep] }

await c.settings.set({ selectedTools: ['read'] }, call);
// next turn → 30 system { toolsRemoved: [write, bash, grep] }

// the user installs a skill; skills.render() changes
// next turn → 40 system { sections: [skills] }        "the skills section now reads: ..."

h.tools.replace('mcp', newDefinitions);                 // an MCP server restarted with a changed schema
// next turn → 50 system { toolsAdded: [the changed definition] }   same name, new definition = a change
```

The provider's cached prefix through the previous message is untouched by any of these. On models
with native mid-conversation system messages the entry goes out as one; elsewhere pi-ai renders it
as a tagged user turn.

### Sections from Plugins

A plugin contributes sections from its own state. Handlers for the same point merge by key;
`undefined` removes a key. Register harness-wide when the section applies to every conversation:

```typescript
const planMode = conversationValue<boolean>('plan.mode', { rewind: true });

h.hooks.on(generationKind, 'system_instructions', async ({ conversationId }, call) => {
  const conversation = await h.conversation(conversationId, call);
  return { sections: {
    plan_mode: (await conversation?.value(planMode).get(call)) ? PLAN_GUIDANCE : undefined,
  } };
});

await c.value(planMode).set(true, call);
// next turn → 60 system { sections: [plan_mode] }     "the plan_mode guidance now applies: ..."
await c.value(planMode).set(false, call);
// next turn → 70 system { sections: [plan_mode removed] }
```

Conversation-scoped handlers run after harness-wide ones, innermost conversation last, so a child's
sections win by key.

A tool can change the loadout from inside a call. It goes through the same path: post_tools updates
the config, the next generation emits the delta.

```typescript
// inside a discovery tool
out.addTools(['calculator']);
// post_tools:  selectedTools += calculator
// next turn →  80 system { toolsAdded: [calculator] }
```

### Subagents Have Their Own

A subagent is a different agent: different instructions, different loadout, often a different
model. `spawn` sets its config, and either the parent's `subtree` handler answers (branching on
`config.profile`) or the child registers its own:

```typescript
const childId = await c.spawn({
  prompt: 'Audit the tests',
  values: {
    inherit: [generationKind.config.model],
    set: [
      [generationKind.config.selectedTools, ['read', 'grep']],
      [generationKind.config.profile, 'auditor'],
    ],
  },
}, call);

const child = await h.conversation(childId, call);
child.hooks.on(generationKind, 'system_instructions', async ({ config }, call) => ({
  sections: { identity: AUDITOR_IDENTITY, cwd: `Working directory: ${cwd}` },
  tools: h.tools.select(config.selectedTools),
}));
// child's first turn → its own baseline: two sections, two tools
```

### Compaction, Forks and Restarts

Nothing to do in any of them.

- **Compaction / handoff / reset** append a head; the context after it has no baseline, so the next
  turn writes a fresh one from the current answer to the hook. The summary never has to describe
  the prompt, and the provider's prefix was changing at the head anyway. An older delta that a
  compaction kept in its tail is subsumed by the new baseline and dropped at projection.
- **A fork** carries the `system` entries in its shared prefix and its own (rewindable) config; its
  first turn diffs the two:

  ```typescript
  const b = await c.fork(12, undefined, call);                    // config as of 12: tools [read, write, bash]
  await b.settings.set({ selectedTools: ['read'] }, call);
  await b.prompt('...', undefined, call);                         // b's turn: toolsRemoved [write, bash]; the prefix's 11 is still the baseline
  ```

- **A restart** with a changed host (new skill, different cwd) emits "these sections now apply"
  and nothing else; a host that comes back the same emits nothing.

## Prompting

### prompt, accept, drive

`prompt` is three things: accept the input, drive the conversation until it is idle, read the
explicit result for that input.

```typescript
const answer = await c.prompt('Inspect the parser', undefined, call);
// AssistantEntry | undefined (the run ended without an answer: aborted, failed)
```

The pieces are available separately. `inputId` is always the id of the accepted `pi.inbox` list
element, even when idle acceptance places and removes it in the same commit. Generation and
`post_tools` carry input ids explicitly, so result lookup never scans the transcript:

```typescript
const { inputId } = await c.accept('Inspect the parser', { requestId: 'req-42' }, call);
const outcome = await c.drive(call);                       // 'idle' | 'closed'
const result = await c.result(inputId, call);                 // one sticky-value point read
const answer = result?.status === 'done'
  ? await h.getEntry(assistantKind, result.resultEntryId, call)
  : undefined;
```

Results move from `queued` to `running`, then to `done`, `failed`, `cancelled` or `stopped`.
Context-only writes finish as `placed`. Terminal results never change.

A remote caller that lost the accept response performs an explicit request lookup:

```typescript
const existing = await h.acceptance('req-42', call);
if (existing) {
  const conversation = await h.conversation(existing.conversationId, call);
  return {
    inputId: existing.inputId,
    result: await conversation?.result(existing.inputId, call),
  };
}
return c.accept(input, { requestId: 'req-42' }, call);
```

A concurrent duplicate `accept` rejects as `RequestAlreadyAccepted` and identifies the first
receipt. Request ids are optional; there is no payload comparison or silent replay.

`c.drive()` resolves when the conversation's foreground set is idle: no generation, tool or
automatic collapse in that ownership chain is live. `h.drive()` resolves when no foreground task is
live anywhere in the session. Both start eligible background work and keep serving it after they
resolve. A separate full-quiescence wait may intentionally never return while a recurring schedule
is live.

### Input While Busy

While a turn runs, new input is queued rather than refused. The mode determines the boundary and
input-group behavior:

```typescript
const steer = await c.steer('Focus on the tokenizer first', call); // post_tools: joins current group;
                                                              // final answer: starts next group
const follow = await c.followUp('Then write the tests', call);      // after final answer; starts next group
const next = await c.nextRun('Remind me to commit', call);          // waits for the next explicit idle accept
const write = await c.write(noteKind, {                       // next safe boundary; no generation
  data: { text: 'user stepped away' },
}, call);
```

When a generation emits calls, its settlement creates every tool plus exactly one `post_tools`
carrying the current input ids. That task places writes and steering, extends the ids and creates the
continuation generation. A final-answer generation resolves its current group, then places
steer/followUp items into a new group. `nextRun` remains queued until a later idle `accept`.

The queue exposes complete entry drafts so a UI can render text/images directly. Durable and watch
updates are append/remove/clear operations, not whole-array replacements. Any item can be withdrawn
until it lands:

```typescript
await c.cancelQueued(steer.inputId, call);             // 'cancelled' | 'not_found'
```

### Aborting

```typescript
await c.abort(call);          // every live foreground task of this conversation, and of conversations they own
await h.abortTask(id, call);    // one background task: a job, a schedule
```

An abort mark is a durable request, not terminal settlement:

```text
100 generation streaming, execute invocation A running
110 abort=true commits; A can no longer write main state or scratch
    line releases; A's signal fires; provider exits; A returns
    driver removes A and starts abort invocation B with a fresh Call
120 B commits optional display-only partial, cancelled input results, terminal aborted status
    scratch is retired; B returns
```

There is no mark/signal branch in normal settlement. If the mark wins, `runtime.commit` rejects
`TaskCancelled` before its closure runs; execute unwinds and the kind's `abort()` writes the durable
cancellation result. If normal settlement wins first, the task is already terminal. Standard effects
observe the signal cooperatively; no effect gate exists, so an operation may start before the signal
is delivered and then cancel. Cancellation does not undo external effects.

`abortTask` marks exactly one task; if not owned or attached, cleanup awaits a later drive. Conversation
abort marks the current foreground ownership closure. Fresh parent cleanup explicitly cancels its
foreground children and recorded non-detached jobs. Queued `steer`/`followUp` are removed and marked
cancelled; `write`/`nextRun` remain. This is the explicit conversation-abort policy. Shutdown and
built-in task abort cleanup mark tasks only and preserve all queued items and their queued results.

A generation's abort handler updates its explicit input group in the same commit as settlement.
Here `inputResult(id)` is the sticky value address holding that input's result:

```typescript
async abort(task, runtime, call) {
  await runtime.commit(async tx => {
    for (const id of task.state.inputs) {
      const address = inputResult(id);
      const result = await tx.value(address).get();
      if (result?.status !== 'running') throw new Error(`Invalid active input ${id}`);
      tx.value(address).set({ ...result, status: 'cancelled' });
    }
    tx.settle(task.id, 'aborted', task.state);
  }, call);
}
```

The driver never resolves input results itself. Tool and generation kinds own their respective
outcomes. They can recover only committed scratch; missing final usage is unknown, not zero.
Runtime scratch writes reject after cancellation too: await/catch them. Harness sinks handle and
drain their own scratch promises and drop late callbacks, never silently recreate retired scratch.

## Watching

### The View

A UI never reads storage or parses commits. It watches a conversation and gets a **view**: a plain
JSON object the harness keeps current, plus typed events that say what changed.

```typescript
const w = await h.watch(c.id, { tail: 100, values: [myPlugin.config.mode] }, call);
w.view    // ConversationView, captured atomically with the subscription
w.start(listener);
w.resnapshot(call);     // fresh capture, same subscription (if the client fell behind)
w.unsubscribe();
```

```typescript
interface ConversationView {
  conversation: Conversation;
  entries: Entry[];                        // the last `tail` entries; page older ones with h.entries(id, { before })
  context: Id[];                           // what the model currently sees, as entry ids
  tasks: Task[];                           // live tasks, typed by kind
  inbox: Element<InboxItem>[];             // queued input
  values: Map<Address, JsonValue>;         // every value the registered kinds declare, plus the ones you asked for
  previews: Map<Id, JsonValue>;            // per live task: what it is producing right now
  faulted: boolean;
  readAt: Id;
}
```

`previews` is where streaming lives. Each task kind defines what its preview is: the generation's
is the partial `AssistantMessage`, a tool's is its `ToolOutputState` so far, a job's is the same
shape for its process output.

### Events

```typescript
type InboxOp =
  | { type: 'append'; item: Element<InboxItem> }
  | { type: 'remove'; id: Id }
  | { type: 'clear' };

type ConversationEvent =
  | { type: 'entry';       entry: Entry }
  | { type: 'task_start';  task: Task }
  | { type: 'task_update'; task: Task; previous: Task }
  | { type: 'task_end';    task: Task }
  | { type: 'task_output'; task: Id; ops: DeltaOp[] }      // already applied to view.previews
  | { type: 'value';       addr: Address; value: JsonValue | undefined }
  | { type: 'inbox';       ops: InboxOp[] }
  | { type: 'context';     ids: Id[] }                      // a head or edit changed derived context
  | { type: 'fault';       error: unknown }
  | { type: 'closed' };
```

The view is authoritative and the event is a wake-up: when the listener runs, `w.view` has already
been folded. Inbox operations are combined per commit; an idle acceptance's append and immediate
remove emits no inbox event. A renderer may ignore the event payload entirely and be correct.
Because every piece
of work is a task of a known kind, four task events cover what used to need a name per case:

| you want to know | look at |
|---|---|
| a turn started / ended | `task_start` / `task_end` where `generationKind.is(task)` |
| a retry is scheduled | `task_update`, status `retry_wait`, `state.attempt`, `state.notBefore` |
| the response is streaming | `task_output` on the generation; `view.previews.get(task)` |
| a tool is running / its output | `task_start` / `task_output` / `task_end` on the tool task |
| compaction started / ended | `task_start` / `task_end` where `collapseKind.is(task)` |
| the model changed | `value` with `addr === generationKind.config.model` |
| queued input changed | `inbox` |

Events of one commit arrive together, in order, so a finished task and its successor never show
as an idle gap.

### Rendering

A renderer is a function of the view, diffing against what it last drew. Settled entries are keyed
by id and only appended; live things are keyed by task id, and a tool block keeps its key when the
task settles and its result entry appears, so nothing is torn down and rebuilt:

```typescript
function render(view: ConversationView, event?: ConversationEvent) {
  transcript.sync(view.entries);

  const gen = view.tasks.find(t => generationKind.is(t));
  streaming.set(gen ? view.previews.get(gen.id) as AssistantMessage : undefined);
  status.set(
    gen?.status === 'retry_wait' ? `retrying (${gen.state.attempt}/${gen.state.maxAttempts})` :
    gen?.status === 'deferred'   ? 'waiting for provider' :
    view.tasks.some(collapseKind.is) ? 'compacting…' : undefined);

  for (const t of view.tasks.filter(toolKind.is))
    toolBlocks.upsert(t.id, { call: t.state.call, phase: t.status, output: view.previews.get(t.id) as ToolOutputState });

  for (const t of view.tasks.filter(jobKind.is))
    jobBlocks.upsert(t.id, { tool: t.state.origin?.tool ?? 'job', output: view.previews.get(t.id) as ToolOutputState });

  queue.set(view.inbox.map(i => i.value));
  working.set(view.tasks.some(t => !t.background));
  statusLine.set({ model: view.values.get(generationKind.config.model) });
}
```

Tool components are registered once per tool name and fed one shape, `ToolOutputState`, whether it
comes from a live tool task's preview, a settled `tool_result` entry, or a job the tool started
(`state.origin.tool` says which component).

### Remote Clients

The view is plain JSON and every event is proportional to its change, so a process without a
harness (mini's TUI, a phone) runs the same fold on the same events. `applyEvent(view, event)` is
exported and needs no kinds; preview ops are Chord delta ops, which the client applies with the
same module.

```typescript
// worker (has the harness)                            // ui process
const w = await h.watch(c.id, { tail: 100 }, call);          on('view',  m => { view = m.view; render(view); });
send({ type: 'view', view: w.view });
w.start(e => send({ type: 'event', event: e }));       on('event', m => { applyEvent(view, m.event); render(view, m.event); });
```

### Session Watch

What isn't one conversation's: the conversation list, session values, usage totals, faults, and
reports (a hook threw, a task kind misbehaved and was stopped).

```typescript
const sw = await h.watch(call);
sw.view.conversations;  sw.view.values;  sw.view.faulted;
sw.start(e => {
  if (e.type === 'usage')  status.setCost(e.totals);
  if (e.type === 'report') log.warn(e.kind, e.task, e.error);
  if (e.type === 'conversation') tree.refresh();
});
```

## Forks

A fork is a new conversation whose transcript starts as a shared prefix of the source. Nothing is
copied and nothing in the source is deleted. It carries the context as it was at that entry, the
rewindable values in force there, and the prompt-as-sent, so its first turn is exact.

```typescript
const alt = await c.fork(answer.id, undefined, call);                        // the source keeps running, untouched
await alt.prompt('Try a different implementation', undefined, call);

const back = await c.fork(earlier.id, { abort: true }, call);     // "go back": aborts the source's foreground first
```

Any transcript entry is a valid fork point, including an assistant with unanswered tool calls or one
of several results. The request projection supplies missing results for a successful incomplete
exchange without inheriting or executing the source tasks. Which conversation a UI treats as
"current" is the UI's business; the harness only has conversations.

```typescript
const all = await h.conversations(undefined, call);
const independent = all.items.filter(x => x.owner === undefined);   // root and forks: their own drive scopes
const children = await h.conversations({ parent: c.id }, call);           // forks of c; owned children use ownedFrom
```

## Compaction and Reset

Compaction appends a summary entry with its model message and first retained entry id stored on the
entry. The context becomes the summary followed by the transcript from that boundary. It runs as a
background task and may run while the model keeps working: ordinary entries landing meanwhile
remain after the prepared boundary. Only a competing head makes the summary stale; edit entries do
not.

```typescript
const collapseId = await c.collapse(undefined, call);
const collapseId = await c.collapse({ instructions: 'keep the API decisions verbatim' }, call);
```

Threshold and overflow compaction happen inside the generation; nothing to call. Reset starts the
context over, with or without a handoff message:

```typescript
await c.reset('Continue from here: we settled on a recursive-descent parser.', call);   // handoff
await c.reset(undefined, call);                                                                    // /clear
```

The transcript keeps everything either way; only the context changes.

## Subagents

A subagent is a conversation. There is no separate object to talk to: the model gets one tool with
a `command` argument, and the API gets a conversation handle.

```typescript
// the model calls:
subagent({ command: 'run',    prompt: 'Audit the tests', context: 'fresh', tools: ['read', 'grep'] })  // waits for the answer
subagent({ command: 'spawn',  prompt: 'Profile the build' })                                            // returns the child's id
subagent({ command: 'send',   id: 88, text: 'also check CI' })
subagent({ command: 'status', id: 88 })
subagent({ command: 'wait',   id: 88 })
subagent({ command: 'stop',   id: 88 })
```

```typescript
// the API
const childId = await c.spawn({ prompt: 'Profile the build', context: 'fresh',
                                values: { inherit: [generationKind.config.model] } }, call);
const child = await h.conversation(childId, call);
await child.accept('also check CI', undefined, call);
await child.drive(call);          // or let h.drive() / the parent's drive carry it
await child.abort(call);
```

`run` keeps the calling tool inflight while it drives the child, so the child is part of the
parent's foreground: aborting the parent reaches it. `spawn` settles the tool at once; the child is
detached, runs while the parent goes on, and only `child.abort()` (or the `stop` command) ends it.
Either way the child is driven by whatever drives the parent's tree, and it survives a restart like
any conversation.

## Jobs and Schedules

A job is a background task that runs a process: durable, recoverable, killable, with its output
streamed into its preview. The model normally gets one from `bash` (asked to background, or run
past its budget) and controls it through the `job` tool:

```typescript
job({ command: 'wait',   id: 91, budgetMs: 30_000 })
job({ command: 'status', id: 91 })
job({ command: 'stop',   id: 91 })
job({ command: 'list' })
```

From the API a job is a task; a schedule is a job with `every`:

```typescript
const dev = await c.commit(tx => tx.task(jobKind, { background: true,
  state: { status: 'planned', cmd: 'npm run dev', cwd } }), call);

const nightly = await c.commit(tx => tx.task(jobKind, { background: true,
  state: { status: 'planned', cmd: 'npm test', cwd, every: 24 * 3600_000, notBefore: tonightAt(2) } }), call);

await h.abortTask(nightly, call);          // ends the schedule wherever it is
```

A schedule is one task looping `planned → running → planned`; there is no trail of run ids to
chase. A job whose starting call returned early appends a `notice` entry when it finishes, so the
model learns of it on its next turn without polling. Its output stays in the task (preview while
live, terminal state after), not in the transcript.

## Plugin State

### Values and Lists

Declare an address once; read and write through handles or inside commits. The address carries the
scope (session or conversation), the rewind policy and the payload type.

```typescript
const planMode = conversationValue<boolean>('plan.mode', { rewind: true });
const moves    = conversationList<Move>('game.moves', { rewind: true });
const expanded = conversationValue<boolean>('ui.expanded', { rewind: false });
const name     = sessionValue<string>('pi.session.name');

await c.value(planMode).set(true, call);
const on = await c.value(planMode).get(call);
const then = await c.value(planMode).get(entryId, call);            // as of an entry: rewindable only

const elementId = await c.list(moves).append({ x: 1, y: 2 }, call);
const page = await c.list(moves).read({ limit: 50 }, call);
await c.list(moves).remove(elementId, call);
await c.list(moves).clear(call);

await h.value(name).set('parser work', call);
```

Rewindable state is what makes plugins survive forks: a fork before the move doesn't see the move,
a fork before plan mode was turned on doesn't have it on. Nothing to register, nothing to re-derive.

### Atomic Commits

Anything that must land together goes in one commit: a closure on the session's write line. Reads
inside it are asynchronous and see committed state; await them in an async builder. Writes are
synchronous and ids are final when returned; a throw discards everything. Awaiting storage reads does
not release the line. Never await external effects, driver waits or another commit inside a builder.

```typescript
const entry = await c.commit(tx => {
  tx.value(planMode).set(false);                                          // rewindable state first
  const id = tx.entry(myPlugin.noteKind, { data: { text: 'plan accepted' } });
  tx.value(expanded).set(true);                                           // sticky state may follow
  tx.task(myPlugin.reminderKind, { background: true,                      // tasks anywhere
    state: { status: 'scheduled', about: id, at: Date.now() + 3600_000 } });
  return id;
}, call);
```

One rule: rewindable conversation value/list writes must precede entries in the same commit. That
makes state written alongside an entry visible to a fork at that entry while excluding later
commits. Session state and sticky conversation state may appear anywhere because forks never
reconstruct their history; they may therefore reference a new entry id. Tasks may also appear
anywhere. A violating builder call throws before anything is persisted.

## Writing Tools

### The Sink

A tool's `execute` returns nothing. Everything it produces goes through a sink, so output streams
to the UI as it happens, is bounded once in one place, and settles into a `ToolOutputState` that
the transcript, the model and every renderer share. Failure is a throw; the harness sets `isError`.

```typescript
import { Type, type Tool } from '@earendil-works/pi-agent';

export const countLinesTool: Tool<{ i: string; path: string; pattern?: string }, { lines: number; matching: number }> = {
  name: 'count_lines',
  description: 'Count lines in a file, optionally only those matching a pattern',
  parameters: Type.Object({
    i: Type.String({ description: 'What you are trying to find out' }),   // intent: streams first, shows in the UI
    path: Type.String(),
    pattern: Type.Optional(Type.String()),
  }),
  output: { maxBytes: 64_000, maxLines: 200, retain: 'head' },            // the sink enforces this
  replay: 'safe',                                                         // read-only: may be rerun after a crash

  async execute(toolCallId, params, out, runtime, call) {
    const lines = getOrThrow(await runtime.env.readTextLines(params.path, {}, call));   // ExecutionEnv: FileSystem & Shell
    const re = params.pattern ? new RegExp(params.pattern) : undefined;
    let matching = 0;
    for (const [i, line] of lines.entries()) {
      if (re && !re.test(line)) continue;
      matching++;
      out.write(`${i + 1}: ${line}\n`);                                  // bounded by `output`; the sink truncates and diags
    }
    if (matching > 200) out.diag('warn', `showing 200 of ${matching} matching lines`, 'cap');
    out.details.lines = lines.length;                                     // typed, for UIs
    out.details.matching = matching;
  },
};
```

The sink:

| call | effect |
|---|---|
| `write(text)` / `replace(text)` / `image(img)` | the content the model reads |
| `details` | the tool's typed object for UIs; mutate it |
| `usage(u)` | accumulates |
| `addTools(names)` | change the loadout from the next turn on |
| `terminate(true)` | stop the turn after this exchange, whether or not the call failed |
| `handoff(message)` | ask for a context reset after the exchange (what `new_context` does) |
| `delegate(jobId)` | this call's work continues as that job |
| `diag(severity, message, code?)` | commentary about the call, kept out of the data |

A tool never touches the transcript, its siblings or the queue. What it may do is create things in
its own conversation through `runtime.commit(..., call)`: a job, a child conversation. The runtime
provides conversation lookup, reads and cancellation methods, not a raw host-lifecycle Harness.

### Diagnostics

Anything that is *about* the call rather than its output goes through `diag`: truncation, a spilled
file, a corrected path, "the file changed on disk since you read it". The harness emits the ones it
owns (the sink itself reports truncation and spill); a tool adds only what it alone knows.
Tool settlement puts the output first and the commentary after it and stores that exact message in
entry `model`. Non-message details, usage, control flags, diagnostics and truncation metadata become
entry `data`. A UI combines the two and renders diagnostics as callouts by severity:

```text
...last matching line
<harness>
[warn] stopped at 500 matches
</harness>
```

### Long-Running Tools

A call may not block a turn forever. Tools that run processes create a job first and wait on it
with the budget from config; if the budget runs out, the call settles with what it has and the work
goes on:

```typescript
async execute(toolCallId, params, out, runtime, call) {
  const job = await runtime.commit(tx => {
    const id = tx.task(jobKind, { background: true,
      state: { status: 'planned', cmd: params.cmd, cwd: params.cwd ?? runtime.env.cwd,
               origin: { tool: 'bash', task: runtime.taskId, callId: toolCallId } } });
    tx.patch(task, { jobId: id, cancelJobOnAbort: !params.background });   // partial: still 'running'
    return id;
  }, call);

  if (params.background) { out.delegate(job); out.write(`started job ${job}`); return; }

  const done = await runtime.waitForTask(job, { budgetMs: runtime.budgetMs }, call);
  const output = await runtime.jobOutput(job, call);
  out.replace(output.text); out.capture(output.truncation);
  if (done) {
    out.details.exitCode = output.exitCode;
    if (output.exitCode) out.diag('warn', `exit code ${output.exitCode}`, 'exit');
  } else {
    out.delegate(job);
    out.diag('info', `still running as job ${job}; use job wait / status / stop`, 'budget');
  }
}
```

The job owns its output from the first byte; the tool copies a snapshot. Creation stores the cleanup
reference on the tool atomically. A durable abort rejects execute mutations, including catch-handler
writes, so the fresh tool-kind abort handler reads that reference and cancels the non-detached job.
Already-terminal jobs count as successful cleanup; check-and-mark must be atomic or handle that result.

The tool kind's successful delegation settlement marks the job detached and requests a notice through
a separate sticky notification record keyed by job id. Job completion consumes it atomically; if the
job is already terminal when delegation commits, delegation places the notice itself. Apply this
protocol to exited, killed and lost outcomes, including abort and recovery. The parent never patches
a running job's state. This covers either completion/delegation order.

A UI renders the job's output with `bash`'s component. Adopting an arbitrary unfinished tool promise
after budget expiry is still an open integration design: it requires an explicit effect/sink ownership
transfer. The initial job-first path above does not race or abandon any invocation.

## Hooks

Hooks belong to the kind that runs them. A kind declares its points and their types; you register
handlers per kind and point, harness-wide or scoped to a conversation. Handlers run outside the
write line and their decisions are re-validated inside a commit, so they may take as long as they
like (a human approval is a hook that waits).

```typescript
// policy: everywhere
h.hooks.on(toolKind, 'before_tool', async ({ toolName, args, conversationId }, call) => {
  const conversation = await h.conversation(conversationId, call);
  if (toolName === 'write' && await conversation?.value(planMode).get(call))
    return { block: { reason: 'plan mode: no edits' } };
  if (toolName === 'bash' && !(await ui.approve(args, { signal: call.abortSignal })))
    return { block: { reason: 'denied by user' } };
  return { args };                                       // may rewrite arguments
});

h.hooks.on(toolKind, 'after_tool', async ({ toolCallId, output }, call) => { metrics.record(output.usage); });

h.hooks.on(generationKind, 'before_request', async ({ request }, call) => ({ request: withTracing(request) }));

h.hooks.on(generationKind, 'on_yield', async ({ answer, conversationId }, call) => {
  if (await goalIncomplete(conversationId, call)) return { continue: 'The goal is not met yet; continue.' };
});

h.hooks.on(collapseKind, 'before_collapse', async ({ reason, entries }, call) => {
  if (reason === 'manual' && entries.length < 10) return { decline: true };
});

// instructions: per conversation (see System Prompt and Tool Loadout)
c.hooks.on(generationKind, 'system_instructions', handler, { subtree: true });
```

Points and their fail behaviour:

| kind | point | returns | on throw |
|---|---|---|---|
| generation | `system_instructions` | sections + tools | reported, skipped |
| generation | `before_request` | a transformed request | reported, skipped |
| generation | `after_response` | nothing | reported |
| generation | `on_yield` | `{ continue?: string }` | reported, skipped |
| tool | `before_tool` | `{ args? }` or `{ block }` | **blocks the tool** |
| tool | `after_tool` | nothing | reported |
| collapse | `before_collapse` | `{ decline? \| instructions? \| summary? }` | reported, skipped |

These failure policies exclude cancellation control errors, which propagate to unwind the invocation.
A handler receives the active Call as its final argument and must forward it to waits/effects. The
harness awaits its actual return, not an abandoned raced promise. A handler may run again after a
crash, so its external side effects need their own idempotence.

## Writing Kinds

Kinds are how you extend the harness with new behaviour rather than new state. An entry kind is a
typed name for an immutable transcript shape; a task kind says how a kind of work runs.

### Entry Kinds

Entry facets combine. `data` is optional kind-specific JSON for logic and custom UI rendering;
`model` is an optional stored `Message[]`; `head` and `edits` are optional stored context controls.
No facet is derived while reading.

```typescript
interface NoteData { text: string; pinned?: boolean }
type NoteEntry = EntryBase & EntryData<NoteData>;

export const noteKind = defineEntryKind<NoteEntry>('myplugin.note');

await c.commit(tx => tx.entry(noteKind, {
  data: { text: 'Parser plan accepted', pinned: false },
}), call);                                                        // transcript/UI only; the model sees nothing
```

A plugin that wants both typed data and a model message keeps the append-time conversion in an
ordinary helper:

```typescript
type PinnedEntry = EntryBase & EntryData<NoteData> & ModelProjection<UserMessage>;
export const pinnedKind = defineEntryKind<PinnedEntry>('myplugin.pinned');

function appendPinned(tx: ConversationTx, data: NoteData, timestamp: number): Id {
  return tx.entry(pinnedKind, {
    data,
    model: [{ role: 'user', content: `<pinned>${data.text}</pinned>`, timestamp }],
  });
}
```

Heads and edits are supplied the same way:

```typescript
type WindowEntry = EntryBase & EntryData<{ retainFrom: Id }> & ContextHead;
export const windowKind = defineEntryKind<WindowEntry>('myplugin.window');

tx.entry(windowKind, {
  data: { retainFrom },
  head: retainFrom,                     // first retained entry, inclusive
});

type ToolResultEditEntry = EntryBase & ContextEdits;
export const toolResultEditKind = defineEntryKind<ToolResultEditEntry>('myplugin.tool_result_edit');

tx.entry(toolResultEditKind, {
  edits: replacement === undefined
    ? [{ target, action: 'omit' }]
    : [{ target, action: 'replace', messages: replacement }],
});
```

`head: 'self'` in an append draft stores the new entry id, which is how reset and handoff discard
everything earlier. Commit validation requires a stored head boundary not to move before the
previous visible boundary. Edits apply in transcript order; the newest edit per target wins. Append
another head or edit when context should change; no entry-kind callback runs during context reads.

Reads are typed by the kind, or untyped and narrowed:

```typescript
const note = await h.getEntry(noteKind, id, call);     // NoteEntry | undefined (also undefined for another kind)
const any = await h.getEntry(id, call);                // Entry | undefined
if (noteKind.is(any)) any.data.pinned;
```

A missing plugin removes that narrowing and its custom renderer, but not context behavior: the
entry's model messages, head and edits are stored independently of the kind.

### Task Kinds

A task kind declares its statuses and their roles, its config, its hooks, and three functions. Task
writes materialize the mapped role on the durable task row; storage and the driver read that field
without running kind code. Status graphs may contain cycles because one task is one logical
operation: retries, deferred polls and recurring schedules keep their stable task id. Recovery uses
only the current status, state, role and scratch.

Here is a reminder that fires once:

```typescript
type ReminderStates =
  | { status: 'scheduled'; about: Id; at: number }
  | { status: 'firing';    about: Id; at: number }
  | { status: 'done';      about: Id; at: number; fired: boolean }
  | { status: 'aborted';   about: Id; at: number };

export const reminderKind = defineTaskKind({
  kind: 'myplugin.reminder',
  initialStatus: 'scheduled',
  roles: { scheduled: 'start', firing: 'inflight', done: 'terminal', aborted: 'terminal' },
  config: { intervalMs: conversationValue<number>('myplugin.reminder.interval', { rewind: false }) },
  hooks: { before_fire: { failClosed: false } },

  async execute(task, runtime, call) {
    if (task.state.at > runtime.now()) await runtime.sleep(task.state.at, call);        // throws on cancellation
    await runtime.commit(tx => tx.patch(task, { status: 'firing', ...common(task) }), call);   // intent before any effect
    const { skip } = await runtime.hooks(reminderKind).run('before_fire', { about: task.state.about }, call);
    await runtime.commit(tx => {
      if (!skip) tx.entry(noticeKind, { model: [noticeMessage(`Reminder: see entry ${task.state.about}`)] });
      tx.settle(task, { status: 'done', ...common(task), fired: !skip });               // a marked task's commit rejects
    }, call);
  },

  async recover(task, runtime, call) { return this.execute(task, runtime, call); },      // safe to redo
  async abort(task, runtime, call)   {
    await runtime.commit(tx => tx.settle(task, { status: 'aborted', ...common(task) }), call);
  },

  // no preview: nothing to show while sleeping
});

const common = (t: Task<ReminderStates>) => ({ about: t.state.about, at: t.state.at });
```

State is a tagged union over status: one variant per status carrying exactly the fields that exist
in it, so a reader narrows instead of checking optionals, and `patch` within a variant takes a
partial (`tx.patch(task, { at: later })`) while a transition takes the whole variant. The harness
adds an `orphaned` terminal variant with the fields common to all of yours, for the case where this
plugin is not installed when the session is opened; you never write it, and a task that depends on
yours handles it in the same `switch` that handles your other terminal statuses.

The rules an execution follows, and the driver enforces:

1. Commit an inflight status before any external effect. A crash before that re-runs `execute`; a
   crash after goes through `recover`.
2. You may block on the world: a provider stream, a process, a child conversation, a sleep. The
   driver runs executions concurrently; a blocked one holds up nothing.
3. Make a committed status transition or settle before returning, except cancellation/close unwind.
   The live task's epoch counts actual transitions, so `planned → running → planned` is valid.
   Same-status/state-only patches and abort marks do not count. An abort handler must settle.
4. Prefer `after` for prerequisites; drive children or use the bounded job-wait API. Forward Call
   to every wait. Known self/dependency waits reject; never race away an unfinished task/tool/hook.

The scheduler runs on the commit line, keeps live-task/dependency indexes updated from whole committed
batches, and starts effects outside the line. It scans storage once at open, not after every call.
Only one invocation owns each task, but different tasks run concurrently. Repeated drives share an
attachment and create only temporary waiters. Historical completed children are never traversed.

An unexpected error escaping a task kind or an unchanged return faults the session: pending drives
reject immediately, admission stops, running invocations are signalled and joined, then storage closes.
Domain tool/provider errors must be settled by their kinds. Reopen starts nothing; inspect and mark
work before driving, or install a replacement kind that can settle a broken persisted task.

A kind with a `preview` decides what a UI sees while the task runs: `preview.init(scratch)` builds
it once on attach or reopen, and after that the kind mutates `runtime.preview.state` in place (the
generation applies stream events to a partial message; a tool's preview is its sink). The harness
flushes the Chord delta tracker after each scratch commit into `task_output` ops, so a token costs
one append op, not a diff of the whole object.

## Recovery

There is nothing to write. After a crash:

```typescript
const h = await Harness.open(storage, opts, call);
await h.drive(call);
```

| what was running | what happens |
|---|---|
| a generation, streaming | its frames were in scratch: the partial is published, then retry within budget or fail |
| a generation, between retries | it sleeps out the remaining backoff and tries again |
| a tool with `replay: 'safe'` | runs again |
| any other tool | an "interrupted" error result; the turn continues |
| a `run` subagent tool | finds its child and drives it again |
| a job | reruns if it said so, otherwise records `lost` |
| a scheduled job | sleeps until its time |

Successors are written in the same commit as the settlement that decides them, so a crash never
leaves "the tools finished but nobody started the next turn": post_tools already exists and is
startable.

## Storage Backends

| backend | loads | good for |
|---|---|---|
| `MemoryStorage` | everything | tests, ephemeral sessions |
| `JsonlStorage` | everything, from one append-only file plus a scratch file per live task | local sessions; the default |
| `SqliteStorage` | only what queries return | long sessions, many sessions in one file, servers |

All three answer the same queries with the same results. Entries are immutable and read whole;
indexed queries select the relevant entries before decoding. Values are stored whole on every set;
lists store append/remove/clear operations. There is no automatic value diffing or Chord storage codec.
Chord deltas are only for preview/watch delivery. Streaming scratch appends compact assistant frames
or explicit output operations, not raw provider events with repeated growing partial snapshots.

JSONL reopens by replaying complete main batches, then scratch for surviving live tasks. Per-file
sequence gaps are expected; the next id follows the maximum complete batch endpoint across both.
Retired scratch is ignored even if unlink failed; its later main settlement already covers its ids.
Only unterminated final lines are discarded and removed before further appends; malformed complete
main/live-scratch batches fail open.

```text
main ends at 100; live scratch ends at 150 → reopen lastSeq=150, next write=151
main settles task at 151; scratch unlink fails → ignore retired scratch, lastSeq=151
```

The conformance suite compares one mutation stream across all backends. A repeated whole-value set
can write quadratic bytes when the value grows; incremental lists avoid that without hidden encoding.

```typescript
const storage = await SqliteStorage.open('./sessions.db', { session: 'parser-work' });
```
