# pico

Durable agent harness for pi: one session file, any number of conversations, every piece of work
recorded as a task that survives a crash, and a view any UI can render.

**Note**: this guide is about using the harness. `pico-v3.md` is the design and the reference for
why things are the way they are.

## Table of Contents

- [The Mental Model](#the-mental-model)
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

What the model sees, the **context**, is not stored. The newest **head** supplies a replacement
(summary, handoff or nothing) and the first retained transcript entry. The harness prepends that
head, reads forward from the retained entry, applies immutable **edit** entries that omit or replace
individual projections, then projects messages. Compaction appends a head; tool-result pruning
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

## Installation

```bash
npm install @earendil-works/pi-agent
```

## Quick Start

```typescript
import { Harness, JsonlStorage } from '@earendil-works/pi-agent';
import { readTool, writeTool, bashTool } from '@earendil-works/pi-agent/tools';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

// One file per session. Reopening the same file resumes it.
const storage = await JsonlStorage.open('./session.jsonl');

// The built-in kinds (generation, tool, post_tools, collapse, job; the entry kinds) and the
// subagent and job tools are registered by open. You add models and the tools you want. Nothing runs yet.
const h = await Harness.open(storage, {
  models: builtinModels(),
  tools: [readTool, writeTool, bashTool],
});
const { generation: generationKind } = h.kinds;   // the registered kinds, for config and hooks

const c = await h.root();

// Config is declared by the kinds that read it. The generation kind declares model, thinking and
// selected tools; `settings` is shorthand for its config.
await c.settings.set({
  model: { provider: 'anthropic', modelId: 'claude-opus-5' },
  thinking: 'high',
  selectedTools: ['read', 'write', 'bash'],
});

// The system prompt is not stored as config. Each turn the harness asks this hook what the
// instructions should be right now, compares with what the transcript says the model was told,
// and writes only the difference. See "System Prompt and Tool Loadout".
c.hooks.on(generationKind, 'system_instructions', async ({ config }) => ({
  sections: {
    identity: 'You are a careful engineer working in this repository.',
    cwd: `Working directory: ${process.cwd()}`,
  },
  tools: h.tools.select(config.selectedTools),   // complete tool definitions
}), { subtree: true });

// Watch the conversation. `view` is a plain object a UI renders from; attach whenever you like,
// the view is complete as of the moment you attach and events follow from there.
const w = await h.watch(c.id, { tail: 100 });
w.start(event => {
  if (event.type === 'task_output') {
    // the generation's preview is the partial assistant message; a tool's is its output so far
    const preview = w.view.previews.get(event.task);
    process.stdout.write(renderPreview(preview));
  }
  if (event.type === 'entry') console.log(`\n[entry ${event.entry.id} ${event.entry.kind}]`);
});

// accept the input, drive the conversation until it is idle, return the answer to that input
const answer = await c.prompt('Inspect the parser and list the public API');
console.log(answer?.content);

w.unsubscribe();
await h.close();   // cancels nothing durable; reopening the file continues exactly here
```

Run it, kill it in the middle, run it again: the second run recovers whatever was in flight
(publishing a partial answer, rerunning or reporting an interrupted tool) and continues. That is the
whole point.

Snippets below assume `h` and `c` set up like this.

## Sessions and Conversations

### Opening

`Harness.open(storage, options)` takes the storage backend and everything that defines behaviour:

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
  generation: { ...generationKind, async execute(task, ctx) { await audit(task); return generationKind.execute(task, ctx); } },
}});
```

Open checks that every kind found in storage is registered (without scanning the transcript: the
set of kinds ever written is kept) and reports live work, but starts nothing:

```typescript
const { start, inflight } = await h.inspect();
// start: tasks that never began or must begin again (a planned tool, a retry, a scheduled job)
// inflight: tasks the last process was running when it stopped; recover() will handle them
```

### What Happens on Reopen

Nothing, until something drives a conversation. `h.drive()` recovers and continues everything;
`c.drive()` does it for one conversation and the conversations its tasks own. A UI usually attaches
a watch to what it shows and drives that.

```typescript
const h = await Harness.open(storage, opts);
void h.drive();          // resume everything in the background
```

### Closing

```typescript
await h.close();         // cancel in-process work, write nothing; everything resumes on the next open
await h.shutdown();      // mark all live work aborted, drain queues, wait for cleanup, then close
```

`close` is the normal exit: a crash and a close leave storage in the same state.

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
const { model, thinking } = await c.config(generationKind).get();

// some of them, one commit
await c.config(generationKind).set({ thinking: 'low' });

// `settings` is config(generationKind), because that is what every UI touches
await c.settings.set({ model: { provider: 'openai', modelId: 'gpt-5.6' } });

// one value, one point read, by its declared address
const tools = await c.value(generationKind.config.selectedTools).get();
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
- **What the model has been told.** `system` entries in the transcript: the baseline that opened the
  current context and one entry per change delivered since. Immutable facts about requests that
  happened, so they fork and compact like every other entry.

At the top of every turn the generation renders the first, folds the second out of the context,
and appends the difference, if any, before it projects the request. The host keeps rendering "the
whole prompt" the way it always did; the harness turns that into append-only deltas.

### Answering the Hook

The hook is `system_instructions` on the generation kind. It returns keyed **sections** (rendered
in the order given) and the **tool definitions** the model may call. Register it on the conversation
with `subtree: true` so subagents inherit it unless they register their own:

```typescript
c.hooks.on(generationKind, 'system_instructions', async ({ conversationId, config }) => ({
  sections: {
    identity:      IDENTITY,
    cwd:           `Working directory: ${cwd}`,
    context_files: await renderContextFiles(cwd),      // AGENTS.md and friends
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

The tool definitions are stored in full, not as names. Rendering a persisted message may depend
only on what is stored on it, so a later change to a tool's description is a change the model gets
told about, and an old transcript renders the way it was sent.

### Changing the Loadout

Every change is either a config write or something the host renders differently. Nothing is
written at that moment; the next generation notices and appends one entry:

```typescript
await c.settings.set({ selectedTools: ['read', 'write', 'bash', 'grep'] });
// next turn → 20 system { toolsAdded: [grep] }

await c.settings.set({ selectedTools: ['read'] });
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

h.hooks.on(generationKind, 'system_instructions', async ({ conversationId }) => ({
  sections: {
    plan_mode: (await h.conversation(conversationId).value(planMode).get()) ? PLAN_GUIDANCE : undefined,
  },
}));

await c.value(planMode).set(true);
// next turn → 60 system { sections: [plan_mode] }     "the plan_mode guidance now applies: ..."
await c.value(planMode).set(false);
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
});

const child = await h.conversation(childId);
child.hooks.on(generationKind, 'system_instructions', async ({ config }) => ({
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
  const b = await c.fork(12);                    // config as of 12: tools [read, write, bash]
  await b.settings.set({ selectedTools: ['read'] });
  await b.prompt('...');                         // b's turn: toolsRemoved [write, bash]; the prefix's 11 is still the baseline
  ```

- **A restart** with a changed host (new skill, different cwd) emits "these sections now apply"
  and nothing else; a host that comes back the same emits nothing.

## Prompting

### prompt, accept, drive

`prompt` is three things: accept the input, drive the conversation until it is idle, read the
answer to that input.

```typescript
const answer = await c.prompt('Inspect the parser');
// AssistantEntry | undefined (the run ended without an answer: aborted, failed)
```

The pieces are available separately, and they compose across retries. `accept` is idempotent by
`requestId`, and `answerTo` finds the answer to an input however far the conversation has moved
since, so a client that lost the reply can ask again:

```typescript
const { entryId } = await c.accept('Inspect the parser', { requestId: 'req-42' });
const outcome = await c.drive();                       // 'idle' | 'closed'
const answer = await c.answerTo(entryId);              // last assistant entry after it, before the next user entry
```

`drive` resolves when the conversation's foreground is idle: no generation, tool or automatic
collapse is live. Background work (a spawned subagent, a job) keeps running and doesn't keep
`drive` waiting. `h.drive()` waits for everything.

### Input While Busy

While a turn runs, new input is queued rather than refused. Which mode decides where it lands and
whether it asks for another turn:

```typescript
await c.steer('Focus on the tokenizer first');   // next tool boundary or final answer; requests a turn
await c.followUp('Then write the tests');        // after the final answer; requests a turn
await c.nextRun('Remind me to commit');          // only at the next idle accept
await c.write('user stepped away');              // next boundary; no turn requested
```

The queue is visible in the view (`view.inbox`) and any item can be withdrawn until it lands:

```typescript
await c.cancelQueued(itemId);                    // 'cancelled' | 'not_found'
```

### Aborting

```typescript
await c.abort();          // every live foreground task of this conversation, and of conversations they own
await h.abortTask(id);    // one background task: a job, a schedule
```

An abort is a durable mark on the task, then cleanup: a generation may retain its partial for the
UI but creates no tool tasks/results and is excluded from later requests; tool tasks that already
exist write their own error results; a subagent tool aborts its child. If the process dies between
the mark and cleanup, the next one finishes it. Queued `steer` and `followUp` are dropped by `abort`;
`write` and `nextRun` stay.

## Watching

### The View

A UI never reads storage or parses commits. It watches a conversation and gets a **view**: a plain
JSON object the harness keeps current, plus typed events that say what changed.

```typescript
const w = await h.watch(c.id, { tail: 100, values: [myPlugin.config.mode] });
w.view    // ConversationView, captured atomically with the subscription
w.start(listener);
w.resnapshot();     // fresh capture, same subscription (if the client fell behind)
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
type ConversationEvent =
  | { type: 'entry';       entry: Entry }
  | { type: 'task_start';  task: Task }
  | { type: 'task_update'; task: Task; previous: Task }
  | { type: 'task_end';    task: Task }
  | { type: 'task_output'; task: Id; ops: DeltaOp[] }      // already applied to view.previews
  | { type: 'value';       addr: Address; value: JsonValue | undefined }
  | { type: 'inbox';       items: Element<InboxItem>[] }
  | { type: 'context';     ids: Id[] }                      // a head or edit changed derived context
  | { type: 'fault';       error: unknown }
  | { type: 'closed' };
```

The view is authoritative and the event is a wake-up: when the listener runs, `w.view` has already
been folded. A renderer may ignore the event payload entirely and be correct. Because every piece
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
const w = await h.watch(c.id, { tail: 100 });          on('view',  m => { view = m.view; render(view); });
send({ type: 'view', view: w.view });
w.start(e => send({ type: 'event', event: e }));       on('event', m => { applyEvent(view, m.event); render(view, m.event); });
```

### Session Watch

What isn't one conversation's: the conversation list, session values, usage totals, faults, and
reports (a hook threw, a task kind misbehaved and was stopped).

```typescript
const sw = await h.watch();
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
const alt = await c.fork(answer.id);                        // the source keeps running, untouched
await alt.prompt('Try a different implementation');

const back = await c.fork(earlier.id, { abort: true });     // "go back": aborts the source's foreground first
```

Any content entry is a valid fork point, including an assistant with unanswered tool calls or one
of several results. The request projection supplies missing results for a successful incomplete
exchange without inheriting or executing the source tasks. Which conversation a UI treats as
"current" is the UI's business; the harness only has conversations.

```typescript
const all = await h.conversations();
const independent = all.items.filter(x => x.owner === undefined);   // root and forks: their own drive scopes
const children = await h.conversations({ parent: c.id });           // forks and owned children of c
```

## Compaction and Reset

Compaction appends a summary head whose content names the first retained entry. The context becomes
the summary followed by the transcript from that entry. It runs as a background task and may run
while the model keeps working: ordinary entries landing meanwhile remain after the prepared retained
boundary. Only a competing head makes the summary stale; edit entries do not.

```typescript
const collapseId = await c.collapse();
const collapseId = await c.collapse({ instructions: 'keep the API decisions verbatim' });
```

Threshold and overflow compaction happen inside the generation; nothing to call. Reset starts the
context over, with or without a handoff message:

```typescript
await c.reset('Continue from here: we settled on a recursive-descent parser.');   // handoff
await c.reset();                                                                    // /clear
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
                                values: { inherit: [generationKind.config.model] } });
const child = await h.conversation(childId);
await child.accept('also check CI');
await child.drive();          // or let h.drive() / the parent's drive carry it
await child.abort();
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
  state: { cmd: ['npm', 'run', 'dev'], cwd } }));

const nightly = await c.commit(tx => tx.task(jobKind, { background: true,
  state: { cmd: ['npm', 'test'], cwd, every: 24 * 3600_000, notBefore: tonightAt(2) } }));

await h.abortTask(nightly);          // ends the schedule wherever it is
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

await c.value(planMode).set(true);
const on = await c.value(planMode).get();
const then = await c.value(planMode).get(entryId);            // as of an entry: rewindable only

const elementId = await c.list(moves).append({ x: 1, y: 2 });
const page = await c.list(moves).read({ limit: 50 });
await c.list(moves).remove(elementId);
await c.list(moves).clear();

await h.value(name).set('parser work');
```

Rewindable state is what makes plugins survive forks: a fork before the move doesn't see the move,
a fork before plan mode was turned on doesn't have it on. Nothing to register, nothing to re-derive.

### Atomic Commits

Anything that must land together goes in one commit: a closure on the session's write line. Reads
inside it see committed state; ids are final when returned; a throw discards everything.

```typescript
const entry = await c.commit(tx => {
  tx.value(planMode).set(false);                                          // rewindable state first
  const id = tx.entry(myPlugin.noteKind, { text: 'plan accepted' });
  tx.value(expanded).set(true);                                           // sticky state may follow
  tx.task(myPlugin.reminderKind, { background: true,                      // tasks anywhere
    state: { about: id, at: Date.now() + 3600_000 } });
  return id;
});
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

  async execute(toolCallId, params, signal, out, ctx) {
    const lines = getOrThrow(await ctx.env.readTextLines(params.path, {}, { signal }));   // ExecutionEnv: FileSystem & Shell
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
its own conversation through `ctx.conversation.commit(...)`: a job, a child conversation.

### Diagnostics

Anything that is *about* the call rather than its output goes through `diag`: truncation, a spilled
file, a corrected path, "the file changed on disk since you read it". The harness emits the ones it
owns (the sink itself reports truncation and spill); a tool adds only what it alone knows.
Projection puts the data first and the commentary after it, delimited, so the model can treat tool
output as data, and a UI renders diagnostics as callouts by severity:

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
async execute(toolCallId, params, signal, out, ctx) {
  const job = await ctx.conversation.commit(tx => tx.task(jobKind, { background: true,
    state: { cmd: params.cmd, cwd: params.cwd ?? ctx.env.cwd,
             origin: { tool: 'bash', task: ctx.taskId, callId: toolCallId } } }));   // so UIs render it as bash

  if (params.background) { out.delegate(job); out.write(`started job ${job}`); return; }

  let done: boolean;
  try { done = await ctx.waitForTask(job, { budgetMs: ctx.budgetMs, signal }); }
  catch (e) { if (isAbortError(e)) await ctx.harness.abortTask(job); throw e; }   // user aborted: kill what we started

  const o = await ctx.jobOutput(job);                    // the job's ToolOutputState, live or settled
  out.replace(o.text); out.capture(o.truncation);
  if (done) { out.details.exitCode = o.exitCode; if (o.exitCode) out.diag('warn', `exit code ${o.exitCode}`, 'exit'); }
  else { out.delegate(job); out.diag('info', `still running as job ${job}; use job wait / status / stop`, 'budget');
         await ctx.conversation.commit(tx => tx.patch(job, { state: { notify: true } })); }
}
```

The job owns its output from the first byte; the tool only ever copies a snapshot. A UI shows the
job's output live either way, rendered with `bash`'s component.

## Hooks

Hooks belong to the kind that runs them. A kind declares its points and their types; you register
handlers per kind and point, harness-wide or scoped to a conversation. Handlers run outside the
write line and their decisions are re-validated inside a commit, so they may take as long as they
like (a human approval is a hook that waits).

```typescript
// policy: everywhere
h.hooks.on(toolKind, 'before_tool', async ({ toolName, args, conversationId }) => {
  if (toolName === 'write' && await h.conversation(conversationId).value(planMode).get())
    return { block: { reason: 'plan mode: no edits' } };
  if (toolName === 'bash' && !(await ui.approve(args)))
    return { block: { reason: 'denied by user' } };
  return { args };                                       // may rewrite arguments
});

h.hooks.on(toolKind, 'after_tool', async ({ toolCallId, output }) => { metrics.record(output.usage); });

h.hooks.on(generationKind, 'before_request', async ({ request }) => ({ request: withTracing(request) }));

h.hooks.on(generationKind, 'on_yield', async ({ answer, conversationId }) => {
  if (await goalIncomplete(conversationId)) return { continue: 'The goal is not met yet; continue.' };
});

h.hooks.on(collapseKind, 'before_collapse', async ({ reason, context }) => {
  if (reason === 'manual' && context.length < 10) return { decline: true };
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

A handler may run again after a crash (the task it belongs to is re-executed), so its external side
effects need their own idempotence.

## Writing Kinds

Kinds are how you extend the harness with new behaviour rather than new state. An entry kind says
what a kind of entry means to the model; a task kind says how a kind of work runs.

### Entry Kinds

```typescript
interface NoteContent { text: string; pinned?: boolean }

// the model never sees this kind: no `project`
export const noteKind = defineEntryKind<NoteContent>({ kind: 'myplugin.note' });

// the model sees this one
export const pinnedKind = defineEntryKind<NoteContent>({
  kind: 'myplugin.pinned',
  project: e => [{ role: 'user', content: `<pinned>${e.content.text}</pinned>`, timestamp: 0 }],
});

// a head kind: prepend this entry, then retain the transcript from retainFrom
export const windowKind = defineEntryKind<{ retainFrom: Id }>({
  kind: 'myplugin.window',
  head: entry => entry.content.retainFrom,
});

type ToolResultEdit = { target: Id; messages?: Message[] };
export const toolResultEditKind = defineEntryKind<ToolResultEdit>({
  kind: 'myplugin.tool_result_edit',
  edit: entry => entry.content.messages === undefined
    ? [{ target: entry.content.target, action: 'omit' }]
    : [{ target: entry.content.target, action: 'replace', messages: entry.content.messages }],
});
```

The presence of `head` makes writes of that kind persist `Entry.head = true`, which supports an
indexed newest-head lookup. The function itself returns the first retained entry id. Commit
validation requires that value not move before the previous visible head's returned value. The
latest head is prepended and older heads are excluded from its retained range.

`edit` interprets immutable entry content as projection operations. Edits are applied in transcript
order; the newest edit for a target wins. They omit or replace individual retained projections
without changing the target entry. There is no dynamic `compose`: append another head or edit when
context should change.

Reads are typed by the kind, or untyped and narrowed:

```typescript
const note = await h.getEntry(noteKind, id);     // Entry<NoteContent> | undefined (also undefined for another kind)
const any = await h.getEntry(id);
if (noteKind.is(any)) any.content.pinned;
```

### Task Kinds

A task kind declares its statuses and their roles, its config, its hooks, and three functions.
Here is a reminder that fires once:

```typescript
interface ReminderState { about: Id; at: number; fired?: boolean }

export const reminderKind = defineTaskKind({
  kind: 'myplugin.reminder',
  initialStatus: 'scheduled',
  roles: { scheduled: 'start', firing: 'inflight', done: 'terminal', aborted: 'terminal' },
  config: { intervalMs: conversationValue<number>('myplugin.reminder.interval', { rewind: false }) },
  hooks: { before_fire: { failClosed: false } },

  async execute(task, ctx) {
    if (task.state.at > Date.now()) await ctx.sleep(task.state.at);                // throws on abort
    await ctx.commit(tx => tx.patch(task.id, { status: 'firing' }));               // record intent before any effect
    const { skip } = await ctx.hooks(reminderKind).run('before_fire', { about: task.state.about });
    await ctx.commit(tx => {
      if (!skip && !tx.getTask(task.id)!.abort)                                    // a marked task creates no successor
        tx.entry(noticeKind, { text: `Reminder: see entry ${task.state.about}` });
      tx.settle(task.id, 'done', { ...task.state, fired: !skip });
    });
  },

  async recover(task, ctx) { return this.execute(task, ctx); },                  // safe to redo
  async abort(task, ctx)   { await ctx.commit(tx => tx.settle(task.id, 'aborted', task.state)); },

  // no preview: nothing to show while sleeping
});
```

The rules an execution follows, and the driver enforces:

1. Commit an inflight status before any external effect. A crash before that re-runs `execute`; a
   crash after goes through `recover`.
2. You may block on the world: a provider stream, a process, a child conversation, a sleep. The
   driver runs executions concurrently; a blocked one holds up nothing.
3. Change your status or settle before returning. Returning unchanged is reported as a bug.
4. Never wait on another task. Depend on it at creation (`after`), or let it be a conversation you
   drive.

A kind with a `preview` decides what a UI sees while the task runs: `preview.init(scratch)` builds
it once on attach or reopen, and after that the kind mutates `ctx.preview.state` in place (the
generation applies stream events to a partial message; a tool's preview is its sink). The harness
flushes the Chord delta tracker after each scratch commit into `task_output` ops, so a token costs
one append op, not a diff of the whole object.

## Recovery

There is nothing to write. After a crash:

```typescript
const h = await Harness.open(storage, opts);
await h.drive();
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

All three answer the same queries with the same results; the conformance suite replays one
mutation stream into each and compares. JSONL encodes large values as Chord deltas so a plugin's
structured state stays linear in the file; SQLite stores values whole so a point read is never a
replay.

```typescript
const storage = await SqliteStorage.open('./sessions.db', { session: 'parser-work' });
```
