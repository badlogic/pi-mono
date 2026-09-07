# pico v2

A harness for running agents. This document is the design: read it and build it.

Assumed knowledge: pi-ai (`Models`, `streamSimple`, tool definitions, thinking levels, deferred
handles, `AssistantMessage`/`UserMessage`/`ToolResultMessage`). Everything else is defined here.
Code is TypeScript; a snippet is a shape unless it says otherwise. Normative words: MUST, MUST NOT,
SHOULD, MAY.

History: `pico.md` (v1) modelled a session as one resident tree of nodes; `pico-v2-tree-draft.md`
tried to page that tree; `pico-v2-folds-draft.md` replaced the tree with a transcript and used
"folds" to bound the model's context. This version keeps v1's driver, kinds, scratch, line, hooks,
vars and watch, and replaces both the tree and the folds with three separately-lived things and an
explicit context list.

---

## 0. In one page

A **session** is one **journal** (an append-only log of small records) and a set of
**conversations**. A conversation is three things:

1. a **transcript**: an append-only list of immutable **entries** (a user message, an assistant
   message, a tool result, a summary): what happened;
2. **tasks**: small mutable records with a status and code (a generation in progress, a tool
   executing, a background job, a subagent, an approval waiting): what the driver runs;
3. **keyed values**: named settings and plugin state written as immutable entries at transcript
   positions: what forks and rewinds read as of a position.

The model does not read the transcript. It reads the conversation's **context**: a short list of
entry ids, edited by three ops (`append`, `replace`, `reset`), that always has the shape
"one head entry (a summary or a handoff), then selected entries in transcript order".

A **kind** defines what an entry, a task or a value is and, for tasks, the code that runs,
recovers and aborts it. A **read model** (tables for SQLite; rebuilt in memory for JSONL) answers
"what is live", "what is this task now", "the newest value of key K before position P" and pages
the transcript, without replaying the journal. Memory holds each live conversation's context
entries and its live tasks; everything else is read on demand. A **subagent** is a task that
owns a conversation; the only nesting is `conversation ⊃ task ⊃ conversation`. Clients **watch** a
conversation and receive a transcript page, the context list, live tasks, and then journal records
as they commit.

---

## 1. Definitions

- **seq**: the position of a record in the journal; a positive integer assigned at append. Every
  entry, task and conversation is identified by the seq of the journal record that created
  it. There are no other ids. A caller-supplied idempotency id is a keyed attribute.
- **conversation**: an identity (its creation seq) with a mutable **conversation state** (§4.1), a
  transcript, work, keyed values, and a context list. The **root** is the conversation with no parent.
- **entry**: an immutable transcript element (§2). Written once; never patched; never reordered.
- **task**: a mutable element with a lifecycle (§3): a generation, a tool execution, a job, a subagent, a collapse, an approval. Patched by `set`.
- **keyed value**: an entry with a `key`; read as of a position (§5).
- **transcript order**: the order of a conversation's entries by id (seq). There is no other order.
- **context**: the ordered list of entry ids the model reads (§6). Lives in the conversation state.
- **live**: a task whose status role is not `terminal` (§3.2). A conversation is live if it has live
  tasks, a live owner task, or an attached watcher/handle.
- **the line**: the session's single command queue (§7).
- **scratch**: durable working storage per live task, off-journal (§3.5).
- **projection**: the messages the model receives, built from the context list (§6.4).
- **canEditContext** (§8.1): no generation in flight and no unresolved foreground calls; the precondition for context edits, forks, and `next()`.

---

## 2. Transcript

### 2.1 Entry

```ts
interface Entry {
  id: number;                 // seq of its journal record; also its transcript order
  conv: number;               // owning conversation
  kind: string;               // "user" | "assistant" | "tool_result" | "summary" | "value" | plugin content kinds
  by?: number;                // the task that wrote it, if any
  callIndex?: number;         // tool results: index of the call within the assistant message they answer
  through?: number;           // summaries: the last entry the summary replaced (§6.2)
  key?: string;               // keyed values (§5)
  meta: JsonObject;           // small resident fields: timestamp, preview, sizes
}
// the payload (the message, the summary text, the value) is in the journal record at `id`
```

Entries are immutable and the transcript is append-only: no journal record targets an existing
entry and nothing is inserted before an existing one. An entry is reconstructed by one addressed
read of its journal record.

### 2.2 Content kinds

```ts
defineContent({ kind, meta: M, payload: P, keyed?: true, context: "select" | "none" },
              { project(entry, ctx): Promise<AgentMessage[] | undefined> })
```
- `context`: whether inserting an entry of this kind also appends its id to the conversation's
  context list (§6.1). Core: `user`, `assistant`, `tool_result` → `select`; `summary`, `value`,
  `custom` → `none` (a summary enters the context only through the `ctx_replace` issued by the
  command that creates it; a reset's bootstrap enters through `ctx_reset`). There is no per-entry override.
- `project`: what a selected entry contributes to the model's messages. May read the payload
  (`ctx.payload(id)`) and nothing else. A selected entry MAY project nothing.

---

## 3. Tasks

### 3.1 Task

```ts
interface Task {
  id: number;                 // seq of its ins_task
  conv: number;               // owning conversation
  kind: string;               // "generation" | "tool" | "job" | "subagent" | "collapse" | "approval" | plugin work kinds
  at: number;                 // transcript position (entry id) it started from
  for?: number;               // the task that spawned it (a tool → its generation)
  status: string;
  state: JsonObject;          // small resident fields: attempt, model, call args, pid, produced, calls, …
  owns?: number;              // subagent: the conversation it owns
}
```

### 3.2 Statuses and roles

| role | meaning | driver action when the task is not owned |
|---|---|---|
| `start` | not begun, or must begin again | run `effect` |
| `inflight` | someone was acting; unowned means interrupted | run `recover` |
| `waiting` | waiting on the outside world (a human, a process, a child conversation, time) | nothing (one `recover` per process, so a kind can re-arm) |
| `terminal` | finished | nothing |

`transitions` lists the allowed next statuses per non-terminal status. A `start` status MAY carry
`state.notBefore`; the driver arms a timer.

### 3.3 Task kinds

```ts
defineTask({ kind, state: S, statuses: St, roles, transitions, initial,
             concurrency: "parallel" | "exclusive", ownsConversation?: true },
           { effect, recover, abort, next? })
```
- `effect(task, ctx)`: MUST write an inflight status before any external action; MUST settle with
  one command carrying everything that belongs together (produced entries, spawned tasks, context
  appends). A task's result is an entry (a result message, a summary, a job's tail as a `value`). Only the external call is caught; storage/invariant failures propagate.
- `recover(task, ctx)`: the task is inflight and unowned. Idempotent; decides from scratch and the
  kind's replay rule.
- `abort(task, ctx)`: MUST reach a terminal status and release external resources. An aborted
  generation with calls MUST write error `tool_result` entries for them (§6.3), so an exchange is
  always complete.
- `next?(conv, ctx)`: for kinds with `ownsConversation` (§8.2).
- `concurrency` per kind per conversation. Core: generation, collapse exclusive; tool parallel
  (`toolExecution: "sequential"` makes it exclusive); job, subagent, approval parallel.

Core statuses (role in parentheses):
`generation`: pending(start) streaming(inflight) retry_wait(start) deferred(start) polling(inflight) done aborted failed;
`tool`: planned(start) truncated(start) running(inflight) waiting(waiting) done aborted;
`collapse`: pending(start) summarizing(inflight) retry_wait(start) done failed;
`job`: planned(start) spawning(inflight) running(waiting) exited killed lost;
`subagent`: planned(start) running(waiting) done aborted failed;
`approval`: pending(start) waiting(waiting) granted denied cancelled.

### 3.4 Context handed to kinds

```ts
interface Ctx<S, St> {
  signal: AbortSignal;
  conv: ConversationView;                                     // §4.2, all reads async
  set(id, patch: Partial<S> & { status?: St }): Promise<void>;
  settle(id, patch: Partial<S> & { status: St }): Promise<void>;
  commit(plan: (view) => Op[] | undefined): Promise<boolean>;   // several ops, one command
  ops: { entry(kind, meta, payload?, opts?: { by?, callIndex?, through?, key? }): Op;
         task(kind, state, opts?: { for?, at? }): Op; value(key, value): Op;
         set(id, patch): Op; settle(id, patch): Op;
         ctxAppend(ids: Ref[]): Op; ctxReplace(through: number, withRef: Ref, expectPrefixVersion: number): Op; ctxReset(ids: Ref[]): Op;
         ref(opIndex: number): Ref };                          // refer to an entry created earlier in the same command
  scratch(id): Scratch; payload(id): Promise<JsonObject | undefined>;
  sleep(ms): Promise<void>; emit(delta): Promise<void>;
  hooks; vars; models; tools; resources; retry; collapse;
}
```
Writes happen only through `ctx`, and every write is a command on the line (§7). Ids are seqs; a
plan refers to records it creates in the same command by op index.

### 3.5 Scratch

Per live task: an append-only log plus a small key/value map, on disk beside the journal
(JSONL: one file per task; SQLite: a table), never in the journal, never replayed. The kind
declares `reduce(entries) → value` (a partial assistant message from frames; a tool's output so
far; a job's tail). Read by `recover`, `abort` and watch. Retired by settlement; orphans retired on
open. Appends are announced to watchers as ephemeral deltas (§9).

---

## 4. Journal, conversation state, read model

### 4.1 Journal records

```
ins_conv     { parent?: {conv, at, asOf}, config, context: number[] }        // at: parent entry id; asOf: parent seq
set_conv     { id, patch }                                                     // inbox, abort, config, label
del_conv     { id }
ins_entry    { conv, kind, by?, callIndex?, through?, key?, meta, payload? }
ins_task     { conv, kind, at, for?, state }
set          { id, patch }                                                     // tasks only
settle       { id, patch (status terminal) }                                   // tasks only; a task's result is an entry
ctx_append   { conv, ids }
ctx_replace  { conv, through, with, expectPrefixVersion }
ctx_reset    { conv, ids }
```
JSONL: one line per **commit** (every record of one command; atomic; a torn tail is truncated on
open). SQLite: one row per journal record, one transaction per commit. Payloads live only in the
journal, addressed by seq. Nothing is rewritten.

**Conversation state** (derived; in memory; in a table for SQLite):
```ts
interface ConversationState {
  id: number;
  parent?: { conv: number; at: number; asOf: number };
  config: { model, thinkingLevel, seedTools };      // sticky vars (§5)
  inbox: InboxItem[];                                // steer | followUp | nextRun, each with its message entry id
  abort?: true;
  label?: string;
  context: number[];                                 // §6
  prefixVersion: number;                             // bumped by ctx_replace / ctx_reset only
  steeringMode?, followUpMode?;
}
```

### 4.2 Read model

Maintained by the append's transaction (SQLite) or rebuilt by one header-only scan of the journal
on open (JSONL; cost proportional to the file, accepted). Tables and the queries they serve:

```
entries(id, conv, kind, key, by, through, meta)            index (conv, id); (conv, kind, key, id)
tasks(id, conv, kind, at, for, status, role, state, owns, last_seq)  index (role) where role <> 'terminal'; (conv, kind); (owns)
conversations(id, parent_conv, parent_at, parent_asof, state)        index (parent_conv)

ConversationView (async, bounded):
  live()                                        → tasks where role <> 'terminal' (session-wide)
  entry(id) / payload(id) / task(id) / conversation(id)
  entries(conv, { before?: id, after?: id, limit })      → a transcript page in transcript order
  lastEntry(conv) / lastEntryWhere(conv, pred, { limit })
  findValue(conv, key, { before: id, asOf?: seq })       → newest keyed value before a position (and seq)
  find(conv, kind, key?, { limit })
  tasks(conv, { kind?, live?: true })
  conversations({ parent?: conv })
```
The read model is the **backend's**: SQLite keeps these tables on disk; memory and JSONL keep them
in memory and rebuild them by the open scan. The harness asks it questions (`ReadIndex`) and never
depends on how it is kept. The journal is the authority; if they disagree the read model is rebuilt.

### 4.3 Backends

- **SQLite**: journal + read-model tables in one file, one transaction per commit (WAL,
  `synchronous = NORMAL`). Open = three queries. For long-lived sessions.
- **JSONL**: the journal (one line per commit) plus scratch sidecars and the usage ledger, nothing
  else on disk; no index files. In memory it is the memory backend: records and read model, rebuilt
  by one scan on open (torn last line truncated). For portable, inspectable, medium sessions; its
  memory grows with the journal, by decision.
- **Memory**: tests.
Conformance: read model equals replay at every commit; pages/find/findValue equal a scan; scratch
survival and retirement; torn-tail tolerance.

### 4.4 Memory

```ts
conversations: Map<id, ConversationState>      // live conversations only
tasks:         Map<id, Task>                   // live tasks, plus each conversation's newest generation (§8.1 reads it)
entries:       Map<id, Entry & { payload }>    // every id on a live conversation's context list
history:       LRU<id, payload>                // pages a UI asked for; bounded
```
This is **residency** and it is the same on every backend; it is not the read model (§4.2) and
does not depend on how the backend indexes. After each commit the harness keeps exactly the entries
some context list names and the tasks that are live or a newest generation, and drops the rest; a
commit that puts an old entry on a list (a fork) loads it first.
Objects are values (a write yields a new object). All reads are async; a hit is a microtask, a
miss goes to the read model or the journal. Residency is proportional to (live conversations ×
context size) + live tasks, independent of the journal's length on every backend; the process's
total memory additionally includes the backend's read model where the backend keeps it in memory
(memory, JSONL) and nothing else with SQLite.

---

## 5. Keyed values (vars) and plugin state

`declareVar(name, { rewind: boolean, inherit: boolean })`.
- `rewind: true`: written as a `value` entry (`key = name`, one bounded immutable value per write);
  read by `findValue(conv, name, { before })`: one index read. A fork reads as of its `{at, asOf}`.
  Examples: `plan.mode`; `activeTools` (written by the tool kind when a result adds tools).
- `rewind: false`: a field of `config`; latest wins; forks copy it. Examples: `model`,
  `thinkingLevel`; `seedTools` seeds `activeTools`.
- `inherit`: default for seeding a child; the creating kind MAY override.

Plugin state has two shapes and no third: keyed value entries (the default: a board is
`board.state` written whole on each change, found by `find(conv, kind, key)` without any lifecycle)
or a task for an actual lifecycle. A sequence (a list) is repeated entries under one key;
reading it as of a position is `find(conv, kind, key, { before, limit })`. Replicated plugin state
(§9.1) is a view over such entries. Scratch is for un-journaled live preview only.

---

## 6. Context

### 6.1 The list and its three ops

`context: number[]` on the conversation state. Edited only by:
- `ctx_append { ids }`: emitted by the insert of a `select` kind, in the same command, in
  transcript order. Never called directly.
- `ctx_replace { through, with, expectPrefixVersion }`: remove the prefix up to and including
  entry `through`, put entry `with` (a summary) at the head. Rejected if `prefixVersion` moved.
- `ctx_reset { ids }`: replace the whole list with a bootstrap: `[]` (a user's `/clear`: waits for
  input), a `user` entry written by the model's `new_context` tool (the handoff: the tail is a user
  message, so generation continues), or a `summary`-kind note (text without a trigger).

Both `replace` and `reset` bump `prefixVersion`; `append` does not. Consequently the list always has
the shape **[head?, then selected entries in transcript order]**, and a summarization that started
earlier survives appends (they land after `through`) but is rejected by a competing replace or
reset. Validation (§7.2) checks, on every `ctx_*` op, that every id exists in this conversation or
in the inherited prefix, that the resulting list has that shape, and that `through` does not split
an exchange: no `tool_result` after `through` may answer an assistant entry at or before it.
The context as of an earlier commit is reconstructed by replaying `ctx_*` records (§6.6).

### 6.2 Summaries and handoffs

A `summary` entry is appended by the `collapse` task and carries `through`. A handoff is a `user`
entry appended by the model's `new_context` tool and made the sole context by `ctx_reset`. Both
are ordinary transcript entries at their append position; their place *in the context* is the
head. UIs draw a summary immediately after its `through` (so retained turns follow it) and a
handoff at its own position (§9.2).

### 6.3 Boundaries

Context edits (`replace`, `reset`), forks and requests happen only when the conversation is
quiescent (§8.1), so a request never contains an assistant message whose tool results are still
pending. Settlements complete exchanges: an aborted or failed generation writes error results for
any calls it produced; a deferred generation has produced nothing yet. Timing alone does not make a
cut valid: `through` may not split an exchange (§6.1 validation), so a replacement never leaves a
tool result whose call was summarized away. A reset drops whole exchanges by construction.

### 6.4 Projection

```
messages := for each id in conv.context: entries[id].kind.project(entry)      (tool results ordered by callIndex within their message)
         then before_request hooks edit the request
```
Nothing else. Projections never write.

### 6.5 Collapse policy

`next()` starts a `collapse` task when the last generation's usage exceeds `threshold × contextWindow`
and more than `keepRecent` turns are on the list; also on provider overflow (the generation parks
in `retry_wait`; the collapse runs first; the generation retries once); also manually. The decision
(`before_collapse` hooks) is taken before the task is inserted; declined publishes nothing. The
task captures `through` (the cut, on a user boundary before the kept tail) and `prefixVersion`,
summarizes the projection of the prefix (which contains the previous summary, so summaries subsume),
and settles with `ins_entry summary {through} + ctx_replace`. Repeated compaction never accumulates
summaries.

### 6.6 Context as of a commit

The context as of a committed boundary `asOf` is reconstructed from the conversation's `ctx_*`
records: find the newest `ctx_replace` or `ctx_reset` with `seq ≤ asOf`; the list is its head
(`with` / `ids`) followed by every `ctx_append` id greater than `through` (for a replace) with
`seq ≤ asOf`, minus nothing (later replaces are by definition after `asOf`). Replay is therefore
bounded by compaction cadence, not by the session, and needs no checkpoint. The read model indexes
`ctx_*` by `(conv, seq)`; only `fork` (§8.4) and replicated-state hydration (§9.1) use this.
`asOf` MUST be the seq of a commit's last record; a seq inside a multi-record commit is rejected, so
a state that was never externally visible cannot be selected.

---

## 7. The line

One command queue per session. A command is `plan(view) → ops | undefined`: the plan reads (async
allowed), returns ops; the line loads the rows the ops target, validates (§7.2), appends the ops as
one commit, updates the read model, updates memory (§4.4), delivers to listeners, resolves the
caller. Nothing else writes.

### 7.1 Guarantees
1. No two commands interleave; a plan sees the previous command's state.
2. A caller resolves after delivery; a listener sees the state its records describe; a listener
   MUST NOT await a command on the same session inside its callback; a throwing listener is
   reported as `handler_error` and does not affect the commit.
3. A settlement retires its record's scratch.

### 7.2 Validation (rejects the whole commit)
- `ins_entry`: the conversation exists; `through` (if any) is an entry of it.
- `ctx_replace` / `ctx_reset`: the resulting list (§6.1) has the head+ordered-suffix shape; `through`
  does not split an exchange; `expectPrefixVersion` matches.
- `ins_task`: the conversation exists; `at` is one of its entries; `for` is a task of it;
  the status is `initial` or a `start` status.
- `set`/`settle`: target exists; keys are the kind's; a status change is an allowed transition;
  `settle` reaches a terminal status; a terminal task accepts no patch.
- `ctx_*`: every id exists in this conversation or its inherited prefix.
- `del_conv`: every live task in the conversation (transitively through owned conversations) was
  aborted in the same command.

### 7.3 Faults
A failure after a plan's decision faults the session: later commands reject; the process should
exit and reopen. Rejections (§19) are not faults.

---

## 8. Driver and conversations

### 8.1 Loop

```
tick:
  for each live task not owned:
    role start    → if concurrency allows in its conversation: own, run effect
    role inflight → own, run recover
    role waiting  → nothing (once per process: recover, to re-arm)
  for each live conversation with an abort marker: abort its live tasks (transitively), clear the marker
  for each live conversation with canEditContext (§8.1): kind(conv).next(conv)
  if nothing owned: no live tasks → "idle"; only waiting → "suspended"
  await any completion | timer | commit | signal      (events only wake the loop; every pass re-reads state)
```
The live set is in memory; the tick scans nothing. One loop per session; `conv.drive()` is a join
handle that resolves when that conversation is quiescent (the driver emits `quiescent(conv)` after a
`next()` that changed nothing) or when the loop returns.

Three facts about a conversation, each derivable from the live set and the conversation state,
decide scheduling; nothing is derived from "the last transcript entry":
- `canEditContext`: no `generation` of this conversation is in flight (`streaming`, `polling`) and
  every task spawned by the newest generation (`state.calls`) is terminal. Context edits
  (`replace`, `reset`), forks and rewinds require it. A generation in `pending`, `retry_wait` or
  `deferred` does not block it (the overflow path edits the context while its generation waits).
- `hasPendingGeneration`: a `generation` of this conversation is live in any status (`pending`,
  `streaming`, `retry_wait`, `deferred`, `polling`). While true, `next()` never creates another
  generation, whatever the context's tail says (a deferred generation with `pollDeferred: false`
  simply waits; the drive returns `suspended`).
- `needsGeneration`: `canEditContext && !hasPendingGeneration` and the conversation has an
  **unconsumed continuation**: the context's tail is a user message or a tool result of a
  generation without open calls, **and the run has not ended**. The run has ended when the newest
  generation answers the current tail and settled `failed` or `aborted`, or one of its tool results
  carries `terminate` or `aborted` (settlements write those on the entries: an assistant entry
  carries `calls`, a tool result carries `answers`, `terminate`, `aborted`). Nothing stores "run
  ended": a new user entry moves the tail past that generation, which is what a later `accept`,
  steer, follow-up or `on_yield` continuation does. So a final failure does not re-trigger with a
  fresh retry budget, and `terminate` ends the run even though the tail is a tool result.
Background tasks (jobs, older approvals) and keyed-value writes affect none of the three.

### 8.2 `next(conv)`

Reference behaviour for `session`, inherited by `subagent` and `fork`; called when
`canEditContext`; reads the tail of the **context list**, never the transcript:
1. abort marker → return.
2. steers in the inbox → insert as user entries (mode `all` | `one-at-a-time`); return.
3. `needsGeneration` → collapse decision (§6.5); else insert a `generation`
   `{ at: <last selected id>, model, thinking, tools }` with tools from
   `findValue(conv, "activeTools")` or `seedTools`.
4. the last selected entry is an assistant message of a settled generation without calls →
   follow-ups in the inbox → insert as user entries; else `on_yield` hooks: `continue(message)`
   inserts a user entry; else quiescent: a `subagent` settles its task with the last assistant
   message as `result`; the root does nothing.
5. after a reset the tail is whatever the bootstrap was: a user handoff continues; an empty list
   waits for the next `accept`.
6. `nextRun` items are consumed by the next `accept`.

### 8.3 Subagents and jobs

A subagent is a `subagent` task with `owns`: its effect creates the conversation (`ins_conv` with
`parent: {conv, at, asOf}`, config seeded per var flags, an empty or inherited context per
`context: "fresh" | "inherit"`) and inserts the prompt as the child's first user entry; it sits in
`running` while the child works; the child's `next()` settles it with `result`. A tool that starts
one either waits for the task to be terminal (foreground) and writes a result entry, or settles
at once with the task id (background). `abort` on a conversation reaches owned conversations.

A job: effect `set spawning` → spawn or adopt a process whose output goes to a durable log file
owned by the job (`state.logPath`) → `set running {pid}`; output is tailed into scratch; exit →
`settle exited {code}` with the tail as payload. `recover`: pid alive → adopt by `logPath`; else
`settle lost`. `abort`: kill. Scheduled: the effect ends with `set { status: planned, notBefore }`;
a kind MAY model each run as its own task `for: job`.

### 8.4 Forks and rewind

A fork is a conversation with `parent: {conv, at, asOf}` and `context: "inherit"`. `asOf` is the
commit boundary that **contains** entry `at` (the seq of the last record of the commit that
inserted it), so everything that commit did is visible as a unit: a tool settlement that appended
a result and wrote `activeTools` in one command is inherited whole. At creation the fork copies the
parent's context as of `asOf` (§6.6), restricted to ids `≤ at` and trimmed to the last complete
exchange, and reads keyed values with `{ asOf }` (position is implied: a value written by that
commit or earlier is visible, a later one is not). Its projection is its own context list (the
copied head + its own appends); nothing about the parent's later edits reaches it. `rewind(conv, at)`
= abort every task of `conv` with `at > at` (default; `keepRunning` opts out), then fork.
`/tree` = `conversations({ parent })`.

### 8.5 Open, resume, close, delete

- `open`: conversation states, live tasks, the entries on live conversations' context lists, scratch
  of live tasks. Start nothing; report live tasks by role.
- `resume(opts)`: the loop. `pollDeferred`.
- `abort(conv)`: `set_conv {abort}`, drain steer/followUp (keep nextRun); the driver aborts live
  tasks transitively and clears the marker. A no-op when nothing is live.
- `close()`: stop admitting commands; cancel in-process signals; live tasks stay live; jobs keep running.
- `delete(conv)`: report live tasks; on confirm, abort them, `del_conv`.

---

## 9. Observation

### 9.1 Watch

`watch(conv, { limit })` runs on the line: it registers the listener and reads the base in one
step, so there is no gap. Base:
```
{ asOf: seq,
  conversation: ConversationState,                        // includes context and prefixVersion
  entries: [ last `limit` transcript entries in transcript order, with payloads ],
  tasks:   [ live tasks ],
  scratch: { [taskId]: reduced } }
```
Then, in order, each with its seq: every journal record concerning the conversation (`ins_entry`
with payload, `ins_task`, `set`, `settle`, `set_conv`, `ctx_*`; owned conversations if requested),
and ephemeral deltas `{ frame | progress | kind-emitted, taskId }`, plus `quiescent` and `fault`.
Older pages: `entries(conv, { before, limit })`, each with its own `asOf`; the client ignores stream
records with `seq ≤ asOf` for entries it paged in. Remote clients RPC into the host, so the same
one-step base applies to them.

**Replicated plugin state** (`ReplicatedState<T>`) is a view over keyed entries with an adapter
contract:
- **Two sequences.** Hydration carries `{ journalThrough, stateSequence, ops }`: the journal
  watermark (for catch-up and dedupe) and the state stream's own consecutive sequence (deltas since
  the base), because Chord's replica requires consecutive updates and a journal filtered by key has
  gaps. Each delta entry carries its `stateSequence`.
- **Read-modify-write on the line.** `state.update(fn)` is `line.commit(view => { const draft =
  hydrate(view); fn(draft); return encode(draft) })`: the current value is read and the ops are
  derived *inside* the planner, so two concurrent updates serialize instead of both computing from
  the same base. Publication to the local replica happens on delivery; a failed commit publishes
  nothing. Preparation done outside the line (a summarizer) is revalidated inside the planner.
- **Binding.** A replica is bound to one conversation and one history. Switching to a fork or a
  rewound history is the same one-step operation as `watch` (§9.1): on the line, drop the old
  binding, read the hydration, register for the new binding, with no commit in between. Deliveries
  still arriving for the old binding are rejected by binding id. `stateSequence` is monotonic
  within a binding across periodic bases; it restarts only with an explicit hydration.
- State values are byte-capped (one bounded immutable value per write); base cadence bounds hydration length.

### 9.2 Rendering

Transcript order, with one rule: a `summary` is drawn immediately after its `through` (at the top
of the loaded page if `through` isn't loaded); everything else where it is. The context list marks
what the model sees (dim the rest).
A client-side `toLaneSnapshot(base)` (transcript, streaming message from the generation's reduced
scratch, running tools from live tool tasks, queues from the inbox) serves renderers that want the
old shape.

### 9.3 Events

Subscriptions over journal records by kind and transition; no separate event vocabulary.

---

## 10. Hooks

Points and decisions: `before_request` (edit), `after_response` (observe), `before_tool`
(`allow | block(text) | hold`), `after_tool`, `on_yield` (`pass | continue(message)`),
`before_collapse` (`decline | {meta}`). `hooks.on(point, handler, { priority })`, ascending; first
`block`/`hold`/`decline` wins; first `continue` wins. Hooks own no state.

---

## 11. Reference behaviours (informative)

- **generation.effect**: `set streaming`; projection (§6.4) + `before_request`; if aborted return;
  stream (frames → scratch, frame deltas); settle: overflow → `set retry_wait{overflow}` + collapse
  decision; deferred → `set deferred{handle}`; error → `retry_wait`/`failed`; else one command:
  `ins_entry assistant {by}` (+ `ctx_append`) + `settle done {produced, calls}` + one `ins_task tool
  {for, at: produced, callIndex, args}` per call (`truncated` if the stop reason is not toolUse).
- **generation.recover**: polling → deferred; frames → settle aborted with the partial and error
  results for its calls; none → retry or fail.
- **tool.effect**: truncated/missing → error result; `before_tool` unless `approved`: block → error
  result, hold → `set waiting`; `set running`; execute with the `ToolSink` (scratch; caps; details,
  usage, addTools, terminate, progress, memo); settle: `ins_entry tool_result {by, callIndex}`
  (+ `ctx_append`) + `settle done|aborted` (+ `value activeTools` when tools were added).
- **tool.recover**: replay-safe → run again; else an interrupted result with the last checkpoint.
- **collapse.effect**: capture `through` and `prefixVersion`; `set summarizing`; summarize the
  projection of the prefix; settle: `ins_entry summary {through}` + `ctx_replace {through, with,
  expectPrefixVersion}` + `settle done` in one command; a version mismatch fails the record.
- **reset by a tool** (`new_context`): the tool's settlement is one command: its result entry
  (transcript only), `settle done`, `ins_entry user <handoff> {by}`, `ctx_reset [handoff]`. The
  `canEditContext` precondition is evaluated against the state *after* the settlement in the same
  command, so the tool's own task does not block it; if sibling calls of the same generation are
  still unresolved, the tool instead records `state.pendingReset = { handoff }` on the
  conversation and settles; `next()` applies the reset in the command that runs after the last
  sibling settles. A user's `/clear` is `ctx_reset []` and requires `canEditContext`.

---

## 12. Public API

```ts
Harness.open(storage, { kinds, hooks, models, tools, resources, retry, collapse, toolExecution })   // starts nothing
harness.root() / conversation(id) / conversations() / inspect()
harness.watch(conv, { limit }, listener) / entries(conv, opts) / entry(id) / payload(id) / task(id) / find(conv, kind, key?)
harness.close()

conv.accept(input, { id? }) → { entryId }
conv.drive({ pollDeferred? }) → "idle" | "suspended"
conv.prompt(input) → AssistantMessage | undefined
conv.result(entryId) → pending | settled { entryId, message }
conv.steer / followUp / nextRun / cancelQueued / abort / waitForIdle / runWhenIdle
conv.collapse({ instructions? }) / resetContext(bootstrapIds) / fork({ at, context, label?, summary? }) / rewind(at, { keepRunning? })
conv.insert(kind, meta, payload?) / conv.task(kind, state) / conv.set(taskId, patch)
conv.setConfig(partial) / conv.state
harness.delete(conv, { confirm })
vars.declare / get / set;  hooks.on(point, handler, { priority })
```

---

## 13. Invariants and tests

1. The read model equals a replay at every commit, on every backend.
2. Every effect's first write is an inflight status; every settlement is one command.
3. Every non-terminal status has a driver action; an unknown status fails at open.
4. After `abort(conv)` and one drive, no live task remains under `conv` (transitively); scratch retired.
5. Delivery order and the listener rule (§7.1).
6. Projections never write; the driver never reads a payload.
7. Entries are never patched or reordered; a terminal task accepts no patch.
8. The context list is always `[head?, then entries in transcript order]`; every id on it exists; `through` never splits an exchange; `ctx_replace` with a stale `prefixVersion` rejects; a summarization survives appends and is rejected by a competing replace/reset; the context as of any commit boundary is reconstructible by replaying `ctx_*` records from the newest reset.
9. **Residency**: after open, memory holds live conversation states, live tasks, their scratch, and the entries on live conversations' context lists; nothing else.
10. **Bound**: resident entries = Σ context lists; resident tasks = |live| + one newest generation per conversation; independent of journal length on every backend. Measured at ≥100k turns with a cold reopen at every sample (on memory/JSONL the process heap also carries the backend's read model, by decision).
11. A fork's context never changes when its parent summarizes or resets later.
12. A task older than any summary survives a cold open, is recovered, settles, and is readable by id.
13. Watch has no gap: base and subscription are one line step; a paged-in entry never regresses a streamed update (`asOf`).

Scenarios: the v1 suite re-expressed; the walkthroughs in §15; the adversarial list: rewind after
mutating an old keyed value; a plugin writing thousands of unselected values (memory flat); compact
repeatedly (one head, never a chain); an ancient job waiting across many summaries; fork before a
later parent summary; a reset while a summarization runs (summary rejected); page while updates
arrive (`asOf`); render a summary with a retained tail at `limit: 3` (§15.6).

---

## 14. Contrast

| | runtime/ (lanes) | dom/ and pico v1 | pico v2 |
|---|---|---|---|
| unit | lane over an entry branch | node tree | conversation = transcript + tasks + values, with a context list |
| in-flight state | one 13-leaf op record per lane | status on nodes | status on tasks; one live set |
| model context | scan back to the compaction entry | collapse node / folds | explicit list: head + suffix; three ops |
| memory | window per lane | whole tree (v1) | context entries + live tasks |
| history | branch index, `getEntry` | resident tree | transcript pages by id, `findValue`, `find` |
| subagents | child lanes | nodes | tasks owning conversations |
| plugin state | closures + custom entries | nodes | keyed value entries |
| rewind | move a cursor | fork node | fork with `{at, asOf}`, copied context, tasks aborted by `at` |
| storage | entries + branch index | ops + checkpoints | journal + read model; JSONL rebuilds by scan, SQLite keeps tables |

---

## 15. Walkthroughs

Notation: `E` entry, `T` task, `set`/`settle` patches, `ctx` context ops; seq = id; live set after
each step; `C.context` shown when it changes. `at` on a task = the entry it started from; `by` on an
entry = the task that wrote it; `for`/`calls` are the explicit dependencies.

### 15.1 Prompt → generation with a tool call → settle

```
 1  E user      C "add auth"                              live {}       ctx [1]
 2  T gen       C {pending, at:1}                         {2}
 3  set 2 {streaming}                                      (frames → scratch(2); frame deltas)
 4  E assistant C msg(text + call echo) by:2               ctx [1,4]     ┐ one commit
 5  settle 2 {done, produced:4, calls:[6]}                 {6}           │
 6  T tool      C {planned, for:2, at:4, callId:x, name:echo}            ┘
 7  set 6 {running}                                        (output → scratch(6); progress deltas)
 8  E tool_result C result by:6 callIndex:0                ctx [1,4,8]   ┐
 9  settle 6 {done, produced:8}                            {}            ┘
```
Tick: C's newest generation (2) is terminal and its call (6) is terminal → quiescent → `next`:
last entry is a tool result of a generation without open calls → generation:
```
10  T gen C {pending, at:8}   …   12 E assistant C "done" by:10  ctx [1,4,8,12]   13 settle 10 {done, produced:12, calls:[]}
```
`next`: settled generation without calls, no follow-ups, `on_yield` passes → `quiescent(C)`;
`prompt()` resolves; `result(1)` = entry 12. Projection for 10 was `[1, 4, 8]` by list; the live
set never exceeded one id; a crash after 7 reopens with `{6}` live and recovers it.

### 15.2 Parallel calls, out of order, one blocked

```
 5  settle 2 {done, produced:4, calls:[6,7,8]}   6,7,8 T tool {planned, for:2}      {6,7,8}
 9  E tool_result "write is not allowed in plan mode" by:8 callIndex:2   10 settle 8 {done, blocked}   {6,7}   (before_tool blocked it)
11  set 7 {running}  12 set 6 {running}
13  E tool_result by:6 callIndex:0   14 settle 6 {done}                              {7}
15  E tool_result by:7 callIndex:1   16 settle 7 {done}                              {}
```
`C.context = [1, 4, 9, 13, 15]` (append order); projection orders the three results by `callIndex`
within message 4: 13, 15, 9. Quiescent after 16 → generation. Sequential mode: `tool` exclusive.

### 15.3 Held call, released from a UI, crash in between

```
 6  T tool C {planned, for:2, name:deploy}      7  set 6 {waiting}   {6}      (before_tool → hold)
```
Not quiescent (call 6 is not terminal) → no generation. Every watcher shows a waiting tool with its
call. Crash; reopen: live `{6}`, waiting → reported, not started. UI: `set 6 {planned, approved:true}`
→ effect skips the gate → runs → `E tool_result` + `settle done`. Abort instead: the driver aborts
6 → error result + `settle aborted`; the exchange is complete; the turn ends (an aborted call means
no new generation).

### 15.4 Subagent, foreground and background

```
 6  T tool     C {planned, for:2, name:subagent, args:{prompt}}     7 set 6 {running}       {6}
 8  T subagent C {planned, for:6, at:4, prompt, context:"fresh"}                             {6,8}
 9  ins_conv S {parent:{conv:C, at:4, asOf:8}, config, context:[]}
10  set 8 {running, owns:S}
11  E user S "explore" by:8                                          S.context [11]
```
S is live (its owner 8 is live) and quiescent with a user entry last → `next(S)` inserts generation
12 … which proceeds as §15.1 inside S:
```
… 20 settle 12 {done, produced:19, calls:[]}      S.context [11, 19]
21  settle 8 {done, result: <entry 19's message>}                                            {6}
```
Foreground: the tool effect was awaiting "8 terminal" → `22 E tool_result C "child said: …" by:6` +
`23 settle 6 {done}` → `C.context [1, 4, 22]`. Background: the tool settles right after 10 with
"started subagent 8"; 8 stays live on its own; a later `subagent_status` tool reads task 8 by id or
S's transcript. C's projection never contains S's transcript. `watch(S)` shows S. Abort S only:
`set_conv S {abort}` → 8 settles aborted → 6 (foreground) writes an error result. Crash while S's
generation streams: reopen → `{6, 8, 12}` live → 12 recovers (partial or retry), 6 re-awaits 8.
Nested: S's tool can start T; `conversations({parent})` lists C, S, T.

### 15.5 Background job across a restart, consumed later

```
 6  T tool C {planned, for:2, name:bash, args:{cmd, background:true}}   {6}
 7  T job  C {planned, at:4, cmd, for:6}                                 {6,7}
 8  set 7 {spawning}   9 set 7 {running, pid:4242, logPath}   (log tail → scratch(7); progress deltas)
10  E tool_result C "started job 7" by:6   11 settle 6 {done}            {7}      C.context [1,4,10]
```
Generation 2's turn is quiescent (its call is done); job 7 is live but not a dependency → `next`
proceeds. Twenty turns and one summary later (`ctx_replace` moved the head), job 7 is untouched:
tasks are never on the list. Crash; reopen: `{7}` running, unowned → `job.recover`: pid alive →
adopt by `logPath`; dead → `settle lost {tail}`. Exit: `95 settle 7 {exited, code:0} payload{tail}`.
Turn 30: `bash_result 7` reads task 7 by id (one row) and its payload; writes a result entry. Its
`at: 4` was folded long ago; nobody needed it.

### 15.6 Collapse, speculative, subsuming, and the rendering at `limit: 3`

Transcript `u1 a1 u2 a2` (ids 1..4), context `[1,2,3,4]`, budget exceeded, `keepRecent` keeps `u2 a2`:
```
20  T collapse C {pending, through:2, prefixVersion:0}      21 set 20 {summarizing}
    — meanwhile generation 22 runs and appends 23 (u3), 25 (a3): ctx [1,2,3,4,23,25] —
26  E summary C "…" through:2 by:20   (context: "none": not auto-appended)     ┐ one commit
27  ctx_replace {through:2, with:26, expectPrefixVersion:0}   → ctx [26,3,4,23,25]   │  prefixVersion 1
28  settle 20 {done, produced:26}                                                  ┘
```
A reset that had landed between 21 and 26 would have bumped `prefixVersion` and 27 would reject;
20 would settle `failed`. A second collapse later captures `through: 23` and summarizes the prefix
`[26, 3, 4, 23]`, which includes summary 26: the new summary subsumes it; the list stays one head
plus a suffix.

Rendering: transcript order is `u1 a1 u2 a2 u3 a3 S` (S = 26 was appended last). A watch with
`limit: 3` receives `[u3, a3, S]`; S is drawn after its `through` (a1), which isn't loaded, so at the
top: `S u3 a3`. Paging `before: u3` returns `[u2, a2]`, drawn below S because their positions are
after a1: `S u2 a2 u3 a3`. Paging again returns `[u1, a1]`: `u1 a1 S u2 a2 u3 a3`. Pagination uses
transcript order as stored; only the summary's display position is relocated.

### 15.7 Reset (Codex-style)

The model calls `new_context` with a handoff note. If it is the generation's only unresolved call,
its settlement carries the reset (the precondition is checked against the post-settlement state);
otherwise the reset is recorded as pending and applied when the last sibling settles:
```
40  E user C "<handoff>" by:<tool task>   41 ctx_reset {ids:[40]}    ctx [40]; prefixVersion 2
    (the tail is a user message → the next generation projects [40]; a user /clear resets to [] and waits)
```
Transcript unchanged; jobs unchanged; keyed values unchanged. The next generation projects `[40]`
plus subsequent appends. A watcher draws the handoff at its position and dims everything above it.

### 15.8 Fork and rewind

Fork at `a1` (entry 2) after §15.6 published: the fork copies C's context restricted to ids `≤ 2`:
`[26]`? No: 26 has `through: 2`, its head stands in for `1..2`; restricted to `≤ 2` that head is not
applicable (it was published after the fork point and the fork's `asOf` is earlier), so the fork
reads C's context **as of `asOf`** = `[1, 2]`, trims to the last complete exchange, and starts from
`[1, 2]`. Later parent summaries never reach it (invariant 11). `rewind(C, at: 2)` while tool 7 runs
under generation 2: abort work with `at > 2` (tool 7 → error result, exchange complete), then fork.
Keyed values in the fork: `findValue(F, key, { asOf })`, where `asOf` is the commit that inserted entry 2.

### 15.9 Plugin state and replicated state

Plan mode on at turn 12: `E value C key:"plan.mode" {on:true, file}` (unselected). `before_request`
at turn 20: `findValue(C, "plan.mode", { before })` → strips write tools. Fork at turn 10: same read
with `before: 10` → off. A todo board: `E value key:"todo.board" {items}` on each change; found by
`find(C, "value", "todo.board")`; no lifecycle, no residency. A canvas: `E value key:"canvas.base"`
at creation and every N strokes; `E value key:"canvas.delta"` (chord ops) per stroke batch; a new
client hydrates with the newest base before `asOf` plus the deltas after it, then applies stream
records; rewind to P reads the same with `before: P`. Un-journaled preview (cursors) is scratch on
the canvas's live task, if it has one.

### 15.10 Open, in general

Read conversation states; read live tasks (`role <> 'terminal'`); for each live conversation read
the entries on its context list (one batched read); read scratch of live tasks. Then `resume()`.
Cost is independent of the journal's length; JSONL pays a header scan first.

---

# Part II — the complete contract

Parts I (§0–§15) defined the model. This part specifies every surface an implementation needs to get
the edge cases right. Templates and skills are a layer above the harness and are not specified here.

## 16. Tools

```ts
interface Tool {
  name: string; description: string; parameters: JsonSchema;
  replay?: "safe" | "never";                          // default "never": an interrupted execution is not re-run
  output?: { retain?: "head" | "tail"; maxBytes?: number };   // default tail, 64 KiB
  execute(args: JsonObject, signal: AbortSignal, out: ToolSink, resources: Resources): Promise<void>;
}
interface ToolSink {
  write(text: string): void;                          // appended to scratch; capped per `output`; truncation is marked in the result
  details(json: JsonValue): void;                     // result details, replaced on repeat
  usage(u: Usage): void;                              // recorded to the usage ledger at settlement
  addTools(names: string[]): void;                    // becomes a `value activeTools` entry at settlement; unknown names are dropped
  terminate(v: boolean): void;                        // the run stops after this exchange; the assistant's other calls still settle
  progress(partial: JsonObject): Promise<void>;       // durable checkpoint in scratch; a `progress` delta to watchers; reported by recovery
  memo: { get(key): Promise<JsonValue | undefined>; set(key, v): Promise<void> };   // durable per-execution memos, retired at settlement
}
```
Rules. A tool's throw becomes an error result (`isError: true`, the message text); a throw after
`signal.aborted` becomes an aborted result. Only `execute` is inside the harness's try; a storage
failure while settling propagates (§7.3). Results are `tool_result` entries `{ callIndex, isError,
bytes }` with the capped text (`[truncated: N bytes total]` appended when capped), details, and
images. A call for a tool not in `tools` settles with `not found`; a `truncated` call (stop reason
other than toolUse) settles with `not executed` and never runs. `addTools` names not present in
`tools` are ignored. `terminate` ends the run after the current exchange: no new generation, the
turn is quiescent, `drive` returns `idle`. Concurrency: `tool` is parallel per conversation unless
`toolExecution: "sequential"`, in which case calls run in `callIndex` order and a `hold` blocks the
ones after it.

## 17. Generation

**Request**: `systemPrompt` (option, static or `() => string`) · messages = projection (§6.4) ·
tools = the definitions of `activeTools ∩ tools` · `streamOptions` (option, merged with the call's)
· `reasoning` from `thinkingLevel` (`off` → none). `before_request` hooks run after `set streaming`
and before `streamSimple`; a hook that throws fails the generation (`failed`, `errorMessage`); the
abort marker is re-checked after the hooks and before the provider call.

**Settlement classification**, in order: aborted (signal) → `aborted` with the partial from frames
and an error result per call; `stopReason: "deferred"` → `deferred {handle, poll: 0, notBefore}`;
`stopReason: "error"` and overflow (provider message matches the overflow patterns, and this attempt
is not already an overflow retry) → `retry_wait {overflow, notBefore: 0}` and a collapse decision;
if the collapse is declined or nothing can be folded → `failed`; `stopReason: "error"` otherwise →
`retry_wait {attempt+1, notBefore: now + base × 2^(attempt−1)}` while `attempt < maxAttempts`, else
`failed`; anything else → `done`: one command with the assistant entry (+ `ctx_append`), `settle
{produced, calls, usage, stop}`, one `tool` record per call (`truncated` if the stop reason is not
toolUse). Usage is recorded to the ledger keyed by the generation id.

**Deferred**: `deferred` is a `start` status honoured only when `pollDeferred` is true; the effect
`set polling {poll+1}` → `fetchDeferred(handle)` → final message → the same classification; still
deferred → `set deferred {notBefore: now + pollAfterMs}`; fetch error → `deferred` with backoff.
`cancelDeferred(handle)` is attempted on abort (best effort). `pollDeferred: false` leaves such
generations alone and `drive` returns `suspended`.

**Retry** applies to generation and collapse: `attempt` starts at 1; `retry.maxAttempts` bounds it;
`retry.baseDelayMs` is the base of the backoff; `retry_wait` is a `start` status with `notBefore`;
an abort during `retry_wait` settles `aborted` immediately (the timer is not waited out).

**Recovery**: `streaming` unowned → frames present → `aborted` with the partial and error results
for any calls in it; none → `retry_wait {attempt+1}` or `failed`. `polling` unowned → `deferred`.

## 18. Queues

Inbox items: `{ id, kind: "steer" | "followUp" | "nextRun", entry }` where `entry` is the message
stored as an unselected `value`-like entry (`key: "inbox"`) so the text is journaled once.
- `accept(input)` on an idle conversation (`canEditContext && !hasPendingGeneration` and no
  unanswered selected user entry; background tasks do not count): any `nextRun` items are inserted
  as user entries first, then the prompt; the run starts.
- `accept` on a busy conversation queues a `followUp`. `steer(text)` queues a steer; `followUp`
  and `nextRun` queue their kinds. All return the item id.
- `steeringMode` / `followUpMode` (`all` | `one-at-a-time`, per conversation, default `all`):
  `next()` drains steers before a generation, follow-ups when the turn would otherwise end; in
  `one-at-a-time` only the oldest is served per boundary.
- `cancelQueued(id)` → `cancelled` | `already_consumed` | `not_found`.
- `abort` drains steer and followUp items and returns them to the caller; `nextRun` items survive.
- `result(entryId)` = the first assistant entry after the input entry whose generation settled with
  no calls; `pending` while the conversation has live tasks or the input is still queued;
  `unknown` for an id that is neither.

## 19. Outcomes, reports, errors

- `drive(opts)` returns `idle` (no live tasks), `suspended` (only waiting tasks, or deferred with
  `pollDeferred: false`), `closed`. Waiting for an outcome is a state predicate re-checked after
  every commit and driver pass; events are wake-ups, never the source of truth. `conv.drive()` joins the session loop and resolves on `quiescent(conv)` or when the loop
  returns; two callers joining the same conversation await the same condition.
- `inspect()` → `{ start: Task[], inflight: Task[], waiting: Task[] }` from the live set; `open()`
  reports the same and starts nothing.
- Errors: `Closed` (command after `close`), `Faulted` (command after a fault; `.reason`),
  `Rejected` with a code (`invariant`, `busy`, `unknown_target`, `version_mismatch`, `not_found`);
  none of these is a fault. A listener that throws is reported through the `handler_error` signal.
- `close()` waits for in-process effects to observe cancellation (each `abort` signal fires; effects
  return), does not settle anything, does not wait for jobs.

## 20. Hooks, precisely

| point | input | decision | combination |
|---|---|---|---|
| `before_request` | `{ conv, generation, request: { systemPrompt, messages, tools, streamOptions } }` | `request` | applied in order |
| `after_response` | `{ generation, message }` | — | all run |
| `before_tool` | `{ call: Task, args }` | `allow` \| `block(text)` \| `hold` | first block/hold wins; later hooks do not run |
| `after_tool` | `{ call, result }` | — | all run |
| `on_yield` | `{ conv, turn: Entry }` | `pass` \| `continue(message)` | first continue wins |
| `before_collapse` | `{ conv, through, prefixVersion }` | `decline` \| `{ meta }` | first decline wins; metas merged |
A hook that throws: `before_request` fails the generation; `before_tool` blocks with the error text;
`before_collapse` declines; `on_yield` passes; observers are reported as `handler_error` and ignored. Hooks are called by effects, outside the line, so a hook
MAY `await ctx.commit(...)` (append entries or keyed values, insert work); those commands interleave
with other actors under §24. A `before_request` hook affects *this* request only through the
request it returns; an entry it appends is projected from the next generation on. Only listeners
(watch/`on`) are forbidden from issuing commands inside their callback.

## 21. Watch wire shapes

```
base   { type: "base", asOf, conversation: ConversationState, entries: Entry&{payload}[], tasks: Task[], scratch: { [taskId]: JsonValue } }
record { type: "record", seq, record: ins_entry&{payload} | ins_task | set | settle | set_conv | ctx_append | ctx_replace | ctx_reset | ins_conv | del_conv }
delta  { type: "delta", taskId, kind: "frame" | "progress" | string, payload }
signal { type: "quiescent", conv } | { type: "fault", message } | { type: "handler_error", taskId?, message }
page   entries(conv, { before | after, limit }) → { asOf, entries: Entry&{payload}[] }
```
Base and subscription are one line step; every record after the base has `seq > asOf`; a page has
its own `asOf` and records with `seq ≤ asOf` are ignored for its entries. `del_conv` on the watched
conversation ends the watch. A `ctx_replace`/`ctx_reset` record is the client's cue to dim or drop.

## 22. Usage ledger and telemetry

**Usage**: one row per settlement that carried usage (`generation`, `collapse`, `tool` via the
sink): `{ taskId, conv, seq, usage }`; append-only; queried by conversation or session; never
rewritten; summed by clients. Not in the journal.

**Telemetry** uses pi's callback `TelemetryContext` (typed schemas, no second contract). Spans and
their parents follow the procedure nesting:
```
harness.open · harness.drive (per pass)
  conversation.next
  task.effect / task.recover / task.abort   (attributes: kind, taskId, status from→to, attempt)
    ai.request                              (model, usage, stop reason, durations; never prompts or completions)
    tool.execute                            (name, callIndex, bytes, isError; never args or results)
    hook (point, name, decision)
  line.command (op count, seqs, duration)   ← parent: the command's caller
  watch.deliver (listener count, duration)
```
A pre-aborted signal starts no span. Attributes are ids, names, counts, durations, statuses and
usage; never message text, arguments, results, file contents, provider payloads, headers or handles.
Each command and each effect carries its own telemetry parent and abort signal; cancellation ends
only that caller's observation.

## 23. Storage conformance

Each backend passes:
1. `append` is atomic per commit and ordered; seqs are dense and monotone.
2. Read model equals a replay of the journal after every commit (entries, tasks, conversations,
   context lists, `prefixVersion`).
3. `entries(conv, {before|after, limit})` equals a scan; ranks are correct; `findValue`/`find`
   equal a scan.
4. Scratch: append/read/set/get per task id; survives a process crash; retired by settlement;
   orphans removed on open; a crash between settlement and retirement is tolerated.
5. JSONL: one line per commit; a torn final line is truncated on open; rebuild-by-scan yields the
   same read model as SQLite's tables for the same journal.
6. Usage rows survive and are queryable.
7. Open on an empty store creates the root conversation once; open on a non-empty store writes nothing.

## 24. Race catalog (each has exactly two durable orders; tests assert both)

| race | orders |
|---|---|
| `accept` vs `accept` on an idle conversation | first is the prompt; second queues as followUp |
| `accept` vs process loss before `drive` | entry absent → caller retries by id (idempotent); present → `drive` runs it |
| `drive` vs `drive` | both join one pass |
| `abort` vs generation settlement | marker first → `aborted` with partial and error results; settlement first → `done`; a later abort is a no-op (stale) |
| `abort` vs tool outcome | marker first → the effect's signal fires and it settles `aborted`; outcome first → `done`, result preserved |
| `abort` vs `retry_wait` | settles `aborted` without waiting the timer |
| `abort` vs collapse settlement | marker first → collapse `failed`, list unchanged; settlement first → list replaced |
| `abort` vs `on_yield` continuation | marker first → the continuation entry is not inserted; entry first → the run continues and abort settles it |
| `cancelQueued` vs boundary consumption | `cancelled` | `already_consumed` |
| `setConfig` vs generation start | old config or new; the generation records what it used |
| `nextRun` vs `accept` | captured by this prompt or stays for the next |
| collapse settlement vs `ctx_reset` | reset first → `version_mismatch`, collapse `failed`; settlement first → the reset applies to the new list |
| collapse settlement vs appends | appends survive either order |
| frame/progress write vs settlement | settlement awaits pending scratch writes, then retires scratch; a crash between leaves orphans for open |
| watcher registration vs commit | one line step: old base + all later records, or new base |
| `close` vs settlement | settlement committed before close, or the task stays inflight and recovers next open |
| fork vs parent summary | the fork copied its list as of `asOf`; the summary is not applied to it |
