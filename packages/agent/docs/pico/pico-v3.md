# pico v3

A design for the agent harness: how a session is stored, how work is scheduled, and how the
built-in agent behaviour is composed from that. Code in this document illustrates the model; it is
not a package export.

## 1. Goals

**Few concepts, replaceable behaviour.** A session is conversations, immutable entries, durable
tasks, and scoped state. Agent behaviour (generate, run tools, compact, delegate) is written as
task kinds. The scheduler understands task lifecycle, dependencies and cancellation, nothing
about prompts or summaries. Storage understands objects and atomic batches, nothing about tasks.
Replace a task kind and you change the behaviour; the scheduler and storage stay.

**One writer per session.** Execution is concurrent; writing is not. Every mutation, including
working-state writes, goes through one owner that runs commits one at a time. A commit reads
committed state, constructs its writes and their ids, commits them as one batch, then publishes.
Different sessions can have different owners and share a SQLite file. After a crash a new owner
resumes from durable state; it must never run alongside the old one.

**Durable work, explicit recovery.** Accepted work survives a crash, including work that hasn't
started. Opening a session starts nothing. A task records its intent before doing anything external
and commits the outcome together with whatever should happen next. A crash in the middle leaves
uncertainty, not proof that nothing happened; each task kind decides how to recover: retry,
adopt, or report interruption. Nothing promises exactly-once external effects.

**Long sessions without a residency layer.** Old entries and finished tasks are queryable but never
retained because they were once seen. Routine execution reads the current context and the live
tasks; it never scans accumulated history. What memory a backend uses is a backend choice: memory
and JSONL keep everything loaded; SQLite keeps only what queries return.

**Measure.** Same workload on each harness and backend: CPU, process memory, bytes on disk
including sidecars. Small writes, indexed reads, batched lookups. A faster prototype is a reason to
look, not proof that its shortcuts belong here.

## 2. Conversations

A session holds conversations. A conversation has three things:

- a **transcript**: an append-only list of immutable entries (messages, tool results, summaries,
  plugin-defined entries), which is what happened;
- **tasks**: the durable units of work that act on it, such as a generation or a tool call, each
  with a status that changes as it runs (§5);
- **state**: keyed values and lists that plugins and the harness read and write, such as the model
  in use or a plan-mode flag (§4).

What the model sees, the context, is derived from the transcript by a fixed rule. Tasks and state
are never model input by themselves.

### 2.1 Entries and their kinds

```ts
type Id = number;                  // a session sequence number; one alias so the representation can change

interface Entry<Content = JsonValue> {
  readonly id: Id;                 // its sequence number
  readonly conversationId: Id;
  readonly kind: string;
  readonly content: Content;
  readonly key?: string;           // optional indexed key, e.g. the tool call a result answers
  readonly head?: Id;              // set at append, indexed: entries after this id are in context
  readonly byTaskId?: Id;          // which task wrote it
}
```

Entries append. They are never patched, reordered or renumbered. Ids increase in transcript order
but need not be consecutive.

Kinds are code, not data: the built-ins are registered by `Harness.open`, plugins add theirs
next to the task kinds (§5.2) and tools (§9.5). Storage sees only the `kind` string on each entry and never runs kind code; the scan
and projection look the string up in the registry.

```ts
interface EntryKind<Content> {
  readonly kind: string;
  project?(entry: Entry<Content>): readonly Message[];      // absent: the model never sees this kind
  head?(content: Content, id: Id): Id;                       // evaluated at append
  compose?(head: Entry<Content>, tail: readonly Entry[]): readonly Entry[];   // in memory, on the range
  is(entry: Entry): entry is Entry<Content>;
}
```

`project` turns an entry into the messages the model receives. A kind without it is invisible to the
model: it is in the transcript and never in the context.

`head` lets a kind start a context. It runs once, when the entry is appended, and returns one
number, stored on the entry and indexed: the context is this entry plus the entries after that
number. That is the only thing storage knows about heads, and it is enough to find the newest one
and bound the range with an index. `summary` returns the last entry it replaces; `handoff` and `reset` return the entry's own id, so
nothing before it is included; a plugin can define its own. A new head's number must be at least
the previous head's id: heads replace, they never stack, so a context contains exactly one head
and what follows it, and a head that wants to keep something from its predecessor copies it into
its own content.

A head replaces the prefix before its number with whatever its content projects; `compose`, if the
kind has one, then reshapes the entries after it, in the harness, on the already-bounded range:
drop old tool results, shorten one, keep only the last N exchanges. Every compaction scheme is one
of those two things or both: a summary is content; a prune is `compose`; a prune after a summary
is a head that copies the summary text into its content and prunes the tail. Nothing is copied
that `compose` can drop in place, and storage knows only the number.

The built-ins are `user`, `assistant`, `tool_result`, `system`, `notice`, `summary`, `handoff` and
`reset`.
All have `project` except `reset`, which starts an empty context; `handoff` starts a context with
its own message; `system` projects to pi-ai's `SystemMessage`, each at its position in the
transcript, so the prompt in force at any entry is on record and a provider's cached prefix is
never rewritten:

```ts
interface SystemContent {
  readonly baseline?: true;              // opens an epoch (§8.2)
  readonly sections?: readonly { key: string; text: string }[];   // in render order; baseline: all; delta: the changed ones
  readonly toolsAdded?: readonly Tool[]; // complete definitions as sent, never names resolved later
  readonly toolsRemoved?: readonly Tool[];
}
```

Definitions are stored, not looked up, and sections are stored in the order they were rendered,
because rendering a persisted message must depend only on what is stored on it; a changed
description, schema or section order is therefore a delta like any other. `project` turns the
entry into pi-ai's `SystemMessage` at request time: a baseline's sections into the top-level prompt
(or one system message where there is no baseline slot), a delta's into "the `plan_mode` guidance
now applies: …" with `toolsAdded`/`toolsRemoved` attached. Plugin-defined kinds usually have no `project`. The
kind is the type witness for reads and writes, so nothing is cast and nothing is validated:
stored objects are trusted (§7.3), and a kind that changes its shape ships a migration.

```ts
tx.entry(toolResultKind, conversationId, content);                  // content: ToolResultContent
const e = await harness.getEntry(summaryKind, id);                  // Entry<SummaryContent>
const any = await harness.getEntry(id);                             // Entry<JsonValue>
if (summaryKind.is(any)) any.content.through;                       // narrowed
```

The kind is optional on reads: without it you get the untyped entry, and `kind.is(entry)` narrows
it. A typed read of an entry of another kind returns `undefined`, the same as a missing entry;
batched reads omit it.

Open checks the set of entry kinds ever written against the registry: on SQLite that is a `kinds`
table with one row per distinct kind, filled by `INSERT OR IGNORE` in the commit that first uses a
kind; on JSONL and memory it falls out of the replay open does anyway. No scan of entries; an
unknown kind rejects before anything runs.

### 2.2 Context is derived, not stored

The context is the newest head and the entries after its number, projected:

```text
head    = newest entry of the conversation with head set             (one indexed query)
range   = no head → all entries;  otherwise the head, plus entries with id > head.head
context = the head, then the entries after its number, oldest first        (one range query)
          then the head kind's compose over that tail, if it has one;
          entries whose kind has no project contribute nothing
```

No context list is stored, so nothing can drift from the transcript, and repeated compaction
subsumes by construction: an older head lies inside the newer one's range. Projection then converts
the entries to provider messages and normalizes each tool exchange so results follow their calls in
call order, whatever order they landed in.

The cost is the size of the context, never the length of the session: the newest head is one point
lookup on the head index, and the range is one bounded read. The harness caches the current context
of each open conversation and maintains it incrementally (an append pushes, a new head recomputes);
the cache is a convenience, the transcript is the truth.

### 2.3 Compaction and reset

**Compaction** appends one summary entry; its kind sets `head` to the last entry it replaces:

```text
transcript  [10 user, 20 asst, 30 user, 40 asst]         context [10, 20, 30, 40]
append      50 summary, head = 20
transcript  [10, 20, 30, 40, 50]                         context [50, 30, 40]
```

The summary is newer than 30 and 40 but projects before them. Rules: the replaced prefix must end on a complete exchange, lie inside the current context, include
the previous head if there is one (§2.1), and not separate a `system` entry from the exchange it
governs; a summary prepared against an old context may
still land later, since anything appended meanwhile
has a higher id than its head number; a competing head invalidates it, and the commit checks that
(§8.4).

**Reset** appends a `handoff` entry (with a message the model sees) or a `reset` entry (nothing),
either with `head` pointing at itself. The
transcript keeps everything. Reset by itself neither cancels tasks nor requests a response.

### 2.4 Forks share history, not future changes

A fork is a new conversation whose transcript starts as a prefix of its source, shared by
reference: entries 10 and 20 below keep their ids and their owning conversation; nothing is copied.

```text
A: 10 ─ 20 ─ 30 ─ 40 ─ 50 ─ 70
          └──────────── 90 ─ 100     B, forked at 20
B transcript: [10, 20, 90, 100]
```

Because context is derived from the transcript, B's context is what A's context was at the fork
point: the newest head among `[10, 20, ...]` is the one that existed then, and none that A added
later can be seen. Later appends, compaction and resets in A cannot affect B. Live tasks are not inherited;
continuing B is new work.

### 2.5 History and ownership are different relationships

```ts
interface Conversation {
  readonly id: Id;
  readonly parent?: { readonly conversationId: Id; readonly at: Id };   // forked from, at entry
  readonly owner?: Id;                                                       // task that created it
}
```

```text
history:    A ── fork at P ──> B         B: parent = A at P, no owner; independent
ownership:  A ── task T ── owns ──> C    C: owner = T; a child, e.g. a subagent's conversation
```

A fork never enters its source's drive or cancellation scope. An owned conversation does, through
the task that owns it. A child can start with fresh or inherited context; that is separate from
which state it is initialized with (§4.3).

## 3. Identity and commits

### 3.1 Ids are minted while building the commit

One session-wide sequence orders every mutation. A creation's sequence number is the object's id.

```ts
// last committed: 99
const entryId = await conv.commit(tx => {
  tx.value(planMode).set(true);                                             // 100
  const id = tx.entry(userKind, message);                                   // 101
  tx.task(generationKind, { state: { input: id } });                       // 102
  return id;
});
// one batch [100–102] persisted and published; entryId === 101 here
```

A commit can reference ids it just minted. It cannot hand them to an external service or return
them to a caller before the batch is durable. A rejected commit consumes nothing: the next one
starts at 100 again. Numbers are positive safe integers; no uuids, no reserved ranges.

### 3.2 State before entries

A commit can write state and an entry together (a tool that turns on plan mode and writes its
result), and a fork at that entry must include the state. It must not include state committed later: a `/model` change made after an answer belongs to a fork
made after it, not to a fork at the answer. So the boundary is exactly the entry's commit, and the
way to know it without a field, a stamp or a lookup is write order: **in one commit, state writes
come before entries.** Sequence order is call order, so the state is numbered below the
entries, and a fork at entry X is "everything ≤ X" with nothing attached:

```ts
// tool settlement, one commit
await ctx.commit(tx => {
  tx.value(planMode).set(true);                             // 300
  const result = tx.entry(toolResultKind, content);         // 301
  tx.settle(task, { result });                              // 302
});

await conv.value(model).set("claude-opus-5");               // 303, a later commit

const b = await conv.fork(301);   // has the result and plan mode; does not have the new model
```

The builder throws on a state write after an entry. It's a programming error, not a runtime
condition: state never needs the id of an entry from its own commit, and a violation shows up in
the first test. Tasks go anywhere; they are not inherited by forks and usually come after the
entries they name. Historical reads (§4) take an entry as their position; "before the first entry"
is the empty position. An assistant entry with tool calls is half an exchange (its results come
after it), so a fork there would end with unanswered calls and is refused; fork at the last result
instead.

### 3.3 Failure before and after admission

Validation failure: no writes, no ids consumed, the session keeps working. Uncertain persistence:
stop using this handle, reopen, recover the last complete batch and its `lastSeq`, continue
from that. No observer ever sees half a commit. An effect must not treat an uncertain write as
permission to redo the same external action with new ids.

### 3.4 Request keys are ordinary state

A caller's request id is a session value: `accept(input, requestId)` looks the key up inside the
commit; if present it returns the existing acceptance, otherwise it creates the input and records
the key in the same batch. A lost reply plus a retry yields the same accepted id. Reusing a key for
different input rejects.

## 4. State

State is addressed independently of the transcript. Its writes share the sequence, so one
position (an entry, §3.2) selects context and rewindable state together.

### 4.1 Scopes

| Scope | Rewind | Lifetime |
|---|---|---|
| Session | Sticky: one current value | The session |
| Conversation | Rewindable or sticky, chosen per address | The conversation and its fork history |
| Scratch | Never rewound, never inherited | One live execution, until settlement |

```ts
const sessionName = sessionValue<string>("pi.session.name");
const plan        = conversationValue<boolean>("plugin.plan", { rewind: true });
const expanded    = conversationValue<boolean>("ui.expanded", { rewind: false });
const moves       = conversationList<Move>("game.moves", { rewind: true });
```

```ts
type Scope   = { session: true } | { conversation: number } | { scratch: number /* task id */ };
interface Address { readonly scope: Scope; readonly namespace: string; readonly key?: string; readonly rewind: boolean }
interface Value<T> extends Address { readonly __value?: T }     // phantom: the payload type
interface List<T>  extends Address { readonly __list?: T }
```

An address binds namespace, key, scope and rewind policy, and carries its payload type. The
constructors above make `Value<T>`/`List<T>` for a scope; a conversation handle binds
`conversation: id` itself, so plugin code writes `conversationValue("plugin.plan")` and never the id.
Values are strict JSON; reads return copies. A conversation address cannot be used as a session address.
Storage persists scope and policy; nothing depends on the address object surviving a restart.

### 4.2 Vocabulary

```text
value:  tx.value(addr).get(), .set(v), .delete()
list:   tx.list(addr).append(v) → element id, .remove(id), .clear(), .read(cursor, limit)
```

A rewindable history reads as of an entry (§3.2): a list appended at 40 and 50, cleared at 60 and
appended at 70 reads `[A, B]` at entry 55, `[]` at 65, `[C]` at 75. A remove hides one element the
same way a clear hides all of them. Clear hides; it doesn't erase
what an earlier fork needs. Deleting a rewindable value records absence. Sticky state exposes only
its current contents.

### 4.3 Initialization is explicit; forks inherit

A new child conversation (a subagent) chooses its initial state independently of its context:

```ts
spawn({ prompt, context: "inherit",
        values: { inherit: [generationKind.config.model, generationKind.config.thinking],
                  set: [[generationKind.config.selectedTools, ["read", "grep"]]] } })
```

One commit creates the child, copies the selected current values, applies overrides, appends the
user prompt, creates the first generation; that generation writes the child's first `system`
entry from `system_instructions` (§8.2). Unselected values are absent in the child. Lists are not
copied unless a policy says so.

A historical fork inherits differently: all rewindable history as of the fork position, no sticky
state unless selected, the same session state, no scratch.

### 4.4 Capped-source lookup

A fork stores no copies. Reading a rewindable address in fork B, forked from A at an entry:

```text
read(B, addr, at):                             // at = an entry id
  local version ≤ at?  set → value; delete → absent
  no parent? absent
  read(B.parent.conversationId, addr, min(at, B.parent.at))
```

Lists combine inherited ranges with local appends the same way, honouring clears at every level.
Cost is fork depth, never unrelated history. A child initialized by copying (§4.3) has an owner but no `parent`, so lookup stops there.

### 4.5 Structured plugin state

Plugins with structured state build it on values and lists: a checkpoint value `{ through, state }`
plus a delta list; hydrate by reading the checkpoint visible at a position and the deltas after it.
The plugin owns its delta vocabulary and reducer; storage runs nothing.

### 4.6 Scratch

Scratch is a task's working state while it runs: streamed frames, a checkpoint, a memo. One scope
per task, any number of addresses in it, durable across a restart, gone when the task settles.

```ts
const frames     = scratchList<Frame>("frames");
const checkpoint = scratchValue<Checkpoint>("checkpoint");

// a new attempt starts clean; then each frame is one small scratch commit
await ctx.scratch(sc => { sc.list(frames).clear(); });
for await (const frame of stream) {
  await ctx.scratch(sc => { sc.list(frames).append(frame); });
}

// after a restart, recover reads what made it to disk
const partial = await ctx.scratch(sc => sc.list(frames).read());

// settlement: the result becomes an entry; settle retires the scope in the same commit
await ctx.commit(tx => {
  const id = tx.entry(assistantKind, assemble(partial));
  tx.settle(task, { result: id });
});
```

Three rules:

- A scratch commit writes one task's scratch and nothing else; a main commit never writes scratch.
  On JSONL that makes every commit one file (§7.4).
- `settle` deletes the task's scratch in the same commit. Crash before settle: task and scratch are
  both there for recovery. After: both gone.
- A task stops writing scratch before it settles. A frame that arrives late can't recreate what
  settle deleted.

A retry is the same task (§5.3), so an attempt clears the scratch before it starts streaming;
what is on disk is always the current attempt's. Scratch is never inherited, never rewound, never in the transcript; a task that wants to keep
something writes an entry or a value at settlement.

## 5. Tasks

A task is durable work belonging to one conversation. Its kind supplies behaviour; its record
supplies the inputs, progress and outcome that must survive a process.

### 5.1 The record

```ts
type TaskRole = "start" | "inflight" | "terminal";

interface Task<State = JsonValue> {
  readonly id: Id;
  readonly conversationId: Id;
  readonly kind: string;
  readonly status: string;              // kind-specific
  readonly state: State;                // JSON
  readonly after: readonly Id[];        // dependencies, fixed at creation
  readonly background?: true;           // fixed at creation; absent = foreground (§5.6)
  readonly owns?: readonly Id[];        // conversations this task created (§5.7)
  readonly abort?: true;                // durable cancellation mark (§6.3)
}
```

A kind maps its statuses to three roles:

```text
start      the driver may call execute        generation: pending, retry_wait, deferred
inflight   intent was committed; call recover  generation: streaming;  job: running
terminal   done; never patched again           generation: done, failed, aborted
```

Storage indexes the role so "live tasks in this scope" is one query that decodes no state. Role is
derived from status on every write; it is not editable on its own.

### 5.2 Kinds

```ts
interface TaskKind<State, Hooks extends HookPoints = {}, Config extends ConfigSpec = {}, Preview = never> {
  readonly kind: string;
  readonly initialStatus: string;
  readonly roles: Readonly<Record<string, TaskRole>>;
  readonly hooks?: HookSpecs<Hooks>;                // the points this kind runs (§8.7)
  readonly config?: Config;                         // the values this kind reads (below)
  preview?: {                                       // what UIs see while the task runs (§9.4)
    init(scratch: ScratchReader): Preview;          //   built once, on attach or reopen, from durable scratch
  };                                                //   afterwards the kind mutates ctx.preview.state in place
  execute(task: Task<State>, ctx: TaskContext): Promise<void>;
  recover(task: Task<State>, ctx: TaskContext): Promise<void>;
  abort(task: Task<State>, ctx: TaskContext): Promise<void>;
}
```

A kind that reads config declares it, so the values it depends on are on the kind and nowhere
else, typed, and usable by callers that initialize a conversation:

```ts
type ConfigSpec = Record<string, Value<any>>;

const generationKind = defineTaskKind({
  kind: "generation",
  config: {
    model:         conversationValue<ModelId>("pi.model", { rewind: true }),
    thinking:      conversationValue<ThinkingLevel>("pi.thinking", { rewind: true }),
    selectedTools: conversationValue<string[]>("pi.tools.selected", { rewind: true }),
    profile:       conversationValue<string>("pi.prompt.profile", { rewind: true }),
    budgetMs:      conversationValue<number>("pi.tool.budget", { rewind: false }),
  },
  ...
});

await c.config(generationKind).set({ model: "claude-opus-5" });     // or c.settings.set(...) for the generation
const cfg = await ctx.config(generationKind);                         // { model, thinking, ... } typed, read on the line
await c.spawn({ prompt, values: { inherit: [generationKind.config.model],
                                  set: [[generationKind.config.selectedTools, ["read", "grep"]]] } });
```

`ctx.config(kind)` reads every declared value in one batched read. A UI can list what a
conversation is configured with by walking the registered kinds' `config`. Values a plugin defines
for itself are declared on the plugin's own kind the same way.

`TaskContext` is what an execution gets from the driver:

```ts
interface TaskContext {
  readonly signal: AbortSignal;                    // fresh per call; fires on abort mark or close
  commit<T>(plan: (tx: ConversationTx) => T): Promise<T>;   // bound to the task's conversation (§9.2)
  scratch<T>(plan: (sc: ScratchTx) => T): Promise<T>;      // bound to the task's scratch (§4.6)
  readonly preview: Tracker<Preview>;              // Chord delta tracker; mutate .state, the harness flushes after each scratch commit
  sleep(untilMs: number): Promise<void>;           // throws AbortError on abort
  config<C extends ConfigSpec>(kind: TaskKind<any, any, C>): Promise<ConfigValues<C>>;   // declared values, batched
  conversation(id: Id): ConversationHandle;        // for driving a child (§8.5)
  readonly models: ModelRegistry;                  // provider streams
  readonly tools: ToolRegistry;                    // tool implementations, by name
  hooks<H extends HookPoints>(kind: TaskKind<any, H>): HookRunner<H>;   // run this kind's points (§8.7)
  readonly env: ExecutionEnv;                      // FileSystem & Shell: exec, files, temp dirs
}
```

The registry maps kind names to kinds; a replacement must understand the persisted statuses and
state of its live tasks. Open reads the live tasks anyway (`inspect()`), so an unknown live kind
rejects before anything runs; terminal tasks of a forgotten kind are only a problem when read typed.

Typed access uses the kind as the witness, on the harness and handles outside a commit and on the
`Tx` inside one:

```ts
getTask<S>(kind: TaskKind<S>, id: Id): Task<S> | undefined;
getTasks<S>(kind: TaskKind<S>, ids: readonly Id[]): ReadonlyMap<Id, Task<S>>;
```

The getter returns `Task<S>` without casts, or `undefined` when the task is missing or of another
kind; without the kind it returns the untyped task, and `kind.is(task)` narrows.

### 5.3 What an execution may do

Four rules, and they are the whole contract:

1. Commit an inflight status before any external effect. A crash before that point re-runs
   execute from the top; a crash after it goes through recover.
2. You may block on the world: a provider stream, a process, a human inside a hook, a conversation
   you created. The driver runs executions concurrently; a blocked one holds up nothing.
3. Change your status or settle before returning. An execute that returns with its task unchanged
   is a bug; the driver reports it and does not call it again.
4. Never wait on another task. If you need work done first, depend on it at creation (`after`).
   If you spawn work you need the result of, it isn't another task: it's a conversation you drive
   (§8.5), or a process you wait for.

Timing is the task's business: a retry stores `notBefore` in its state and sleeps in its own
execute (`ctx.sleep`, which throws on abort). Not everything on the signal throws: pi-ai's provider stream
completes with `stopReason: "aborted"`, and the generation settles from that in-band (§8.2). A recurring job sets its next `notBefore` and
returns in a start status. The scheduler has no timers.

### 5.4 Dependencies mean terminal, not successful

`after` lists tasks that must be terminal before this one starts. Terminal, not done: a task whose
dependency failed or was aborted still starts and decides for itself what that means. Dependencies
are set at creation, reference existing tasks in the same ownership tree, form no cycles, and are
never edited. A task that creates a successor and depends on it in the same commit is fine; a live
task adding a dependency on something it just spawned is not, and that is what rule 4 forbids.

### 5.5 post_tools joins an exchange

The generation's settlement publishes the exchange atomically:

```ts
await ctx.commit(tx => {
  const assistant = tx.entry(assistantKind, message);                 // calls [A, B]
  const tools = message.calls.map(call =>
    tx.task(toolKind, { state: { call, assistant } }));
  tx.task(postToolsKind, { after: tools, state: { assistant, tools } });
  tx.settle(task, { assistant });
});
```

Each tool executes and settles itself: hooks, execution, result entry, terminal status. It does not
look at siblings, queues or context. post_tools starts when both are terminal, reads them with the
typed getter, and decides what happens next:

```ts
async execute(task, ctx) {
  await ctx.commit(tx => {
    const tools = tx.getTasks(toolKind, task.state.tools);            // Map<id, Task<ToolState>>
    const outcomes = [...tools.values()].map(t => t.state.output);        // ToolOutputState
    if (outcomes.some(o => o.terminate) || tx.getTask(task.id)!.abort)
      return tx.settle(task, { stopped: true });                      // outcome lands, no successor
    const handoff = outcomes.find(o => o.handoff);
    if (handoff) tx.entry(handoffKind, handoff.handoff);
    const added = outcomes.flatMap(o => o.addedTools ?? []);
    if (added.length) tx.value(generationKind.config.selectedTools).set([...current, ...added]);   // next generation emits toolsAdded
    landSteering(tx, task.conversationId);                           // §8.1
    tx.task(generationKind, { state: nextGeneration(task) });
    tx.settle(task, {});
  });
}
```

Sequential tools are the same mechanism with `B after: [A]`.

```text
crash before generation settles → generation live; recover
crash after it settles          → assistant, tools and post_tools exist; nothing to repair
crash after the last tool       → post_tools exists and is startable; nothing to infer
```

### 5.6 Foreground and background

A task is foreground unless created with `background: true`; the flag is fixed at creation. Generations, tools, post_tools and automatic collapses are
foreground; jobs, schedules, spawned subagents and manual collapses are not. The
foreground set of a conversation is its live foreground tasks, plus, through any live foreground
task that owns a conversation, that conversation's foreground set. Abort and "is this conversation
busy" are defined on that set. Detached work is cancelled by its own handle.

### 5.7 Ownership

A task that creates a conversation adds it to `owns`; the conversation records `owner`. Both are
written in the creation commit. A task may own several (a fan-out tool driving three children);
a conversation has one owner. Ownership defines drive scope and cancellation reach. Fork
provenance is a different link (§2.5) and creates no ownership.

## 6. Scheduling and cancellation

### 6.1 The driver

The driver keeps one in-memory structure: `owned`, the tasks whose execute, recover or abort this
process is currently running. Everything else it needs is on disk.

```ts
class Driver {
  private owned = new Map<Id, { controller: AbortController; done: Promise<void> }>();
  private waiters: Array<{ scope: Scope; resolve: (o: "idle" | "closed") => void }> = [];
  private wake = new Wake();
  private closed = false;

  constructor(private storage: Storage, private kinds: Map<string, TaskKind>) { void this.loop(); }

  kick() { this.wake.set(); }                 // called by the harness after any commit that
                                              // created or patched a task

  // attach a scope; resolves when its foreground is idle. The loop keeps serving it afterwards.
  drive(scope: Scope): Promise<"idle" | "closed"> {
    return new Promise(resolve => { this.waiters.push({ scope, resolve }); this.wake.set(); });
  }

  close() { this.closed = true; for (const o of this.owned.values()) o.controller.abort(); this.wake.set(); }

  private scopes = new Set<Scope>();          // every scope ever attached, until close

  private async loop() {
    while (!this.closed) {
      for (const w of this.waiters) this.scopes.add(w.scope);
      const convs = new Set<number>();
      for (const scope of this.scopes) for (const c of await scope.conversations()) convs.add(c);
      const live = await this.storage.scanTasks({ conversationIds: [...convs], live: true });

      for (const task of live) {
        if (this.owned.has(task.id)) continue;
        const kind = this.kinds.get(task.kind)!;
        if (task.abort)                                  this.run(task, kind, "abort");
        else if (kind.roles[task.status] === "start") {
          if (await this.allTerminal(task.after))        this.run(task, kind, "execute");
        }
        else if (kind.roles[task.status] === "inflight") this.run(task, kind, "recover");
      }

      this.waiters = this.waiters.filter(w => !(w.scope.isIdle(live) && (w.resolve("idle"), true)));
      await this.wake.wait();
    }
    for (const w of this.waiters) w.resolve("closed");
  }

  private run(task: Task, kind: TaskKind, what: "execute" | "recover" | "abort") {
    const controller = new AbortController();
    const ctx = this.contextFor(task, controller.signal);
    const done = (async () => {
      try {
        if (what === "abort") {
          const current = this.owned.get(task.id);          // already running here?
          if (current) { current.controller.abort(); await current.done; }
          const fresh = await this.storage.getTask(task.id);
          if (fresh && this.roleOf(fresh) !== "terminal") await kind.abort(fresh, ctx);
        } else {
          await kind[what](task, ctx);
          const after = await this.storage.getTask(task.id);
          if (after && after.status === task.status && !after.abort) {
            this.report(new Error(`${task.kind}.${what} returned without changing status`));
            this.poison(task.id);
          }
        }
      } catch (e) {
        if (!isAbortError(e)) { this.report(e); this.poison(task.id); }   // report → session watch event (§9.4)
      } finally {
        this.owned.delete(task.id);
        this.wake.set();
      }
    })();
    this.owned.set(task.id, { controller, done });
  }

  private allTerminal(ids: readonly number[]) { /* batched getTasks; every role terminal */ }
  private roleOf(t: Task) { return this.kinds.get(t.kind)!.roles[t.status]; }
  private poison(id: Id) { /* remember id; skip it in later passes */ }
}
```

`Wake` is a promise that resolves when set and is replaced after each wait; nothing platform-specific:

```ts
class Wake {
  private resolve = () => {};
  private p = new Promise<void>(r => (this.resolve = r));
  set()  { this.resolve(); }
  wait() { const p = this.p; this.p = new Promise<void>(r => (this.resolve = r)); return p; }
}
```

`AbortController` and `AbortSignal` are web standards; the driver runs anywhere JS does.

A `drive()` call attaches its scope and resolves when the scope's foreground is idle; the loop
doesn't stop there. A spawned child in the scope keeps being served after its parent's `drive()`
has returned, so its chain never stalls, and a fork that nobody attached is never touched.

Calls are started, not awaited: a task enters `owned` when its call starts and leaves when it
returns, and the loop goes on to the next task. A blocked execute (a stream, a process, a child
conversation, a sleep) holds up nothing. A pass runs after any owned call returns and after any
commit that created or patched a task; between passes the driver waits. It decides nothing else;
whatever should happen next was written by a settlement.

Two guards: an `AbortError` from a task the driver cancelled is the normal unwind, any other
rejection is reported and the task is poisoned (not re-run in this process); and an execute or
recover that returns with its task's status unchanged is reported and poisoned too, so a buggy
kind can't spin.

Each call gets a fresh controller. The abort mark on disk is the intent; the controller is how the
intent reaches an execution in this process. The abort path joins the running call before running
the kind's `abort`, so effect and abort never write the same task concurrently, and re-reads the
task first because the effect may have settled in-band (a stream that ended with `aborted`). If
nobody owns a marked task, the mark alone is enough: the next process to open sees it.

### 6.2 Scope and outcome

A scope is the set of conversations a `drive()` call attaches to the loop, and the rule for when
that call resolves:

```ts
interface Scope {
  conversations(): Promise<readonly Id[]>;       // which conversations' tasks this drive runs
  isIdle(live: readonly Task[]): boolean;        // when this drive call returns "idle"
}

// conversation.drive(): the conversation and every conversation owned from it, recursively,
// whether the owning task is still live or not (a spawned child keeps running here)
const conversationScope = (root: Id): Scope => ({
  async conversations() {
    const out = [root];
    for (const c of out)
      out.push(...(await storage.scanConversations({ ownedFrom: c })).items.map(x => x.id));
    return out;
  },
  // idle when the root has no live foreground task. The foreground set (§5.6) reaches into owned
  // conversations only through live foreground tasks, so if the root has none, the set is empty;
  // a child owned by a settled spawn is driven here but never keeps us here.
  isIdle: live => !live.some(t => t.conversationId === root && !t.background),
});

// harness.drive(): every conversation, done when nothing at all is live
const sessionScope: Scope = {
  conversations: async () => (await storage.scanConversations({})).items.map(c => c.id),
  isIdle: live => live.length === 0,
};
```

`ownedFrom: c` is "conversations whose `owner` task belongs to c", one indexed query.

Forks are not reached through ownership, so nothing drives them by accident; each is its own
tree. A running background job keeps `harness.drive()` unresolved, which is what "running" means. Both
return `closed` if the harness closes first. There is no "suspended": a task waiting on the world
is an owned execution, and a host that doesn't want some work to proceed in this process doesn't
drive that scope.

### 6.3 Cancellation is a mark, then cleanup

```text
abortTask(id)     set the mark on one task; reject if terminal
abort(conv)       one commit: mark every task in the conversation's foreground set;
                  cancel queued steer/followUp input; keep write and nextRun input
```

Marks survive restart and are never shrunk as tasks settle. A settlement re-reads its task on the
line and writes its outcome regardless, but creates successors only if the mark is absent; in the
built-ins that check sits in the one helper that decides what happens next, and the harness
enforces it anyway: a commit issued by a marked task that creates a task or conversation fails,
and the kind is reported as buggy. An execution that ignores its signal delays its own cleanup (§6.1 joins it first), and a timeout
must not admit a second writer. `abort` must settle the task and write whatever records the exchange needs:
a tool's error result, a generation's partial and the error results for calls that never ran.

Either order of a race is correct: if post_tools settles first, the generation it created is marked
by the same abort commit; if the mark lands first, post_tools' abort settles it without a
successor. Background work: `abortTask(job)`, or `abort(childConversation)` for a detached child.

### 6.4 Open, close, shutdown, delete

**Open** opens storage, checks the set of entry kinds written (§2.1) and the live tasks' kinds
against the registry, exposes `inspect()` (live tasks by role) and queries,
starts nothing. **Close** stops admitting commits, cancels owned executions, waits for them and for
admitted persistence, releases storage; it writes no outcomes, so unfinished work resumes on the
next open. **Shutdown** marks all live work, drains queued input, drives cancellation to settlement,
then closes. **Delete** of a conversation rejects while its ownership subtree has live work, then
rejects new work; entries an independent fork inherits are never erased.

### 6.5 Telemetry, storage version, kill boundary

Telemetry is one span per task call (execute, recover, abort) from the driver and one per commit
from the line, tagged with task id, kind, conversation and outcome; provider streams and tool
executions nest under the task span. The host supplies the tracer; nothing is recorded in storage.

Session metadata carries a storage version, checked at open; a mismatch rejects with the versions,
and a backend exposes `migrate(from, to)` to be run before open. Durable state is provider
messages, small task states and values, so migrations are rare and mechanical.

An execution that ignores its signal delays its own abort indefinitely, because the driver joins it
before running the kind's `abort` (§6.1). First release: everything runs in-process and
cooperatively, as in the lane harness. Later, plugin code moves into an isolate with an API
membrane (mobile-handoff `02-plugins`), which becomes the kill boundary for it: dispose the
isolate, the effect rejects, the abort path settles from the host side. Nothing in this design
changes for that; the types are already JSON across the boundary and the sink and `ExecutionEnv`
are already the objects that would be proxied.

## 7. Storage

One interface: point reads, batched reads, bounded indexed scans, one atomic commit. No journal
reader, no second transaction layer, no residency API.

### 7.1 What is stored

Conversations (`parent` for forks, `owner` for owned children), entries, tasks
(with indexed role and scheduling fields), values and their rewindable versions, list elements and
clear markers, scratch scopes. Context is not stored (§2.2).

### 7.2 Queries, from the callers' side

| Caller | Reads | Never |
|---|---|---|
| Driver | live tasks in a scope; their `after` ids in one batch | terminal history |
| Context | newest head by index; the range after it | a scan of the transcript |
| post_tools | tool tasks by id | sibling scans |
| UI | a transcript page before/after an id, with a limit | the whole conversation |
| Validation | named task/conversation records, entry headers | unrelated content |
| Fork | everything ≤ the entry id | today's state filtered |
| State consumer | latest version by index; a bounded list range | a replay of unrelated records |
| Reopen (SQLite) | live tasks and the conversations they need | every historical transition |

"Latest" is an indexed descending query with limit 1, never load-and-take-last. Filters apply
before limits.

```ts
interface Page<T> { readonly items: readonly T[]; readonly next?: Id; readonly readAt: Id }

interface Cursor { readonly after?: Id; readonly before?: Id; readonly limit: number }
interface ConversationQuery extends Cursor { readonly parent?: Id; readonly ownedFrom?: Id }
interface EntryQuery        extends Cursor { readonly conversationId: Id; readonly kind?: string; readonly key?: string }
interface TaskQuery         extends Cursor { readonly conversationIds: readonly Id[]; readonly live?: boolean;
                                             readonly role?: TaskRole; readonly kind?: string; readonly abort?: boolean }
interface ListQuery         extends Cursor { readonly at?: Id }                   // at = an entry id (§3.2)
interface ValueQuery        { readonly scope: Scope; readonly namespace: string; readonly after?: string; readonly limit: number }  // keys, ordered

type EntryHeader = Omit<Entry, "content">;
interface Version<T>  { readonly seq: Id; readonly value: T }
interface Element<T>  { readonly id: Id; readonly value: T }

interface Storage {
  readonly lastSeq: Id;                                   // last committed sequence
  commit(batch: CommitBatch): Promise<{ first: number; last: number }>;

  getConversations(ids: readonly Id[]): Promise<ReadonlyMap<Id, Conversation>>;
  scanConversations(q: ConversationQuery): Promise<Page<Conversation>>;

  getEntries(ids: readonly Id[]): Promise<ReadonlyMap<Id, Entry>>;
  getEntryHeaders(ids: readonly Id[]): Promise<ReadonlyMap<Id, EntryHeader>>;
  scanEntries(q: EntryQuery): Promise<Page<EntryHeader>>;
  newestHead(conversationId: Id): Promise<EntryHeader | undefined>;               // §2.2

  getTasks(ids: readonly Id[]): Promise<ReadonlyMap<Id, Task>>;
  scanTasks(q: TaskQuery): Promise<Page<Task>>;

  getValue<T>(addr: Value<T>, at?: Id): Promise<Version<T> | undefined>;         // at = an entry id
  scanValues(q: ValueQuery): Promise<Page<{ key: string; version: Version<JsonValue> }>>;
  readList<T>(addr: List<T>, q: ListQuery): Promise<Page<Element<T>>>;

  close(): Promise<void>;
}
```

`Value<T>`, `List<T>`, `Address` and `Scope` (session / conversation / scratch) are the address types
of §4.1;
`Conversation`, `Entry`, `Task` and `TaskRole` are the records of §§2 and 5; `CommitBatch` is §7.3.

Pages carry a cursor and the sequence they were read at. Transcript reads return the inherited
prefix plus local entries; tasks are never inherited. Historical reads on sticky or scratch
addresses reject. Coherent multi-read operations run on the line; a cursor alone doesn't
freeze mutable state.

### 7.3 Batches

```ts
type StateWrite =
  | { type: "value.set"; addr: Address; value: JsonValue }
  | { type: "value.delete"; addr: Address }
  | { type: "list.append"; addr: Address; value: JsonValue }
  | { type: "list.remove"; addr: Address; element: number }
  | { type: "list.clear";  addr: Address };

type MainWrite =
  | StateWrite
  | { type: "createConversation"; conversation: Conversation }
  | { type: "deleteConversation"; id: number }
  | { type: "entry";   entry: Entry }
  | { type: "task";    task: Task }
  | { type: "patch";   id: number; status?: string; state?: JsonValue; abort?: true }
  | { type: "settle";  id: number; status: string; state: JsonValue };     // also retires scratch

type CommitBatch =
  | { readonly kind: "main";    readonly writes: readonly MainWrite[] }
  | { readonly kind: "scratch"; readonly task: number; readonly writes: readonly StateWrite[] };
```

A scratch batch can only carry state writes, by type; `ScratchTx` (§4.6) only exposes those. Write
*i* gets sequence `lastSeq + 1 + i`.

The Tx read `lastSeq` when it started and numbered its writes
from there; the line guarantees nothing landed in between, so storage numbering from its own
`lastSeq + 1` yields the same ids. Records that carry an id (`entry`, `task`, a list element) let
storage check that for free. The harness validates against
committed state plus earlier writes in the batch (kinds validate status transitions; the harness
enforces ownership, dependencies, exchange rules and admission; nobody validates payload shapes:
stored objects are trusted, and schema validation belongs at wire boundaries); storage checks scope,
sequences and structure, prepares only touched data, persists atomically, publishes. A commit with
no writes writes nothing.

### 7.4 Memory and JSONL

The memory backend holds current maps (conversations, tasks, values), ordered entries per
conversation, version histories, and lookup indexes (ids, addresses, live-task membership, parent
and owner links). Indexes reference the same immutable payloads. JSONL is the memory backend plus
one line per batch:

```json
{"first":100,"writes":[
  {"type":"value.set","conversationId":1,"namespace":"plugin.plan","value":true},
  {"type":"entry","conversationId":1,"kind":"user","content":"Inspect"},
  {"type":"task","conversationId":1,"kind":"generation","status":"pending"}]}
```

Write all bytes, then publish in-memory changes, never before. On open: validate complete batches,
rebuild maps and `lastSeq`, discard only an unterminated final line, fail on a malformed complete one. Durability
against process crash is required; fsync policy is a backend option.

**Values as deltas.** A JSONL file is one ordered stream replayed from the start, which is what
Chord's delta module (`track` / `flush` / `apply`, with a path-compressing encoder per stream) is
built for. A `value.set` is written as the full value when it is the address's first version or
small, and otherwise as the ops against the previous version; replay applies either. That keeps a
large, frequently updated value (a plugin's structured state) linear in the file instead of
rewriting it on every set. Lists don't need it: elements are immutable and `remove`/`clear` are
already one op. A line encoded as ops is only meaningful after the lines before it, which is fine
for a log and is why this stays out of SQLite.

**Scratch** goes to `session.scratch/<task id>`, one file per scope, the same delta encoding, so a
streamed assistant text or a growing tool output is an append per flush rather than a rewrite.
Retirement in the main file is authoritative; the unlink happens afterwards, and a delayed unlink
must never remove a deliberately reused scope.

### 7.5 SQLite

Tables: conversations, entries, tasks (current records including terminal), values and
value_versions, list_elements and clear_markers, scratch, commit_boundaries, kinds (one row per
distinct entry kind), session_metadata (storage version, §6.5). Keys start with the session id. Indexes follow the
query table: entries by (conversation, id), (conversation, kind, key, id) and a partial index
(conversation, id) where head is set; tasks by (role, id) and (conversation, role, id) with a
partial index on non-terminal roles; value_versions by (conversation, namespace, key, seq);
conversations by parent and by owner. One commit is one transaction: number the writes from `lastSeq + 1`,
insert rows, record the boundary, advance `lastSeq`. No full rewrite of anything per append.

Values are stored whole, current and historical: a point read must not become a replay chain, and
disk is cheaper than that. Scratch is rows in the `scratch` table keyed by (task, address), written
in the task's own small transactions, and retired by `DELETE ... WHERE task = ?` inside the
settlement transaction: atomic with the result and the terminal status, nothing to unlink. Reopen
reads live tasks and what they reference, not history.

## 8. Built-in flows

Task kinds, not scheduler special cases. Braces group one commit. Every
attempt records its usage; every settlement retires its scratch. Hooks and external calls run
outside the line, and their decisions are re-validated inside it.

### 8.1 Accepting input

A conversation is busy when its foreground set is not empty.

```text
idle accept:   { append user entry; create generation, foreground }
busy accept:   { append { message, mode } to the inbox }
```

The inbox is a conversation-scoped sticky list, `pi.inbox`. A queued item is the message itself;
nothing is written to the transcript until it lands. Three places dequeue: post_tools after a tool
exchange, the generation when it settles a final answer, and `accept` when the conversation is
idle. Each reads the list, takes the items its mode table allows, appends a `user` entry per item,
removes them, and creates the next generation, all in one commit. `cancelQueued(elementId)` is a
remove. Nothing else exists.

| Mode | Lands at | Requests a generation |
|---|---|---|
| write | post_tools or a final answer | no |
| steer | post_tools or a final answer | yes |
| followUp | a final answer | yes |
| nextRun | an idle accept only | yes |

Landing selects either everything eligible or the oldest item per mode, by configuration, in
admission order. Selection, landing, and the generation it triggers share one commit. Foreground
abort cancels queued steer and followUp; write and nextRun stay.

### 8.2 Generation

```text
create:      capture the kind's declared config (model, thinking, selected tools, profile; §5.2,
             rewindable values) and provider options and retry policy, so a retry uses what the
             attempt used
execute:     if a collapse is needed by threshold: { create collapse C; create generation G' after:[C]; settle }
             desired = system_instructions hook, per conversation: keyed sections (the host's identity,
                       cwd, skills, context files; a plugin's plan_mode) merged across handlers and
                       rendered in declared order, plus tool definitions selected from the catalogue;
                       none of the inputs is stored
             sent    = the newest baseline `system` entry in the context plus the deltas after it;
                       deltas before it (kept by a compaction) are subsumed and ignored, by the fold
                       and by projection alike
             { if no sent: system entry with the baseline (text + full tool definitions);
               else if sent ≠ desired: system entry with the diff, per section ("the plan_mode guidance
               now applies: …", "the cwd section changed: …") and toolsAdded / toolsRemoved as full
               definitions (a changed schema counts);  status streaming }
             project the context; before_request; re-check status and mark
             stream; frames to scratch
outcome:
  calls        { assistant; tools; post_tools; settle done }
  final        { assistant; resolve or continue (§8.3); settle done }
  deferred     { status deferred, handle }         → execute again: poll with sleeps until final
  retryable    { status retry_wait, attempt+1, notBefore } → execute again: sleep, then stream
  overflow     { settle failed(overflow); create collapse C; C's settlement creates G' }
  failure      { partial and error results if any; settle failed }
  aborted      the stream ends with stopReason "aborted": { partial; error results for its calls; settle aborted }
```

**Prompt and tools.** Two things the lane harness fuses are kept apart. What the client wants is
config: model, thinking level and selected tools are rewindable conversation values (a fork at an
entry gets the ones in force there; a child is initialized explicitly); the catalogue and the
prompt inputs are the host's and are asked for each turn through `system_instructions`. What the model has been told is the `system` entries in the
transcript: the baseline that opened the current epoch and one entry per change delivered since.
The generation diffs the two at the top of every turn and writes only the delta. A head (summary,
handoff, reset) starts a new epoch: the context has no baseline after it, so the next generation
writes a fresh one, and any older delta a compaction kept is subsumed by it and dropped at projection; a fork carries
the sent-state in its prefix and diffs against its own config; a restart with a changed host
emits "these sections now apply" and nothing else. Projection puts the epoch's baseline in the
provider's baseline slot, later entries as system messages at their positions, and the folded tool
set as the callable list, or folds everything into one top-level prompt on providers without
native system messages.

One task lives through retries and deferral; retries share a budget carried in state. Overflow
does not keep the generation alive: it settles and hands the retry to the collapse's settlement,
carrying the attempt count, so nothing live ever waits on the collapse.

```text
recover streaming:  frames in scratch → publish the partial and error results for its calls; settle
                    no frames → retry within budget, else fail
recover deferred:   execute again; the handle is in state
abort:              only reached if the effect didn't settle in-band (e.g. it was between attempts):
                    partial from scratch if any; error results; settle aborted
```

Usage is recorded for failed, deferred and discarded attempts too; a missing report is unknown cost,
not zero. The record is a session list, `pi.usage`, one element per attempt (conversation, task,
model, tokens, cost), appended in the settlement commit together with an update of the session
value `pi.usage.totals`, so stats are a point read and never a fold. Tools and jobs append the same
way through the sink's `usage`. Persistence and invariant failures are not provider errors: they fault the session.

### 8.3 Tools and post_tools

```text
tool execute:
  check the call was offered by its generation; validate arguments
  before_tool → allow(args) | block(reason, terminate?)     (a human approval waits inside the hook)
  block / invalid / unknown tool → own error result, no invocation
  { status running; effective args; replay policy }
  invoke the tool with the signal and the output sink (§9.3); the sink's ops go to scratch
  after_tool outside the line
  { result entry from the folded sink; usage; settle done with result id and ToolOutputState }
```

The tool never touches context, siblings or queues. A throwing `before_tool` blocks the tool. An
ordinary tool throw is an error result, not a cancellation.

```text
recover:  replay only if the stored policy allows; else an interrupted result from the checkpoint
abort:    join own execution; drain scratch; own aborted error result; settle
```

post_tools is the code in §5.5: read the tool tasks, stop on terminate, write the handoff if one
was requested, land steering, create the next generation, settle. Its abort settles it with no
successor.

**Blocking budget.** A tool call may not block a turn indefinitely. Tools that run processes or
child conversations create a job (or a conversation) first and wait on it with the budget; if the
budget runs out, the call settles now with what it has, `out.delegate(job)` and a diag, and the
work continues as the job:

```ts
const job = await ctx.conversation.commit(tx => tx.task(jobKind, { background: true,
  state: { cmd, cwd, origin: { tool: "bash", task: ctx.taskId, callId: toolCallId }, notify: false } }));
const done = await ctx.waitForTask(job, { budgetMs: ctx.budgetMs, signal });   // false when the budget ran out
const o = await ctx.jobOutput(job);                    // ToolOutputState from the job's preview or terminal state
out.replace(o.text); out.capture(o.truncation);
if (!done) { out.delegate(job); out.diag("info", `still running as job ${job}; use job wait / status / stop`, "budget");
             await ctx.conversation.commit(tx => tx.patch(job, { state: { notify: true } })); }
```

The budget is the generation's config (`budgetMs`, default a few minutes); the tool kind passes it
as `ctx.budgetMs`. `waitForTask` throws on abort like `sleep`; a tool that started a job for a
non-backgrounded call aborts it then (`abortTask`). A tool that awaits arbitrary work instead of
delegating is raced against the budget by the tool kind, which on expiry creates a job that adopts
the promise and retargets the sink into the job's scratch; that path is best-effort across a crash
(the job recovers as `lost`).

`new_context` is a tool that calls `out.handoff(message)`; the reset happens here, after the exchange
is complete, never inside the tool, because a head landing mid-exchange would cut it in half. Conflicting handoffs reject rather than pick an order.

A final answer's continuation is decided in the generation's settlement: `on_yield` may request an
explicit continuation (a user entry and a generation); eligible followUp input lands and starts the
next turn; an owned conversation's final answer settles nothing by itself, its owner is a tool
driving it (§8.5). An idle conversation whose tail is a user entry creates no work by inference.

### 8.4 Collapse

```text
create:   capture the prefix to replace (ending on a complete exchange), the newest head id,
          the context, settings; one live collapse per conversation
execute:  { status summarizing }
          before_collapse (may decline or supply the summary); call the summarizer; candidate to scratch
          { if no head newer than the captured one: append summary (head = last replaced entry); settle done
            else: settle failed(stale) }
```

Entries that landed while it ran have ids above the summary's head number, so they stay in context
without anyone doing anything; a summary may land while a generation streams, since the stream
already projected its context and the replaced prefix is old. Automatic collapses (threshold,
overflow) are foreground; manual ones are background. A collapse never creates a generation except
through the settlement chain in §8.2. Abort records usage and settles without publishing. Other
compaction schemes (windowing, pruning, replacing single entries) are other head kinds (§2.1):
content for what is replaced, `compose` for what is kept.

### 8.5 Subagents

A subagent is a conversation. There is no subagent task, and there is one tool, `subagent`, whose
argument is a command:

```ts
type SubagentCommand =
  | { command: "run";    prompt: string; context?: "fresh" | "inherit"; tools?: string[] }   // foreground
  | { command: "spawn";  prompt: string; context?: "fresh" | "inherit"; tools?: string[] }   // background
  | { command: "send";   id: Id; text: string }
  | { command: "status"; id: Id }
  | { command: "wait";   id: Id }
  | { command: "stop";   id: Id };
```

```text
run:     { create child conversation (this task owns it); initial values; prompt; first generation }
         await child.drive()                       // blocked on the world; the tool stays inflight
         child.answerTo(prompt entry); { result entry; settle }
         recover: the child exists; drive it again
         abort: the mark on this tool marks the child's foreground set through ownership; error result

spawn:   the same creation commit; settle at once with the child's id
send:    child.accept(text)          → queued if the child is busy
status:  the child's tail and live tasks
wait:    await child.drive(); child.answerTo(the last sent prompt); settle    (recover: drive again)
stop:    child.abort()
```

`id` is whatever `spawn` returned, passed back by the model; the tool resolves it with
`harness.conversation(id)`. No map anywhere, nothing to rebuild after a restart. Between `spawn` and
`wait`, whatever drives the parent's tree drives the child. A spawned child is owned by a task that
is already terminal, so it is not in the parent's foreground set and aborting the parent leaves it
alone; `stop` is the way to cancel it. Inherited context for a child is the parent's context at the
last complete exchange before the launching one.

### 8.6 Jobs and schedules

A job is a background task that runs a process. Its state:

```ts
interface JobState {
  cmd: string[]; cwd: string; limits?: ShellOutputLimits;
  origin?: { tool: string; task: Id; callId: string };   // the call that started it, so UIs render it with that tool's component
  notify?: boolean;                                       // the call returned early: append a notice on completion
  every?: number; notBefore?: number; rerun?: "safe";     // recurrence and recovery policy
  startedAt?: number; output?: ToolOutputState; exitCode?: number;
}
```

Starting one is creating the task; a tool does it in its execute (§8.3), a UI in a commit:

```ts
const jobId = await conv.commit(tx =>
  tx.task(jobKind, { background: true, state: { cmd: ["npm", "test"], cwd, every: 6 * 3600_000 } }));
```

```ts
const jobKind: TaskKind<JobState> = {
  kind: "job",
  initialStatus: "planned",
  roles: { planned: "start", running: "inflight", exited: "terminal", killed: "terminal", lost: "terminal" },

  async execute(task, ctx) {
    if (task.state.notBefore && task.state.notBefore > Date.now()) await ctx.sleep(task.state.notBefore);
    await ctx.commit(tx => tx.patch(task.id, { status: "running", state: { ...task.state, startedAt: Date.now() } }));
    const output = scratchValue<ShellOutputView>("output");
    const result = await ctx.env.exec(task.state.cmd, {                       // blocked on the world
      cwd: task.state.cwd,
      capture: { limits: { maxBytes: 64_000, maxLines: 2000, retain: "tail" }, spill: true },
      onUpdate: update => void ctx.scratch(sc => sc.value(output).set(applyShellOutputUpdate(sc.value(output).get(), update))),
    }, { signal: ctx.signal });
    await this.finish(task, ctx, result);
  },

  async recover(task, ctx) {                    // the process died with the old owner; nothing to adopt
    if (task.state.rerun === "safe") return this.execute(task, ctx);
    await ctx.commit(tx => tx.settle(task.id, "lost", task.state));
  },

  async abort(task, ctx) {                      // only reached if exec didn't return on the signal
    await ctx.commit(tx => tx.settle(task.id, "killed", task.state));
  },

  async finish(task, ctx, result) {
    const output = await ctx.scratch(sc => sc.value(scratchValue<ToolOutputState>("output")).get());
    await ctx.commit(tx => {
      if (ctx.signal.aborted) return tx.settle(task.id, "killed", { ...task.state, output });
      const r = getOrThrow(result);
      if (task.state.notify)                     // the call that started it returned early (§9.3): tell the model
        tx.entry(noticeKind, { text: `job ${task.id} (${task.state.origin?.tool}: ${task.state.cmd.join(" ")}) finished, exit ${r.exitCode}` });
      if (task.state.every)                      // recurring: same task, next time
        tx.patch(task.id, { status: "planned", state: { ...task.state, notBefore: Date.now() + task.state.every } });
      else
        tx.settle(task.id, "exited", { ...task.state, output, exitCode: r.exitCode });
    });
  },
};
```

`ctx.env` is the harness's `ExecutionEnv` (`FileSystem & Shell`); `exec` runs the command, captures
output through `onUpdate` (here into scratch, so a watcher can show it live) and returns when it
exits or the signal fires. `running` is inflight, so a restart goes through `recover`; since the
shell doesn't hand out an adoptable process, recover reruns if the job declared that safe and
otherwise settles `lost`. A recurring job is the same task looping `planned → running → planned`;
`abortTask(id)` ends it wherever it is. Output stays in scratch while it runs and in the terminal state
after, where `jobOutput`, the `job` tool and UIs read it; there is no result entry, since a call that
waited already carries the output. A job whose call returned early appends a `notice` entry (a kind
that projects to a `SystemMessage`) when it finishes, so the next generation learns of it without
polling. Interval and catch-up policy are in state,
so a restart never launches a backlog.

### 8.7 Hooks

Hooks belong to kinds. A kind declares its points and their types; plugins register handlers per
kind and point; the harness only routes:

```ts
type HookPoints = Record<string, { input: unknown; output: unknown }>;

interface GenerationHooks extends HookPoints {
  system_instructions: { input: { conversationId: number; config: GenerationConfig };   // per conversation, not per harness
                         output: { sections: Record<string, string | undefined>; tools: readonly Tool[] } };
                         // sections merge by key across handlers (a plugin adds plan_mode; undefined removes);
                         // the generation renders them in the host's declared order; tools are definitions
  before_request: { input: { request: ProviderRequest }; output: { request?: ProviderRequest } };
  after_response: { input: { response: AssistantMessage; usage: Usage }; output: void };
  on_yield:       { input: { answer: AssistantEntry }; output: { continue?: string } };
}
interface ToolHooks extends HookPoints {
  before_tool: { input: { toolCallId: string; toolName: string; args: JsonObject };
                 output: { args?: JsonObject; block?: { reason: string; terminate?: boolean } } };
  after_tool:  { input: { toolCallId: string; output: ToolOutputState }; output: void };
}
interface CollapseHooks extends HookPoints {
  before_collapse: { input: { reason: "manual" | "threshold" | "overflow"; context: readonly Entry[] };
                     output: { decline?: boolean; instructions?: string; summary?: string } };
}

const generationKind: TaskKind<GenerationState, GenerationHooks> = { ..., hooks: { before_request: {}, after_response: {}, on_yield: { failClosed: false } } };
const toolKind:       TaskKind<ToolState, ToolHooks>             = { ..., hooks: { before_tool: { failClosed: true }, after_tool: {} } };

// a plugin registers a handler
harness.hooks.on(toolKind, "before_tool", async ({ toolName, args }) => {
  if (toolName === "bash" && !(await ui.approve(args))) return { block: { reason: "denied" } };   // may wait for a human
});

// the kind runs it
const decision = await ctx.hooks(toolKind).run("before_tool", { toolCallId, toolName, args });
```

A handler can be scoped to a conversation instead of the whole harness; for `system_instructions`
that is the normal case, since a subagent is a different agent:

```ts
root.hooks.on(generationKind, "system_instructions", hostInstructions, { subtree: true });  // root and what it owns
child.hooks.on(generationKind, "system_instructions", investigatorInstructions);           // this child only; overrides for it
```

Scoped handlers run after harness-wide ones for the same point, innermost conversation last, so a
child's sections win by key. Registration is process state, not durable; a presentation registers
when it attaches.

Handlers run in registration order, each seeing the merged output so far; the kind decides what
to do with the result. A handler runs outside the line and its decision is applied inside a commit
that re-checks the task's status and mark. Handlers may run again after a crash, so their external
side effects need their own idempotence. `failClosed` says what a throw means: for `before_tool`
a throw blocks the tool; for the others a throw is reported and skipped. `before_tool` may wait as
long as it likes (a human approval is a hook that waits); the task is still `planned` meanwhile
and a crash simply asks again. A plugin kind declares its own points the same way, and a plugin
that replaces a built-in kind keeps its hook names so existing handlers keep working. Commit
listeners are not hooks: they observe, never decide, and never await a commit on the same line.

## 9. API

### 9.1 Handles

```ts
interface ConversationHandle {
  readonly id: Id;
  snapshot(): Promise<Conversation>;
  accept(input, options?: { requestId? }): Promise<{ entryId: number }>;
  prompt(input, options?): Promise<AssistantEntry | undefined>;   // accept + drive + answerTo(entryId)
  answerTo(entryId: Id): Promise<AssistantEntry | undefined>;      // last assistant entry after it and before the next user entry
  drive(options?: { signal? }): Promise<"idle" | "closed">;
  steer(input); followUp(input); nextRun(input); write(message);
  cancelQueued(elementId): Promise<"cancelled" | "not_found">;
  abort(): Promise<void>;
  collapse(options?: { instructions? }): Promise<number>;    // collapse task id
  reset(handoff?): Promise<void>;
  fork(at: Id | "start", options?: { abort?: boolean; values? }): Promise<ConversationHandle>;   // at an entry id
  spawn(options): Promise<number>;                            // child conversation id
  value(addr) / list(addr)
  config<C>(kind: TaskKind<any, any, C>): { get(): Promise<ConfigValues<C>>; set(partial: Partial<ConfigValues<C>>): Promise<void> };
  readonly hooks: { on(kind, point, handler, o?: { subtree?: boolean }): () => void };   // scoped to this conversation (§8.7)
  readonly settings: ConfigHandle<GenerationConfig>;   // sugar: config(generationKind)
  commit<T>(plan: (tx: ConversationTx) => T): Promise<T>;
}

interface Harness {
  root(): Promise<ConversationHandle>;
  conversation(id): Promise<ConversationHandle | undefined>;
  conversations(q?): Promise<Page<Conversation>>;             // independent ones: owner === undefined
  inspect(): Promise<{ start: Task[]; inflight: Task[] }>;
  drive(options?): Promise<"idle" | "closed">;
  getEntry(id); getEntry(kind, id); getEntries(ids); getEntries(kind, ids); entries(conversationId, page);
  getTask(id); getTask(kind, id); getTasks(ids); getTasks(kind, ids);
  abortTask(id): Promise<void>;
  value(addr) / list(addr)   (session scope)
  commit<T>(plan: (tx: Tx) => T): Promise<T>;
  watch(conversationId, { tail: number; values?: Address[]; raw?: boolean }): Promise<WatchHandle<ConversationView, ConversationEvent>>;   // §9.4
  watch(): Promise<WatchHandle<SessionView, SessionEvent>>;
  deleteConversation(id); shutdown(); close();
}
```

`drive`'s signal cancels the caller's wait, not the work. `fork({ abort: true })` marks the source's
foreground set in the same commit that creates the fork, for "go back to that point"; which
conversation a UI treats as current is the UI's business. `prompt` returns the answer to this input, or
`undefined` if the run ended without one. `answerTo(entryId)` is the read behind it: the last
assistant entry after the input and before the next user entry (or the tail), one bounded range
query; so a retried `accept` with the same `requestId` followed by `drive` and `answerTo` yields
the same answer however far the conversation has moved since. Nothing else maps inputs to results.

### 9.2 Commits

```ts
const entryId = await harness.commit(tx => {
  tx.value(planMode).set(true);                              // state first (§3.2)
  const id = tx.entry(noteKind, conversationId, content);    // final id, inside the closure
  tx.task(reminderKind, { background: true, state: { about: id } });
  return id;                                                 // any value; resolved after commit
});
```

```ts
interface Tx {
  // reads (committed state)
  getEntry(id) / getEntry(kind, id) / getEntries(...) / getTask(id) / getTask(kind, id) / getTasks(...)
  value<T>(addr: Value<T>): { get(at?): T | undefined; set(v: T): void; delete(): void };
  list<T>(addr: List<T>): { append(v: T): Id; remove(id: Id): void; clear(): void; read(q): Page<T> };
  // writes; state before entries (§3.2)
  entry<C>(kind: EntryKind<C>, conversationId: Id, content: C): Id;
  task<S>(kind: TaskKind<S>, spec: { state: S; after?: Id[]; background?: true; owns?: Id[] }): Id;
  patch<S>(task: Task<S> | Id, changes: { status?: string; state?: Partial<S> }): void;
  settle<S>(task: Task<S> | Id, outcome: Partial<S> & { status?: string }): void;   // terminal; retires scratch
  createConversation(spec): Id;  deleteConversation(id: Id): void;
}
```

The implementation is small enough to show. It numbers as it goes, keeps the one ordering rule, and
hands storage a batch; storage numbers from its own `lastSeq` and gets the same ids (§7.3).

```ts
class Tx {
  private writes: MainWrite[] = [];
  private seq: number;
  private sawEntry = false;
  constructor(private storage: Storage, private kinds: Kinds) { this.seq = storage.lastSeq; }

  private push(w: MainWrite): number { this.writes.push(w); return ++this.seq; }
  private state(w: StateWrite): void {
    if (this.sawEntry) throw new Error("state writes must come before entries (§3.2)");
    this.push(w);
  }

  value<T>(addr: Value<T>) {
    return {
      get: (at?: number) => this.storage.getValue(addr, at).then(v => v?.value),   // committed state
      set: (value: T) => this.state({ type: "value.set", addr, value }),
      delete: () => this.state({ type: "value.delete", addr }),
    };
  }
  list<T>(addr: List<T>) {
    return {
      append: (value: T) => { this.state({ type: "list.append", addr, value }); return this.seq; },
      remove: (element: number) => this.state({ type: "list.remove", addr, element }),
      clear: () => this.state({ type: "list.clear", addr }),
      read: (q: ListQuery) => this.storage.readList(addr, q),
    };
  }

  entry<C>(kind: EntryKind<C>, conversationId: number, content: C): number {
    this.sawEntry = true;
    const id = this.seq + 1;
    const head = kind.head?.(content, id);
    this.push({ type: "entry", entry: { id, conversationId, kind: kind.kind, content, head } });
    return id;
  }
  task<S>(kind: TaskKind<S>, spec: { conversationId: number; state: S; after?: number[]; background?: true; owns?: number[] }): number {
    const id = this.seq + 1;
    this.push({ type: "task", task: { id, kind: kind.kind, status: kind.initialStatus, ...spec } });
    return id;
  }
  patch(id: number, changes: { status?: string; state?: JsonValue; abort?: true }) { this.push({ type: "patch", id, ...changes }); }
  settle(id: number, status: string, state: JsonValue) { this.push({ type: "settle", id, status, state }); }

  getTask = this.storage.getTask; getTasks = this.storage.getTasks;   // reads: committed state
  getEntry = this.storage.getEntry; getEntries = this.storage.getEntries;

  batch(): CommitBatch { return { kind: "main", writes: this.writes }; }
}

// the line: one commit at a time
async commit<T>(plan: (tx: Tx) => T): Promise<T> {
  return this.line.run(async () => {
    const tx = new Tx(this.storage, this.kinds);
    const result = await plan(tx);                 // throws → nothing written
    const batch = tx.batch();
    if (batch.writes.length === 0) return result;
    this.validate(batch);                          // ownership, dependencies, exchange rules, marks
    await this.storage.commit(batch);
    this.publish(batch);                           // watchers
    if (batch.writes.some(w => w.type === "task" || w.type === "patch" || w.type === "settle")) this.driver.kick();
    return result;
  });
}
```

`ConversationTx` is the same with `conversationId` bound. `ScratchTx` is the `value`/`list` half
with the batch tagged `scratch`. The closure runs on the line: reads see committed state, writes are buffered and validated
in order, ids are final when returned, and a throw discards everything. The outer promise resolves
with the closure's value after persistence and publication, which is when ids may escape.
`ConversationHandle.commit` binds the conversation; `TaskContext.commit` is the same for task
code.

### 9.3 Task and tool integration

```ts
interface Tool<TParams, TDetails extends JsonValue> {
  readonly name: string; readonly description: string; readonly parameters: JsonSchema<TParams>;
  readonly output?: ShellOutputLimits;               // retained window for text output
  readonly replay?: "safe" | "never";
  execute(toolCallId: string, params: TParams, signal: AbortSignal,
          out: ToolOutput<TDetails>, ctx: ToolContext): Promise<void>;
}

// the sink; everything a tool produces goes through it (mobile-handoff/01-harness/04-tool-output)
interface ToolOutput<TDetails extends JsonValue> {
  write(text: string): void;                         // append to the text block
  image(image: ImageContent): void;                  // images are never windowed
  replace(text: string): void;                       // replace the retained text wholesale
  capture(metadata: ShellOutputMetadata): void;      // truncation totals / spill path, no text resent
  readonly details: TDetails;                        // the tool's own details object; mutate it
  usage(usage: Usage): void;                         // accumulates
  addTools(names: string[]): void;                   // replaces; post_tools updates selected tools (§5.5)
  terminate(value: boolean): void;                   // replaces; orthogonal to how execution ended
  handoff(message: string): void;                    // replaces; new_context asks for a reset (§8.3)
  delegate(job: Id): void;                           // this call's work continues as that job (§8.6); generic, so UIs can follow it
  diag(severity: "info" | "warn" | "error", message: string, code?: string): void;   // commentary, see below
}

interface ToolContext {
  readonly taskId: Id;                               // the tool task; identity for origin/for links
  readonly budgetMs: number;                         // blocking budget (§8.3)
  readonly env: ExecutionEnv;                        // FileSystem & Shell
  readonly conversation: ConversationHandle;         // the tool's own conversation (for subagents, §8.5)
  readonly harness: Harness;                         // conversation(id), abortTask, for spawned children
  waitForTask(id: Id, o: { budgetMs?: number; signal: AbortSignal }): Promise<boolean>;   // true = terminal
  jobOutput(id: Id): Promise<ToolOutputState & { exitCode?: number }>;                    // preview or terminal state
}

// what the sink folds to; recorded on the tool task and the tool_result entry at settlement
interface ToolOutputState {
  content: (TextContent | ImageContent)[];
  details: JsonValue;
  usage?: Usage;
  addedTools?: string[];
  terminate: boolean;
  handoff?: string;
  delegated?: Id;
  diags: readonly { severity: "info" | "warn" | "error"; message: string; code?: string }[];
  truncation: ShellOutputTruncation;                 // totals over everything ever written
}
```

`execute` returns nothing and reports failure by throwing; the harness sets `isError` when it
rejects, and a tool may throw anything. `terminate` is orthogonal to how execution ended, so a
failing tool can still stop the turn (`out.terminate(true); throw error`). Usage and `addTools` go
through the sink rather than a return value so that a replayed tool can seed from durable state.
The sink's text ops (`write`, `replace`, and the `slide` the env emits for a moving tail) are what
scratch and the watch stream carry, so a UI shows output live without the tool doing anything.

**Diagnostics are a channel, not text.** Commentary about a call (it was truncated, the output
spilled to a file, the path was resolved differently, the file changed on disk since it was read,
the search stopped at 500 matches) goes through `out.diag`, never into the text the model reads as
the tool's data. The harness emits the ones it owns: the sink calls `diag` itself when it truncates
or spills, the path resolver when it corrects a path, the blocking budget when a call continues as
a job. A tool adds only what it alone knows. Projection renders the data first and the diagnostics
after it, delimited:

```text
…last line of the file
<harness>
[warn] output truncated: 2,000 of 51,204 lines shown; full output at /tmp/pi/out-4421.log
</harness>
```

so the model can parse tool output as data, a plugin can post-process it without stripping notices
it doesn't know, and a UI renders diagnostics as callouts by severity. `isError` says whether the
call failed; a `warn` diag does not change it. The transcript records exactly the commentary the
model saw, because it is in the entry's `ToolOutputState`.

### 9.4 Watch

The transport is the commit stream, gap-free and replayable. The interface is typed events derived
from it by the harness, and a view the harness keeps current, so a client renders and never parses
commits:

```ts
interface WatchHandle<View, Event> {
  readonly view: View;                     // captured on the line at watch(); folded before each event is delivered
  start(listener: (event: Event) => void): void;   // delivers everything since the capture, then live
  resnapshot(): Promise<View>;             // fresh capture, same subscription (when lagging)
  unsubscribe(): void;
}

interface ConversationView {
  readonly conversation: Conversation;
  readonly entries: readonly Entry[];      // the last `tail` entries; older ones via entries(id, { before })
  readonly context: readonly Id[];         // the derived context, as ids
  readonly tasks: readonly Task[];         // live tasks, typed by kind (retry attempt, deferred handle, ToolOutputState ... in state)
  readonly inbox: readonly Element<InboxItem>[];
  readonly values: ReadonlyMap<Address, JsonValue>;   // every value the registered kinds declare in config, plus any asked for
  readonly previews: ReadonlyMap<Id, JsonValue>;      // per live task: the kind's tracked preview (§5.2)
  readonly faulted: boolean;
  readonly readAt: Id;
}

type ConversationEvent =
  | { type: "entry";        entry: Entry }
  | { type: "task_start";   task: Task }
  | { type: "task_update";  task: Task; previous: Task }
  | { type: "task_end";     task: Task }
  | { type: "task_output";  task: Id; ops: readonly DeltaOp[] }           // ops on the task's preview; applied to view.previews
  | { type: "value";        addr: Address; value: JsonValue | undefined }
  | { type: "inbox";        items: readonly Element<InboxItem>[] }
  | { type: "context";      ids: readonly Id[] }                  // a head landed
  | { type: "fault";        error: unknown } | { type: "closed" };

const w = await h.watch(c.id, { tail: 100, values: [myPlugin.config.mode] });
render(w.view);
w.start(event => render(w.view, event));    // w.view is already folded when the listener runs
```

The view is authoritative and the events are wake-ups: a renderer is `apply(view)`, diffing against
what it last drew (entries keyed by id, tool components keyed by task id), and it may ignore an
event's payload and still be correct. The payload is for skipping work on a hot path (`task_output`:
redraw one component from its preview) and for logs and tests.

Because every piece of work is a task of a known kind, the four task events carry what the lane
harness needed a name per case for, and cover plugin kinds without anyone adding one:

| lane event | v3 |
|---|---|
| run_start / run_end | task_start / task_end where `generationKind.is(task)` |
| retry_scheduled, run_suspend | task_update with status `retry_wait` (attempt, notBefore) / `deferred` (handle) in state |
| message_update | task_output on the generation; `view.previews` holds the partial assistant message |
| tool_start / tool_update / tool_end | task_start / task_output / task_end on the tool task; `ToolOutputState` in state |
| compaction_start / compaction_end | task_start / task_end where `collapseKind.is(task)`; reason and summary id in state |
| navigation_start / end | a conversation created (session watch); with `abort`, task_end aborted on the source |
| config_update, value_update | value |
| queue_update | inbox |
| entry_added, message_end | entry |

Events are delivered per commit, in commit order, all events of one commit before any of the
next, so a terminal task and its successor never show as an idle gap. `watch` captures the view
and registers the subscription in one serialized step on the line, so nothing falls between them.
Task output travels as delta ops only (§7.4); the folded preview lives in the view, never in the event. `resnapshot` marks a
barrier on the delivery tail while the line holds the new capture, so calling it from inside the
listener neither deadlocks nor refolds stale state. Buffering is bounded; a lagging client gets a
`fault` and calls `resnapshot`. A listener never awaits a commit on the same line.

Events are proportional to their change, and the view fold is a generic reducer,
`applyEvent(view, event)`, exported by the harness package and needing no kinds: append the entry,
upsert the task, apply the ops to `previews[task]`, set the value. The harness maintains `w.view`
with it, and a UI in another process runs the same reducer on the same events; nothing is
re-diffed for the wire:

```ts
// worker                                                    // ui process
const w = await h.watch(c.id, { tail: 100 });                on("view",  m => { view = m.view; ui.apply(view); });
send({ type: "view", view: w.view });
w.start(e => send({ type: "event", event: e }));             on("event", m => { applyEvent(view, m.event); ui.apply(view, m.event); });
```

The replication contract, so a reducer in another language can't drift: events of one commit
travel as one message; an `Address` serializes to one canonical string key; and preview ops are
Chord delta ops (`packages/chord/src/delta`, mobile-handoff `01-delta`): `r` replace, `s` set, `d`
delete, `a` append, `t` truncate, `p` splice, with the wire codec's interning optional for thin
clients. That applier is already the mobile port; the reducer adds its ten cases on top and the
harness package's implementation is the reference, tested by porting `delta.test.ts` first.

`task_output.ops` are ops on the task's *preview*, which is a Chord delta tracker the kind mutates
in place (`ctx.preview.state`): the generation applies each stream event to a tracked partial
message, the tool's preview is the sink's tracked state, a job's is the same. The harness flushes
the tracker after each scratch commit; a streamed token is one `["a", path, delta]`, computed from
dirty paths and a memcmp, never a recomputed object (a reassigned preview would flush as a full
replace). On attach or reopen the harness builds the preview once with `preview.init(scratch)`
and the first flush is the base. Fan-out to several in-process watchers uses `applyImmutable` or
copies the batch, since `apply` adopts `r` payloads.

The lane-shaped
snapshot (`operation`, `runningTools`, `retry`, `deferred`, `streamingMessage`) is a pure function
of `view.tasks` and `view.previews`; a renderer that wants it computes it. `h.watch(c.id, { raw:
true })` delivers the commits themselves, for a receiver that has a harness and runs the fold.

There is a session-level watch for what isn't one conversation's:

```ts
interface SessionView {
  readonly conversations: readonly Conversation[];
  readonly values: ReadonlyMap<Address, JsonValue>;     // session-scoped: pi.usage.totals, pi.session.name, ...
  readonly faulted: boolean;
  readonly readAt: Id;
}
type SessionEvent =
  | { type: "conversation"; conversation: Conversation; change: "created" | "deleted" }
  | { type: "value";  addr: Address; value: JsonValue | undefined }
  | { type: "usage";  row: UsageRow; totals: Usage }
  | { type: "report"; task?: Id; kind?: string; error: unknown }       // hook errors, poisoned tasks
  | { type: "fault";  error: unknown } | { type: "closed" };
harness.watch(): Promise<WatchHandle<SessionView, SessionEvent>>;
```

### 9.5 End to end

```ts
const h = await Harness.open(storage, options);
const c = await h.root();
const w = await h.watch(c.id, { tail: 100 });  render(w.view);  w.start(e => render(w.view, e));

const answer = await c.prompt("Inspect the parser");

const driving = c.drive();  await c.abort();  await driving;      // durable intent, then cleanup

const child = await c.spawn({ prompt: "Inspect only tests", context: "fresh",
                              values: { inherit: [model] } });
await h.drive();                                                  // drives the child too
console.log(await h.conversation(child));

const alt = await c.fork({ atEntry: answer.id });
await alt.prompt("Try a different implementation");               // source stays parked

w.unsubscribe(); await h.close();
```

```ts
const h = await Harness.open(storage, {
  models,
  tools: [readTool, writeTool, bashTool, ...pluginTools],     // subagent and job tools are built in
  kinds: { entry: pluginEntryKinds, task: pluginTaskKinds },  // added to the built-ins
  replace: { generation: myGenerationKind },                  // swap a built-in by name; same statuses, hook names
  rootValues,
});
h.kinds.generation;  h.kinds.tool;  h.kinds.postTools;  h.kinds.collapse;  h.kinds.job;   // whatever is registered under the name
```

The built-in entry kinds (`user`, `assistant`, `tool_result`, `system`, `notice`, `summary`,
`handoff`, `reset`) and task kinds (`generation`, `tool`, `post_tools`, `collapse`, `job`) are
registered by `open` itself, because `accept`, `prompt`, `steer` and `collapse` cannot work without
them. A replacement is registered under the built-in's name and must understand its persisted
statuses and keep its hook names, so existing handlers keep working; a wrapper that delegates to
the original is the usual shape. `h.kinds.<name>` is how handles and plugins refer to whatever is
currently registered, so `c.settings` is the config of the generation kind in use, not of a
specific import.

`Harness.open` takes storage, models, tools, additional kinds, replacements and initial root values; it creates
the root only for empty storage and never creates work on reopen.

## 10. Validation

### 10.1 Backend conformance

One validated mutation stream replayed into memory, JSONL (close, reopen) and SQLite (close,
reopen), compared on: current objects and live-task metadata, transcript pages and inherited
prefixes, derived contexts at several boundaries, value tombstones and list clears, request keys,
scratch lifetimes, next allocated sequence. Randomized small histories plus explicit deep-fork
cases: fork before and after a delete, before and after a clear, before a later summary, nested
source cutoffs, sticky state untouched by historical reads.

### 10.2 Failure and concurrency

| Scenario | Required |
|---|---|
| Persistence paused after construction | readers see the old complete state |
| Commit durable, reply lost | reopen sees the batch; keyed retry returns the same id |
| Main and scratch writes in one batch | reject, nothing written |
| Torn final JSONL line | only that line discarded |
| Malformed complete line | open fails; no silent truncation |
| Retirement committed, unlink fails | old scratch invisible |
| Effect returns as abort starts | one owner; join then abort |
| Parallel tools settle in either order | post_tools starts once |
| Abort vs post_tools settlement | no unmarked successor |
| Child finishes while its owning tool is marked | tool settles aborted, not done |
| Two overlapping drives | one execution per task |
| A drive caller cancels its wait | other callers and tasks unaffected |
| Summary lands after a reset | rejected as stale |
| Cancel vs land of the same inbox item | one wins on the line; the loser reports it |
| Overflow retry while collapse runs | no live task waits on the collapse |
| Watch registration races a commit | base includes it or the stream delivers it |

Faux providers, fake processes and clocks, storage barriers; both orders of every race; failed
commits consume no ids; old task ids remain queryable after compaction.

### 10.3 Performance

Workloads: many short turns with and without tools; frequent compaction plus cold reopen; parallel
and sequential tools; large streaming output; deep forks with repeated historical reads; many
finished child conversations with few live tasks; many live background tasks; queued input and
cancellation. Measure CPU, wall latency, RSS and heap, bytes on disk including scratch and WAL,
query counts and rows decoded. Report backend-owned memory separately from live execution data;
JSONL growth with history is expected, SQLite must not keep a full-history copy.

The pico2 prototype's 9.7 s against 35.9 s on 2,000 faux turns is a reason to measure this design
the same way, not a result for it. Its lessons are the ones above: cheap live queries, batched
reads, small writes, no history scans on the hot path.
