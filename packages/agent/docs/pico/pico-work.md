# pico implementation plan

Clean room. Nothing from pico2 is copied; its tests are read for the bugs they caught (a failed
generation that never ended its run, refs inside task patches, a collapse deadlocking appends,
quiescence firing during a retry wait, watch dropping late deltas) so that packages 6, 9, 12 and
16 each carry a case for them.

Bottom up. Each package is a module with its own tests and no forward references; the suite is
green after every one. The reference for every detail is `pico-v3.md`; `pico-usage-guide.md`
shows the surface each package has to end up with.

## 1. Types and ids

`Id`, `EntryIdentity`, `EntryBase`, the composable `EntryData` / `ModelProjection` /
`ContextHead` / `ContextEdits` facets, `Entry`, `EntryKind`, `EntryInput`, `ContextEdit`, `Task`,
`TaskRole`, stored task roles, `Conversation`, `InboxItem`, `InputResult`, `InboxOp`, acceptance
receipts, `Call` (an alias of Chord Context), `TaskRuntime`/`ToolRuntime`, private typed invocation
identity, `Address`/`Value`/`List`/`Scope`, `Write`/`CommitBatch`, `Page`/`Cursor` and query shapes.
Every async harness/handle/runtime method takes a required final Call; no duplicate signal options,
task-conversation facades or admission gates.

Test: it compiles; fixtures cover entries with no data, no model, every individual facet and the
built-in facet combinations.

## 2. Memory storage

`Storage` and `MemoryStorage`: `commit` numbering from `lastSeq`, point reads, fork-aware
`scanEntries` / `scanTasks` / `scanConversations` with cursors, target-capped `newestHead` over stored
numeric boundaries, stored entry data/model/edits, value versions and list elements read at a
position, `ownedFrom`, the set of entry kind strings written and session-wide live-task scans.
Use existing batched `getTasks` for named owners; no header/projection APIs or inbox-specific queries.

Tests: every row of the §7.2 query table against hand-built batches; ids are `lastSeq + 1 + i`; a
head is found without a kind; entry reads/scans/head lookup return full entries after indexed
selection; live-task scans skip terminal rows (named owner reads may fetch them); `remove` and
`clear` hide by position.

## 3. The line and `Tx`

`commit(plan, call)` on a serialized line: buffered writes, ids final at call time, rewindable
conversation value/list writes after an entry throw, a throwing plan discards everything, publish
after persist; apply the entire batch to live indexes before scheduling or testing idle. Driver
callbacks, signals and task methods dispatch outside the line. Session and sticky conversation state, task
writes and conversation writes may appear anywhere. `task` / `patch` / `settle` materialize the role
from the kind's status map. `value` / `list` / `entry` / `task` / `patch` / `settle` build the batch
of §7.3.

Tests: concurrent commits serialize; a rejected commit consumes no ids; each builder verb produces
the expected write; reads inside a plan see committed state only; session and sticky conversation
writes may follow and reference a new entry; rewindable value set/delete and list
append/remove/clear after an entry each reject; exact invocation-token checks run on the line;
post-mark main/scratch mutation rejects before builder; only an owned task's current invocation may
patch its state/status or settle it (host abort marks remain allowed); caller cancellation never
abandons admitted persistence; Tx/ScratchTx reads are asynchronous and builders may await them
without releasing the line; writes remain synchronous. No external effects or nested line entry in builders.

## 4. Entry kinds and context

`EntryKind` as `kind` plus `is`, the registry and typed append helpers for the built-in kinds
(`user`, `assistant`, `tool_result`, `system`, `notice`, `summary`, `handoff`, `reset`). Writers
materialize optional model messages and stored controls; context = newest stored head prepended to
the fork-aware range from its numeric boundary, older heads excluded, stored edits folded in
transcript order, stored model arrays concatenated, then pi-ai tool results ordered by call index.
The `system` data fold selects the newest baseline plus later deltas and places their stored messages
in the baseline slot / `SystemMessage`s. There is no read-time entry-kind behavior.

Tests: data-only and model-only entries; summary keeps the tail; handoff/reset normalize `"self"`;
repeated compaction subsumes; a stored head below the previous visible boundary is rejected; edits
omit/replace targets and persist across turns; context is identical with its plugin kind unregistered;
the fold on a context that kept an old delta; tool-result order.

## 5. Forks and historical reads

`createConversation` with `parent`, the shared prefix in fork-aware `scanEntries`, capped-source
lookup for values and lists, arbitrary transcript-entry fork points.

Tests: a fork sees the head, edits and values in force at its entry; heads/results the source adds
later are invisible; deep fork chains; successful incomplete tool exchanges project with missing
results but inherit no tasks; state committed after the entry (a model change) is not in the fork.

## 6. Task kinds and the driver

`TaskKind` with `(task, runtime, call)` methods, registry and `TaskRuntime`; one Call-final convention
for operations, existing Context-aware env/provider/hook boundaries. Driver decisions, attachments,
waiters, invocation completion and lifecycle run on the commit line. Only effects/callbacks dispatch
outside it. Seed live tasks once; committed batches update live, reverse-dependency and conversation
indexes. Resolve ownership upward only for live/owned work; evict unused ancestry. Stable attachments
are distinct from temporary waiters. No Wake, polling loop, worker pool, poison graph, gate or parked role.

One invocation per task ID, concurrent across IDs; reserve before dispatch and release only after
actual return, even if already terminal. Durable abort revokes execute/recover main and scratch writes,
then signals outside line; fresh abort invocation alone writes cancellation outcomes. Status epochs
count actual committed transitions, including same-start/end cycles. Task-contract faults fail-stop:
reject waiters, stop admission, signal/join and close; preserve durable recovery state.

Tests: one open scan, no full scan per completion; 100,000 historical children with two live tasks;
whole-batch settle/successor publication; exact epoch rules; owned-task exclusive mutation; one
invocation per ID; blocked calls do not block others; abort bypasses dependencies and never overlaps
execute; repeated mark spares running abort; abort-handler failure; cooperative signal window;
known direct/dependency self-waits, including background caller and new cycle-creating admission;
already-aborted waiter registration and every cancellation/idle race; repeated drive uses one
attachment; foreground idle while attached background work continues; reopen recovers marked work.

## 7. Scratch

Scratch batches, one task per batch, `ScratchTx`, retire on settle, sidecar-independent (memory).

Tests: a crash before settle keeps scratch; settle deletes it; writes after mark/settle/retired token
reject; new attempts clear scratch; persisted assistant frames use the pi-ai compact frame encoder,
not raw cumulative provider events; a rejected stream-frame write cancels and joins the producer
before invocation completion (iterator exit is insufficient); harness progress bridges own every promise, suppress expected
late cancellation only, report persistence errors, and drain before invocation completion. Raw task
scratch calls must be awaited/caught; no successful silent no-op.

## 8. Harness shell and handles

`Harness.open` (built-in registries, `kinds` and `replace` options, kinds-set check, `inspect`,
`drive`, `close`, `shutdown`), `ConversationHandle` (`commit`, `value` / `list`, `config` /
`settings`, `fork` with `abort`, `abort`, `hooks.on` scoped with `subtree`), `acceptance(requestId)`,
`result(inputId, call)`, `abortTask`, `conversations` with `parent` / independent filtering. Call is
required on every async public/runtime operation, including reads and lifecycle; no raw host-lifecycle
Harness exposed to tasks. No agent behaviour yet.

Tests: open on empty vs existing storage; an unregistered entry kind is reported without scanning
entries and its stored model/head/edits still derive context; an unknown live task kind rejects;
replace by name keeps `h.kinds.<name>` consistent; `settings` round-trips; scoped hooks run after
harness-wide ones, innermost last; derived Call preserves typed private identity and telemetry;
stale/foreign task token rejects; close stops admission in one nonpersistent line job, joins outside;
shutdown atomically marks live tasks only, then permits abort cleanup; queued items/results remain
unchanged, including idle inbox-only conversations; crash/reopen child cleanup marks tasks only and
preserves queues; repeated close/shutdown share completion; close interrupt rejects shutdown;
lifecycle calls with task identity reject; delete rejects outstanding terminal invocations.

## 9. Generation kind

One stable generation task carries `inputs: Id[]` and cycles pending → streaming → retry_wait /
deferred → streaming until done / failed / aborted on a faux provider; explicit terminal results for
its whole input group; config capture (model, thinking, selected tools, profile, budget);
`system_instructions` with
sections merged across handlers and the diff writing `system` data plus its materialized model
message; `before_request`,
`after_response`, `on_yield`; retry sleeps in execute; recover from frames; usage recorded per
attempt.

Tests: the six system-entry traces from the guide (tool added, removed, host section changed, MCP
schema changed, plugin section on and off, `addTools`); fresh baseline after a head; a fork diffs
against its own config; a restart emits only the changed section; in-band provider abort without a durable mark has a
kind-level outcome, but post-mark execute settlement rejects and fresh abort writes optional partial,
cancelled input results and known usage atomically; no mark branch in normal settlement; missing
post-cutoff usage is unknown; crash while streaming publishes the partial; retry budget exhausted
→ failed with no successor.

## 10. Tools, post_tools, exchanges

The tool kind with the sink (`ToolOutput`, `ToolOutputState`, limits enforced by the sink, `diag`,
`delegate`, `handoff`, `addTools`, `terminate`), tool-result entries with structured data plus their
materialized model message, `before_tool` (fail-closed) and `after_tool`,
replay policy on recover; post_tools with `after`, carried input groups, terminate / handoff / steer /
next generation; `accept` idle vs busy; `prompt`, `result` and request acceptance lookup.

Tests: parallel tools completing in either order; sequential via `after`; an aborted generation
creates no tool tasks/results while an aborted existing tool writes its own error result;
`new_context` resets after the exchange, never inside it; `addTools` writes the rewindable loadout
before any handoff/user entry in the settlement commit and appears in the next turn's `toolsAdded`;
a throwing tool → error result, `terminate` still honoured; truncation diag from the sink; a lost
accept response is recovered through `acceptance(requestId)`; a duplicate create reports the first
receipt; results remain point-readable after further turns.

## 11. Inbox

`pi.inbox` as a conversation sticky list whose element id is `inputId` and whose value holds mode,
complete entry draft and optional request id; append/remove/clear watch operations; queued/running
and terminal result values; the three placement points; carried generation/post_tools input groups;
`cancelQueued`; abort draining steer and followUp while preserving write and nextRun.

Tests: idle append/remove is one commit and emits no inbox event; busy image payload is one append
operation; the modes table; steer joins at post_tools but starts a group after a final answer;
followUp starts the next group; nextRun waits for idle accept; writes are placed without joining;
several inputs resolve to one answer; cancel/land and abort/group-transfer in both orders; queued and
placed crash recovery; cancelled unplaced payload is unavailable; input queued during collapse lands.

## 12. Collapse

Manual, threshold and overflow; `before_collapse`; publish only if no newer head; the overflow
chain (generation settles → collapse → new generation carrying the attempt).

Tests: a summary lands under a running generation and later entries stay in context; a competing
head makes a summary stale while intervening edits do not; overflow retries once and no live task
ever waits on the collapse; threshold before a turn; abort of a running collapse leaves appends
flowing.

## 13. Subagents

The `subagent` tool (`run`, `spawn`, `send`, `status`, `wait`, `stop`), ownership links, foreground
reach through live owners, `run`'s recover driving the child again, `spawn` initialization of config,
explicit child input results.

Tests: restart in the middle of `run`; conversation abort reaches a `run` child and spares a `spawn`
child; abortTask marks only owner and fresh cleanup cancels its child; drive waiter observes Call;
cleanup tolerates already-terminal child/job; `stop`; nested children; child's own baseline.

## 14. Jobs and the budget

`jobKind` on `ExecutionEnv.exec` with output into its scratch, `waitForTask` / `jobOutput`, `bash`
delegating first and waiting with the budget, `notify` and the `notice` entry, the `job` tool,
schedules.

Tests: job creation atomically stores job id and cancellation policy on the tool; fresh tool abort
uses those durable references, not execute locals or catch writes; budget expiry settles delegated
and job continues; delegation requests notification in separate sticky state, not a patch to an owned
job; both notification/completion orders publish once for exited, lost and killed; schedule cycles one
stable id; foreground drive
ignores background recurrence; recover → lost or safe rerun; abort kills non-detached job.

Remaining integration design: arbitrary-promise budget adoption must explicitly transfer effect and
sink ownership before the tool invocation releases. A raced, abandoned promise is not permitted.
Preserve the capability (crash outcome lost), but implement job-first execution until transfer is settled.

## 15. Previews

`runtime.preview` as a Chord tracker per task; the generation applies stream events to a partial
message, the tool's preview is its sink state, the job's the same; `preview.init` on attach and
reopen; flush after each scratch commit.

Tests: one token → one `a` op and nothing else; no `r` mid-stream; init after reopen yields a base
equal to the live preview; a sliding tool tail → `t` + `a`.

## 16. Watch

`ConversationView`, `ConversationEvent`, the exported kind-free `applyEvent`, `WatchHandle`
(capture on the line, bounded buffering, `resnapshot`, `unsubscribe`), the session watch with
`report` and `usage`, the usage ledger (`pi.usage` + totals).

Tests: the fold is correct (view after N events equals a fresh capture, randomized); head and edit
entries update derived context; inbox append/remove/clear operations update the view and same-commit
append/remove cancels; all events of one commit delivered together; a thin-client reducer over a
recorded stream with no kinds loaded;
lag → fault → resnapshot; `resnapshot` from inside the listener; usage totals equal the ledger
fold, failed and aborted attempts included.

## 17. JSONL storage

Append-only batches, replay on open, torn tail discarded, malformed line fails open, entry
`data`/`model`/`head`/`edits` and the kind-string set from replay. Whole value sets and intrinsic list
operations in main and scratch files; no Chord storage codec. Replay main first, then surviving live
scratch; per-file sequence gaps are valid. Recover lastSeq from maximum complete surviving batch
endpoint, including clear/remove. Retired scratch is ignored; its later settlement covers its ids.
Physically remove torn suffixes before appending; malformed complete replayed batches fail.

Tests: conformance against memory; full replacement values on disk; compact incremental frames/output
operations avoid repeated growing snapshots; main=100/live scratch=150 reopens at 150; settle=151
with failed unlink ignores retired scratch, even malformed; clear/remove high-water; torn main and
live scratch tails; nonoverlapping ranges; accepted payload plus placement has two JSONL copies,
including idle acceptance. Backend memory and disk growth claims match whole-value behavior.

## 18. SQLite storage

Tables and indexes of §7.5, nullable entry JSON columns for data/model/edits and an indexed integer
head boundary, scratch rows deleted in the settle transaction, storage version and `migrate`.

Tests: conformance three ways; removed sticky inbox elements may be physically discarded while
input results remain point-readable; a cold reopen decodes live tasks and only named required owner
records, including terminal owners; no retained terminal payload cache; a version mismatch rejects.

## 19. Race matrix and telemetry

The §10.2 matrix in both orders with faux clocks, fake processes and storage barriers; spans per
task call and per commit.

Tests: the matrix; span tree for one turn with a tool and retry; nested Call preserves active telemetry
parent and private invocation identity; drive-caller cancellation does not become the task signal;
providers/env interpret signals, hooks propagate cancellation rather than swallowing it; no callback
runs on the line; stale RPC-bound invocation rejected. Metadata transport never carries task authority.

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

- `@earendil-works/chord` Context types and `@earendil-works/chord/context` helpers (1, 6, 8, 19)
- `@earendil-works/chord/delta` (15, 16: preview/watch only; not storage)
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
