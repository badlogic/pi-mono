# pico implementation plan

Clean room. Nothing from pico2 is copied; its tests are read for the bugs they caught (a failed
generation that never ended its run, refs inside task patches, a collapse deadlocking appends,
quiescence firing during a retry wait, watch dropping late deltas) so that packages 6, 9, 12 and
16 each carry a case for them.

Bottom up. Each package is a module with its own tests and no forward references; the suite is
green after every one. The reference for every detail is `pico-v3.md`; `pico-usage-guide.md`
shows the surface each package has to end up with.

## 1. Types and ids

`Id`, `Entry`, `EntryKind`, `ContextEdit`, `Task`, `TaskRole`, `Conversation`,
`Address`/`Value`/`List`/`Scope`, `Write`/`CommitBatch`, `Page`/`Cursor` and the query shapes
(§2, §4.1, §5.1, §7.2–7.3). No code.

Test: it compiles; a fixture file with one instance of every record shape.

## 2. Memory storage

`Storage` and `MemoryStorage`: `commit` numbering from `lastSeq`, point reads, fork-aware
`scanEntries` / `scanTasks` / `scanConversations` with cursors, target-capped `newestHead`, value
versions and list elements read at a position, `ownedFrom`, the set of entry kinds written.

Tests: every row of the §7.2 query table against hand-built batches; ids are `lastSeq + 1 + i`; a
live-task scan decodes no terminal rows; `remove` and `clear` hide by position.

## 3. The line and `Tx`

`commit(plan)` on a serialized line: buffered writes, ids final at call time, rewindable
conversation value/list writes after an entry throw, a throwing plan discards everything, publish
after persist, `kick` when a batch touched a task. Session and sticky conversation state, task
writes and conversation writes may appear anywhere. `value` / `list` / `entry` / `task` / `patch` /
`settle` build the batch of §7.3.

Tests: concurrent commits serialize; a rejected commit consumes no ids; each builder verb produces
the expected write; reads inside a plan see committed state only; session and sticky conversation
writes may follow and reference a new entry; rewindable value set/delete and list
append/remove/clear after an entry each reject.

## 4. Entry kinds and context

`EntryKind`, the registry, the built-in kinds (`user`, `assistant`, `tool_result`, `system`,
`notice`, `summary`, `handoff`, `reset`) with `project`, `head` and `edit`; context = newest head
prepended to the fork-aware range from its returned id, older heads excluded, edits folded in
transcript order; projection to pi-ai messages with tool results ordered by call index; the `system`
kind's epoch fold (newest baseline plus the deltas after it, older deltas dropped) and its projection
into the baseline slot / `SystemMessage`s. No `compose`.

Tests: summary keeps the tail; handoff and reset; repeated compaction subsumes; a returned head id
below the previous visible head kind's returned id is rejected; edits omit/replace targets and persist
across turns; the fold on a context that kept an old delta; tool-result order.

## 5. Forks and historical reads

`createConversation` with `parent`, the shared prefix in fork-aware `scanEntries`, capped-source
lookup for values and lists, arbitrary content-entry fork points.

Tests: a fork sees the head, edits and values in force at its entry; heads/results the source adds
later are invisible; deep fork chains; successful incomplete tool exchanges project with missing
results but inherit no tasks; state committed after the entry (a model change) is not in the fork.

## 6. Task kinds and the driver

`TaskKind`, the registry, `TaskContext` (`commit`, `scratch`, `sleep`, `signal`, `config`,
`hooks`), the driver of §6.1 (`owned`, `Wake`, attached scopes, `drive` as a waiter, poison guards,
abort join and re-read), scopes of §6.2. Test kinds only: a counter, a blocker, a kind that
returns without changing status, a kind that ignores its signal.

Tests: roles drive execute / recover; a blocked execute holds nothing up; the spin guard; `after`
gates a start; `drive` resolves on foreground idle while a background task keeps running and the
loop keeps serving it; abort marks in both race orders; reopen recovers inflight; a mark written
by one process is applied by the next.

## 7. Scratch

Scratch batches, one task per batch, `ScratchTx`, retire on settle, sidecar-independent (memory).

Tests: a crash before settle keeps scratch; settle deletes it; a write after settle is rejected; a
new attempt clears its list.

## 8. Harness shell and handles

`Harness.open` (built-in registries, `kinds` and `replace` options, kinds-set check, `inspect`,
`drive`, `close`, `shutdown`), `ConversationHandle` (`commit`, `value` / `list`, `config` /
`settings`, `fork` with `abort`, `abort`, `hooks.on` scoped with `subtree`), `abortTask`,
`conversations` with `parent` / independent filtering. No agent behaviour yet.

Tests: open on empty vs existing storage; an unknown kind rejects without scanning entries;
replace by name keeps `h.kinds.<name>` consistent; `settings` round-trips; scoped hooks run after
harness-wide ones, innermost last.

## 9. Generation kind

Statuses pending → streaming → done / failed / retry_wait / deferred / aborted on a faux provider;
config capture (model, thinking, selected tools, profile, budget); `system_instructions` with
sections merged across handlers and the diff writing `system` entries; `before_request`,
`after_response`, `on_yield`; retry sleeps in execute; recover from frames; usage recorded per
attempt.

Tests: the six system-entry traces from the guide (tool added, removed, host section changed, MCP
schema changed, plugin section on and off, `addTools`); fresh baseline after a head; a fork diffs
against its own config; a restart emits only the changed section; in-band `aborted` stop reason;
crash while streaming publishes the partial; retry budget exhausted → failed with no successor.

## 10. Tools, post_tools, exchanges

The tool kind with the sink (`ToolOutput`, `ToolOutputState`, limits enforced by the sink, `diag`,
`delegate`, `handoff`, `addTools`, `terminate`), `before_tool` (fail-closed) and `after_tool`,
replay policy on recover; post_tools with `after`, terminate / handoff / steer / next generation;
`accept` idle vs busy; `prompt` and `answerTo`.

Tests: parallel tools completing in either order; sequential via `after`; an aborted generation
creates no tool tasks/results while an aborted existing tool writes its own error result;
`new_context` resets after the exchange, never inside it; `addTools` writes the rewindable loadout
before any handoff/user entry in the settlement commit and appears in the next turn's `toolsAdded`;
a throwing tool → error result, `terminate` still honoured; truncation diag from the sink; `accept`
with the same `requestId` twice → same entry, `answerTo` finds it after further turns.

## 11. Inbox

`pi.inbox` as a conversation list, the modes, the three dequeue points, `cancelQueued`, abort
draining steer and followUp.

Tests: the modes table; cancel vs land in both orders; input queued during a collapse lands.

## 12. Collapse

Manual, threshold and overflow; `before_collapse`; publish only if no newer head; the overflow
chain (generation settles → collapse → new generation carrying the attempt).

Tests: a summary lands under a running generation and later entries stay in context; a competing
head makes a summary stale while intervening edits do not; overflow retries once and no live task
ever waits on the collapse; threshold before a turn; abort of a running collapse leaves appends
flowing.

## 13. Subagents

The `subagent` tool (`run`, `spawn`, `send`, `status`, `wait`, `stop`), ownership links, foreground
reach through live owners, `run`'s recover driving the child again, `spawn` initialization of
config, `answerTo` on the child.

Tests: restart in the middle of `run`; parent abort reaches a `run` child and spares a `spawn`
child; `stop`; nested children; the child's first turn writes its own baseline.

## 14. Jobs and the budget

`jobKind` on `ExecutionEnv.exec` with output into its scratch, `waitForTask` / `jobOutput`, `bash`
delegating first and waiting with the budget, `notify` and the `notice` entry, the `job` tool,
schedules.

Tests: budget expiry settles the call with `delegated` and the job continues; the notice appears
on completion; a schedule loops and `abortTask` ends it; recover → `lost` or rerun by policy; a
user abort during the wait kills a non-backgrounded job.

## 15. Previews

`ctx.preview` as a Chord tracker per task; the generation applies stream events to a partial
message, the tool's preview is its sink state, the job's the same; `preview.init` on attach and
reopen; flush after each scratch commit.

Tests: one token → one `a` op and nothing else; no `r` mid-stream; init after reopen yields a base
equal to the live preview; a sliding tool tail → `t` + `a`.

## 16. Watch

`ConversationView`, `ConversationEvent`, the exported kind-free `applyEvent`, `WatchHandle`
(capture on the line, bounded buffering, `resnapshot`, `unsubscribe`), the session watch with
`report` and `usage`, the usage ledger (`pi.usage` + totals).

Tests: the fold is correct (view after N events equals a fresh capture, randomized); head and edit
entries update derived context; all events of one commit delivered together; a thin-client reducer
over a recorded stream with no kinds loaded;
lag → fault → resnapshot; `resnapshot` from inside the listener; usage totals equal the ledger
fold, failed and aborted attempts included.

## 17. JSONL storage

Append-only batches, replay on open, torn tail discarded, malformed line fails open, the kinds set
from replay, values as Chord deltas (full when first or small, ops otherwise), scratch sidecars
retired after the main-file settle.

Tests: conformance against memory (one mutation stream, identical query results); linear file
growth under repeated sets of a large value; crash between the settle write and the sidecar unlink.

## 18. SQLite storage

Tables and indexes of §7.5, scratch rows deleted in the settle transaction, storage version and
`migrate`.

Tests: conformance three ways; a cold reopen decodes only live rows (count them); a version
mismatch rejects.

## 19. Race matrix and telemetry

The §10.2 matrix in both orders with faux clocks, fake processes and storage barriers; spans per
task call and per commit.

Tests: the matrix; span tree for one turn with a tool and a retry.

## 20. Clients

mini (`worker/run.ts`, `worker/lane-service.ts`, TUI `apply(view)`), the experimental agent's four
seam files (`session-worker.ts`, `agent-controller-provider.ts`, `models-provider.ts`,
`transcript-provider.ts`), real providers. This is the gate: system deltas on a live model, a
retry, a spawned subagent surviving a restart, speculative compaction under a running turn.

Packages 1–16 are what the gate needs; 17–19 can land after it.

## What comes from the lane harness, and how

Clean room means no imports from `src/harness/runtime`, `session`, `agent-harness.ts` or the
`dom`/`pico`/`pico2` spikes. Where the old code has something worth keeping, it is **copied** into
`src/harness/pico/` and owned there; pico must build with the rest of `src/harness` deleted.

Copy (under `packages/agent/src/harness/` unless noted):

| what | from | into | package |
|---|---|---|---|
| `ExecutionEnv` / `FileSystem` / `Shell` types, the Node env, capture and spill | `types.ts`, `env/`, `tools/tool-context.ts` (03-execenv) | `pico/env/` | 10, 14 |
| shell output limits, `applyShellOutputUpdate`, truncation totals | `utils/` | `pico/env/output.ts` | 10 |
| the built-in tools (`read`, `write`, `edit`, `bash`, `image`) | `tools/*.ts` | `pico/tools/`, rewritten to the sink signature | 10, 14 |
| system prompt builder, skills, context files, templates | `system-prompt.ts`, `skills.ts`, `prompt-templates.ts`; the keyed-sections builder in `coding-agent` | the host's `system_instructions` handler, not the harness | 9, 20 |
| telemetry span helpers | `telemetry.ts` | `pico/telemetry.ts` | 19 |

Depend on, as packages (they are not the old harness):

- `@earendil-works/chord/delta` (15, 16, 17)
- `@earendil-works/pi-ai`: `faux` provider for tests, `utils/estimate` for thresholds, `SystemMessage` (4, 9, 12)

Read before writing the equivalent, then close the file:

- `runtime/drive/retry.ts`, `deferred.ts`, `response.ts`: retryable-error classification, overflow detection, deferred polling (9)
- `compaction/`, `runtime/drive/boundary.ts`: the exchange-cut rule and the summarizer prompt (12)
- `runtime/drive/recovery.ts`, `restore.ts`: the per-phase recovery case list (9, 10, 14)
- `runtime/drive/tool-placement.ts`: the result order projection must reproduce (4)
- `hooks.ts`, `docs/harness.md` §before_tool: the exact decision shape (10)
- `session/`, `test/harness/jsonl-*.test.ts`: torn-tail and malformed-line rules (17)
- `session/`, `test/harness/mutation-line.test.ts`: line discipline edge cases (3)
- `agent-harness.ts`: `LaneSnapshot` / `HarnessEventPayload`, for the `toLaneSnapshot(view)` shim only (20)

Tests to port (`packages/agent/test/harness/`): the three conformance suites as the model for 17–18;
`compaction`, `branch`, `context`, `execution-*`, `values`, `mutation-line` as the parity source for
19; `system-prompt`, `prompt-templates` for the host handler in 9; `tools`, `truncate`,
`output-capture` for 10; pico v1's 27 ported scenarios as the shortest list of behaviours to
re-prove.

Do not read: `runtime/lane.ts`, `reducer.ts`, `drive/reconcile.ts`, `structural.ts`,
`terminal.ts`, `checkpoint.ts`, and the `dom` spike. They are the operation state machines and the
reconciler this design replaces.
