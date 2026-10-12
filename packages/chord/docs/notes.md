# Chord implementation notes (phase 1a)

Running log of decisions the spec (v7) and guide did not settle, places where they contradict each other or could not
be implemented as written, and proposed simplifications. Code: `src`, tests: `test`.

## Contradictions and gaps found

1. **Placeholder used inside the factory.** The v7 example wired `self.listen("changes", watch.events, ...)` where
   `watch` is a resource placeholder whose value only exists after activation. Resolved by the revised API:
   `listener(source, select, fn)` resolves `select(resource.value)` when the record goes live.
2. **Registry syntax.** Section 8 still shows `self.register(Routes, "GET /download", handler)`; section 3 and the
   guide use `self.register(Routes, { key: value })`. Implemented the object form.
3. **New records during prepare cannot always use old code.**
   - Problem: "New records activated during prepare use the current epoch (old code)" fails for a type the same reload
     adds. Example: reload `[clock, greeter]` where new greeter code does `self.get(Clock)`; Clock has no old code, so
     the get failed with an unknown type.
   - Solution: the reload pre-allocates the next epoch ("pending"). Types it adds are served from it. Their records
     install behavior only for the pending epoch and are force-disposed if the reload aborts.
4. **Gate pause deadlock.**
   - Problem: the gate must stop new activations of changed types, otherwise the candidate set is never final. In
     phase 1a they were paused. But the second prepare pass awaits in-flight activations: if one of them declared a
     hold on a new record of a paused type, it waited for the commit, and the commit waited for it.
   - Resolved (accepted proposal): from the gate until commit or abort, creating a new record of a changed type fails
     with `upgrade_conflict` (retryable, reason `gate`). Nothing is paused, so nothing can deadlock. The second pass
     only finishes activations already in flight, bounded by the gate deadline.
5. **`upgrade_conflict` must outlive the gate.**
   - Problem: the spec rejects old roots only "from the admission cut". After commit, the record still has a
     behavior for the previous epoch E. A root started in E before the reload would then run old code over migrated
     cells.
   - Solution: gated records get `minEpoch = E'`. Calls and writes carrying an older epoch are rejected
     `upgrade_conflict` permanently. This also covers replaced exclusive resources: the old code would use a closed
     resource.
   - Resolved further (accepted): a gated record drops its previous-epoch behavior at commit, and what only that
   behavior declared is released then, not at retirement.
6. **Two-version rule vs records created after a commit.** A record of a changed type created after the commit has
   only new code. A previous-epoch root calling it gets `superseded`, although the host retains that epoch. The spec
   only names epochs the host does not have. Records of unchanged types share one behavior across epochs, so the issue
   only affects changed types.
7. **Tasks during the gate.**
   - Problem: old tasks keep running during the gate. They can write old-shaped values while `migrate` reads the cells.
     They are also long-lived, so counting them as roots would block the gate until its deadline.
   - Solution: tasks of gated records are aborted at the admission cut. They restart with new code at commit, or with
     the old code on abort. Task contexts are code holders: handle calls made with them start fresh roots, and cell
     writes with them skip gate admission (the abort covers them).
8. **Listener events during the gate.**
   - Problem: each event starts a fresh root. That root has not touched the record, so a write from it would fail with
     `upgrade_conflict` and the event would be lost.
   - Solution: events for gated records are queued. They are replayed through the new listener at commit, or the old
     one at abort.
9. **"Grandfathered activation lease" is undefined.** Implemented as: roots that called into the record and are still
   running at the cut. Their re-entry is admitted, and the gate waits until they end.
10. **Remote state validation.** The spec validates state values "at the provider boundary", but per-write
    validation is dev-only (revised spec). In-host consumers of remote state therefore get unvalidated values outside
    dev mode. Phase 1b must decide whether links validate the snapshot when a hold is made.
11. **Local contracts.** "API is a TS type, may expose anything" conflicts with late-bound handles. A loading handle
    must know whether `h.x` is a method (return a waiting caller), state (return a readable), or opaque. So members
    are listed in the contract. Members missing from the contract are found only once the handle is live, by
    inspecting the behavior.
12. **Input defaults and TypeScript.** Canonical identity omits fields equal to their default. TypeBox's `Static`
    still makes a defaulted field required, so callers must use `Type.Optional(Type.X({ default }))` to omit it.
    TypeBox has no separate input type for defaults.
13. **Adding a variant.** "Additive" per the covers rule, but an old consumer can receive a `kind` it does not know.
    Implemented: provider variants ⊇ consumer variants. Members the consumer's contract does not list are hidden
    (`not_in_variant` or `undefined`).
14. **Principals.** "In-host code acts as host" conflicts with roots stamped with a link principal. Implemented: a root
    ctx at ingress acts as its principal (`host.root(fn, { principal })`). Contexts inside objects (method calls,
    tasks, listener roots) act as `host`. `GetOptions.principal` is kept as a trusted in-host override (tests, links).
15. **Removed types.** Unspecified. Their records are force-disposed at commit instead of being kept for previous-epoch
    roots.
16. **Retirement deadline.** "The next reload first waits for retirement with a deadline" does not say what happens
    when the deadline is missed. Implemented: forced retirement, so those roots get `superseded` on their next call.

## Decisions (not settled by spec/guide)

- **Errors.** The guide's codes; a `reason` field carries the detail, for example `invalid/args`,
  `invalid/cycle`, `invalid/duplicate`, `invalid/read_only`, `invalid/not_eager`, `invalid/registry_conflict`, or
  `unavailable/unknown_type`. A ChordError thrown by a factory or a dependency keeps its code through every
  dependent. Other errors become `unavailable`, with the original as `cause`.
- **Reload errors** (accepted): there is no `reload_aborted` code. A failed reload throws the cause's code and
  reason with the message `reload aborted: …` (the cause is attached). Reasons of its own are `aborted/gate_deadline`
  (with the blocking roots in `details`), `aborted/deadline`, `aborted/vote_deadline` and
  `unavailable/reload_running`. Across hosts, the message names the host that failed.
- **Remote calls are validated at handle dispatch, in-host too.** A direct binding is checked against the provider's
  schema, and a binding through an adapter against the consumer's.
- **Forgotten contract bumps are checked twice.** At reload, the new provider's description must cover the old
  provider's when the version is unchanged, in addition to the check against live consumers and facets' `uses`.
- **Cells.**
  - The tracker sees a `{ v }` box, so primitive cells work; ops are re-rooted, and `s/a/t/d` on the value itself
    become `r`.
  - A value returned from `change` replaces the value. It is always validated, which catches
    `(d) => d.push(x)` returning a length.
  - `replace` transfers ownership; values are not copied.
- **Readables.** `subscribe(fn)` delivers values, starting immediately with the current one. `events(fn)` delivers the
  delta stream: `snap`, then `ops`, or `reset`.
- **Handle state members.**
  - They are stable readables: `undefined` while loading or when the member is not in the variant.
  - When the member moves to a different source (live, reload, variant change), subscribers get a `reset`.
  - A subscription made while loading sees `snap(undefined)`, then a `reset` with the hydrated value.
  - Upstream is subscribed only while someone listens.
- **Derivations.**
  - Sources are record cells or derivations, recomputed atomically with the write: a dev-mode validation failure
    rejects the write. Handle state members can be sources too, recomputed when they publish.
  - New derivation functions are dry-run at prepare, and against migrated values at the gate. A throwing function
    aborts the reload instead of breaking the commit.
- **Listeners.** A listener on a readable fires with the current value when it binds. Delivery is allowed while the
  record is still finishing activation.
- **Holds.** A hold's identity is its address. A second `self.get` of the same address in one run returns the same
  handle; with a different contract token it fails with `invalid/duplicate`. A changed token on reload makes a new
  hold.
- **Resources.**
  - New exclusive resources also open at the gate, not only replaced ones. Non-exclusive resources that depend on a
    gate-opened resource open at the gate too.
  - "Records depending on those resources" is read as dependents within the same record.
- **Schema change detection** compares canonical JSON, which is structural: reordering `anyOf` branches counts as a
  change.
- **Disposal and re-creation.** A new record for an address that is still being disposed waits for that disposal
  (exclusive resources such as ports). Abandonment is a disposal during activation: open signals abort, and resources
  that opened anyway are closed.
- **Calls without ctx.** A handle call without ctx, or with a task ctx, starts a fresh root in the current epoch.
  Calling a handle inside a factory throws `not_ready` synchronously.
- **Variants** change only when the factory reruns (reload). There is no dynamic `kind`.
- **Fingerprints** use a non-cryptographic 64-bit hash: it is synchronous and browser-safe, and contracts are trusted.
- **Loader.**
  - Injected with `createHost({ loader: nodeLoader })`, so `index.ts` stays browser-safe because `node:module` is not
    imported.
  - Facets are named by module URL.
  - A `module.registerHooks` resolve hook carries the cache-busting query to relative imports inside the facet
    module's directory, so a plugin split into several files reloads completely. Code outside that directory, such
    as Chord itself, stays a single instance.
  - Old copies leak (`TODO(loader)`).
- **TypeScript.** `serve` is overloaded on the contract definition (`RemoteContract<D>` / `LocalContract<D>`). With a
  plain `C extends AnyContract` parameter, literal `kind`s in factory returns widen to `string`.

## Proposed simplifications (phase 1a)

Accepted and implemented: 1 (reject instead of pause), 2 (drop the previous behavior of gated records at commit),
4 (no gating across records: only the records whose state version or exclusive resources change are gated),
5 (reload errors keep the cause's code). Open: 3, a single rule that any record whose code changed rejects
previous-epoch calls unless the change was compatible.

The spec now uses the object form of `register` in section 8. Sections 1 and 2 say that local contracts must list
their members.

## Phase 1b: links, relay, cross-host reload, host manager

Files: `wire.ts` (frames), `link.ts` (memory pair, Node IPC, WebSocket), `connection.ts` (one link end on a host:
consumer, provider, relay), `remote.ts` (remote handles and readables), `cluster.ts` (coordinated reload),
`websocket.ts` (accepting a WebSocket server), `manager.ts` (host manager; Node-only, not exported from `index.ts`).

### Contradictions and gaps found

17. **Retirement across hosts.**
    - Problem: "retire when no roots of `previous` remain" is per host, but roots span hosts. Example: a server root
      R (epoch 1) calls the worker, which returns, and R waits on the server. Commit to epoch 2. The worker has no
      local epoch-1 roots and retires epoch 1 at once. R's next call to the worker gets `superseded`, though the
      server still runs epoch 1.
    - Solution: a child retires only after its parent retired that epoch (`retire` frame, parent → child) and its
      own roots of it have ended. The server decides from its own roots.
    - Still open: roots started on a worker, calling up to a server that has already retired, get `superseded`
      (retryable).
18. **Grandfathered roots across hosts.**
    - Problem: the gate grandfathers "roots that touched the record and are still running". On the worker, a server
      root is visible only while one of its calls runs there. In the example above, the worker forgot R's lease when
      the call returned. The gate then did not wait for R, and R's re-entry got `upgrade_conflict` instead of being
      admitted.
    - Solution: a `root_end` frame. Every host remembers on which links a root's calls went out; when the root ends
      (at its origin, or on receiving `root_end`), it sends `root_end` on those links. A root that came over a link
      keeps its leases until then, or until that link closes. Leases outlive calls, so a root whose origin never
      ends it (a bug) blocks gates until their deadline.
19. **`get` frame.** The spec lists `get`/`hold`/`release`. One acquisition frame is enough: `hold` creates the remote
    handle and returns `shape` or `gone`. There is no separate `get`.
20. **State subscriptions** need `sub`/`unsub` frames, which the spec does not list. Remote state members hydrate only
    while subscribed: `h.view.value` is `undefined` until someone subscribes. The guide's "undefined until hydrated"
    holds, but hydration requires a subscriber. Auto-subscribing on `.value` would leak subscriptions.
21. **Commits must not throw.**
    - Problem: committing on the worker pushed a shape to a browser hold whose contract no longer bound. Building the
      shape re-bound the hold, threw `contract_mismatch`, and the commit stopped halfway.
    - Solution: shape and view access never throw (bind failures are reported), and browser holds are checked
      first. Lesson: everything a commit does to other parties (shape pushes, resets, registry notifications) must
      be failure-isolated.
22. **Epoch ids are global.** The server issues them. (Superseded by the Astra fixes below, #5.) Children no longer
    adopt or renumber epochs. A child that connects behind the server is fenced and reconciled.
23. **"Server persists the decision"** (section 7.5) is not implemented: no storage exists in Chord. A server crash
    between its own commit and a child's commit leaves that child on the old epoch until it reconnects; same remedy
    as 22.
24. **Only one level of reload participants.** The coordinator's direct child hosts take part. A child does not
    forward `prepare` to its own children (the server, workers, browsers topology has none).
25. **Browser holds in reloads.**
    - Problem: a browser hold whose contract no longer binds would refuse the worker's reload, through the hold the
      server relays on the browser's behalf.
    - Solution: the relay marks such holds `client: true`. Providers skip them in the reload's contract check and,
      at commit, make them `gone` with `upgrade_required`. A browser holding an outdated token on a new `hold` also
      gets `upgrade_required` instead of `contract_mismatch`.
26. **Links that drop.**
    - An upstream link may be replaced (`host.connect`): remote handles go back to `loading`, re-hold over the new
      link, and readables resubscribe. Subscribers get a reset.
    - A downstream host that disconnects makes the remote handles held through it `gone` (`unavailable`).
    - The provider releases everything held through a closed link at once. The re-held record is therefore a new
      one: the counter in the reconnect test restarts at 0. Keeping holds for a reconnect window would need session
      ids on links; not done.
    - Calls in flight when a link drops reject `unavailable`; it is unknown whether they ran.
27. **Refused clients.** The WebSocket adapter closes unauthenticated sockets. On the client this looks like a
    dropped upstream: calls wait for a reconnect until their ctx is aborted. A refusal reason in `bye` could tell
    clients to stop retrying.

### Decisions

- **Principals across links.**
  - A downstream link acts as the principal it was accepted with, whatever a frame says.
  - Frames from the parent may forward a principal (relay). Without one, they act as `{ host: <parent name> }`.
  - Clients never carry roots or epochs: the server starts a root for each of their calls.
- **Relay authorization.** Relaying needs a matching `route`, because the route holds `authorize`.
  `authorize(principal, hostName)` runs before `resolve` and again after. A host's own gets may use a directly
  connected child by name without a route.
- **Relay mechanics.**
  - The relay works on frames: it rewrites ids and passes delta-encoded state frames through untouched, keeping one
    encoder/decoder pair per origin subscription.
  - Calls and subscriptions sent before the route resolves are queued.
  - A relayed call runs inside a server root (it joins the caller's root, or starts one for a client), so it counts
    for the server's epoch bookkeeping.
- **Snapshot validation.** A provider validates each snapshot and reset of a remote state member against its
  contract schema, once per (re)subscription. Ops are validated only in dev mode. This settles 10 for links.
- **`invalidatePrincipal(match)`.**
  - `match` is a predicate (this host only) or a pattern object, where listed fields must be equal. Patterns
    propagate to child hosts in an `invalidate` frame.
  - Matching links are re-stamped (`accept({ restamp })`) or closed. Re-stamping keeps a browser connected under its
    new grant revision; its old relayed records are force-disposed, so its handles become `gone`.
- **Liveness.** Each connection pings every `pingInterval` and closes the link after `pingTimeout` without any frame.
  Closing releases everything held through the link.
- **Contract tokens over links.** A hold sends the consumer's description. The provider rebuilds a token from it
  (`contractFromDescription`) and binds it with the covers rule.
- **Cross-host reload.**
  - `host.reload(plugins, { remote: { "session:": [modules] } })` on a server with child hosts coordinates
    automatically. Every connected child host prepares, even with no modules, so epoch ids stay in step.
  - Votes have a deadline. Any failure aborts every host, and the error names the host.
  - A child cannot reload on its own (`unavailable/not_coordinator`).
- **Host manager.**
  - `forkDriver({ entry, execArgv, env, init, lock })` forks a detached child, so the child leads a process group
    and the tree can be killed.
  - The lock file holds the child's pid and is taken over when that pid is dead.
  - Control messages share the IPC channel with frames: `{ chord2control }` next to `{ chord2 }` (the wire keys keep their chord2 names).
  - `stop` sends `shutdown`, waits `grace`, then kills the process group. Start, stop and replace are serialized,
    and replace waits for the exit before spawning.
  - Liveness (`activeCalls`, `viewers`, `durableTasks`) is reported by the child with `childControl().report`. The
    manager derives `booting` and `idleFor` and stops the child when `keepAlive(liveness)` returns false.
- **Chord stays dependency-free.** WebSocket support is structural: browser WebSocket, Node's global WebSocket and
  `ws` sockets all fit `WebSocketLike`, and `acceptWebSockets` takes any server with `on("connection")`. Only the
  tests import `ws`.

### Left open

- The Durable registry bridge (`RegistryReader` per epoch) is not implemented.
- Reconnect windows (session ids), restarting a stale child after a missed reload (22, 23), multi-level reload
  participants (24), and a refusal reason for clients (27).

## Review fixes (Sol, phase 1a findings #1-#11)

Regression tests: `test/review.test.ts` (one or more per finding, plus ctx races),
`state.test.ts` (#3), `cluster.test.ts` (abort while a worker prepares). Each was checked to fail with its fix
reverted. #5 has two layers (no disposal while invocations run; disposal awaits invocations), and its test fails once
the disposal-side layer is reverted.

1. **Partial epochs.**
   - Problem: the commit published the epoch, then ran fallible installs. Example: three records; the second's new
     listener source throws on subscribe. The reload rejected, but the epoch had advanced and the records mixed old
     and new code.
   - Fix: everything fallible runs at the end of prepare.
     - Listener subscriptions are staged: subscribed with buffered delivery, activated or discarded later.
     - A listener whose source did not change keeps its subscription; only its function is swapped (by name), so
       events are neither duplicated nor lost.
     - Migrated values and derivations are dry-run and validated against the prospective schemas.
   - The commit then only installs, inside `holdPublications`: no observer runs until the whole epoch is in place.
   - If an install still throws, the host fails terminally: `host.failed` is set and every admission fails
     `unavailable/host_failed`. The host manager should restart such a host. Children that already voted cannot be
     rolled back after the server's commit, so terminal failure is the only safe answer there too.
2. **Obsolete schemas during migration.**
   - Problem: `cell.reset()` validated the migrated value (dev mode) against the remote member schemas of the old
     behavior, so a `{n}` → `{total}` migration failed during the commit.
   - Fix: the dry run validates every migrated value and derivation against the cell's new schema and the new
     behavior's member schemas. The commit installs the schemas (`refreshSchemas`), then the values, without
     re-validating.
3. **Re-entrant publication.**
   - Problem: subscribers were notified synchronously, before derived values were installed. Example: a re-entrant
     writer reacting to `n = 1` by writing `n = 2`; a second subscriber saw `[0, 2, 1]` and `n * 2` ended at 2.
   - Fix: one process-wide FIFO queue (`publish.ts`). A publication adopts the cell and every derived revision, then
     enqueues notifications, each captured with the subscribers of that moment. Shape pushes, registry
     notifications, handle readables and listener invocations go through the same queue.
   - Behavior change: a listener invocation from inside another delivery now runs after the current delivery instead
     of nested in it. Outside a delivery it still runs synchronously.
4. **Listener roots and leases.**
   - Problem: listener roots never took a lease on their record, so a migration could commit while an async listener
     was still running; the old callback then read migrated cells.
   - Fix: a listener invocation takes a lease on its record (the gate grandfathers it and waits). It runs with a
     child ctx cancelled by forced disposal, and counts as an invocation.
5. **Resources closed under running methods.**
   - Fix: methods and listener invocations keep the record alive until they settle. A record with invocations is not
     disposed (`#maybeIdle`). Disposal (released or forced) stops the runtime, awaits invocations, then closes
     resources. Forced disposal first makes handles `gone` (no new calls) and cancels running invocations.
6. **Activation finalization outside the failure path.**
   - Problem: finalization ran in the success handler of `.then(success, failure)`. A registry conflict between
     concurrent eager records rejected `ready` but left the loser live with its resource open.
   - Fix: finalization runs inside the activation transaction: registry check, behavior install, runtime start and
     live status in one synchronous step. Any failure aborts the record's invocations and stops its runtime,
     unregisters, awaits invocations and unwinds.
   - A release during listener startup aborts the activation (no resurrection).
7. **Prepare touching retained resources.**
   - Fix: `self.resources` returns facades. `.value` throws `not_ready` while any factory runs, even if the resource
     is open.
   - Records served only by a reload's pending epoch (types the reload adds) defer listeners, tasks and registrations
     to the commit (`deferredRuntime`). Their listeners are staged with the rest.
8. **Same-batch breaking change.**
   - Fix: holds declared by a prepare rerun bind and normalize against the pending service (`candidate`), so a
     breaking provider change and its updated consumer reload together.
9. **Exclusive-resource rollback.**
   - Fix: a replaced exclusive resource is recorded for the rollback before its close runs. The rollback reopens it,
     and a resource that cannot be reopened is marked `unavailable`: its `.value` throws `unavailable` instead of
     looking merely not open.
10. **Retirement order.** Fix: retirement closes dropped resources (reverse open order) before releasing dropped
    holds, the same order as disposal.
11. **`covers` false positives.**
    - Problem 1: `fits` ignored keywords it did not model.
      - Fix: a provider schema with any validation keyword outside the modelled set only fits an identical schema.
        Unmodelled keywords include `not`, `allOf`, `contains`, `$ref` and `additionalProperties` given as a schema.
      - `patternProperties` and consumer `additionalProperties` schemas are now checked against provider properties.
    - Problem 2: the additive rule ("extra fields fine") is only sound if a consumer never sends a field its own
      schema does not know.
      - Fix: arguments are stripped (`Value.Clean`) with the consumer's schema, then with the provider's, before
        validation. Remote handles strip before sending.
    - Counterexample tests check each case with `Value.Check`: a value valid under the consumer's schema and invalid
      under the provider's must make `fits` false.

### Races fixed

- **Aborted task contexts.** Calls made with a task ctx after the task was aborted started fresh roots without its
  signal. Now the call is refused (`aborted`), and the fresh root carries the task's signal.
- **Expired and foreign contexts.**
  - A ctx whose call or root already settled is refused (`aborted/expired`).
  - A ctx from another host is refused (`invalid/foreign_ctx`).
  - Both apply to calls and cell writes. `ctx.get` after settlement now fails `aborted/expired` (was `released`).
- **Delayed opens.** A resource open that completes after its signal aborted (rollback, abandonment) closes its
  value at once and is not recorded as open.
- **Abort while a worker is still preparing.** The child used to ignore an `abort` that arrived before it voted,
  keeping its reload slot forever. Now an abort during loading or prepare rolls the prepare back, frees the slot and
  sends no vote. An abort that arrives before the prepare even started is remembered.
- **Observers during a commit.** An observer of record A that calls record B during a commit now always sees B's new
  code.

### Still open

- The publication queue is process-wide and synchronous. A slow observer delays every later notification in the
  process; per-host queues would isolate hosts in one process (tests, in-process workers).
- Terminal host failure has no automatic restart inside Chord. The host manager's keepAlive or `fatal` path must
  pick it up.

## Review fixes (Astra, phase 1b findings #1-#13)

Regression tests: `test/links-review.test.ts` (one or more per finding, plus two browsers sharing one worker
connection), `manager.test.ts` (#8, #12, #13), `websocket.test.ts` (#1). Each link test was checked to fail with its
fix reverted. #2's generation check is backed by `revoke()` closing pending relays at once, so its test fails only
when that is reverted.

1. **Self-declared peers.**
   - Problem: a peer's `hello` decided its kind and name, and with them root honoring, reload participation and
     routing identity.
   - Fix: the acceptor decides. `accept(link, { principal, kind, name })`: `kind` defaults to `client`, and a `host`
     needs its `name`. A hello that disagrees with the configuration closes the link.
   - Only configured host links are addressable by name, carry roots and may vote. Control frames (`prepare`,
     `commit`, `abort`, `retire`, `invalidate`) are accepted only from the parent, and `vote` only from a host child.
     Anything else closes the link.
   - `acceptWebSockets` always accepts as `client`.
   - `root_end` is honored only from a link the root actually came over (foreign roots record a set of links), and a
     root ends when no such link remains.
2. **Revocation racing route resolution.**
   - Problem: revoking or re-stamping a principal while its relay was still resolving the route did not stop it; the
     relay then forwarded the old principal and created a worker record for it.
   - Fix: each origin link has an authorization generation. Revoking or re-stamping bumps it and closes the link's
     relays at once, including those still resolving.
   - `HostImpl.relay` re-checks the generation after every await of authorize/resolve/sync and right before
     forwarding.
3. **Child prepare cancellation.**
   - Problem: the child registered the reload only after its prepare finished, so an abort or disconnect arriving
     earlier was forgotten and the child stayed prepared, gated and reloading forever.
   - Fix: `ChildReloads` registers the operation (`loading` → `preparing` → `prepared`, plus `cancelled`) when the
     `prepare` frame arrives, before any await. An abort or a lost parent marks it cancelled and rolls back what
     exists. The operation unwinds when its pending work settles, without a vote, freeing the reload slot.
   - A second `prepare` while one runs gets a refusing vote.
4. **FIFO commit ordering.**
   - Problem: the server's commit started tasks and ran listener and registry callbacks before the child commit
     frames were sent, so new-epoch calls could reach a child before its commit (`superseded`).
   - Fix: `Reload.commit(beforeStart)` installs everything, then calls `beforeStart`, where the coordinator queues
     the commit frames. Only then does it start tasks and eager activations and release the held notifications
     (listener invocations, registry and state callbacks). Anything the new epoch sends to a child follows its commit
     frame on the FIFO link.
5. **Relabeled old code.**
   - Problem: a child that voted, then lost the link and rolled back, was renumbered to the server's epoch on
     reconnect; its old code then ran under the new epoch id.
   - Fix: `adoptEpoch` is gone. A host child's hello carries its epoch.
     - In step: usable (`synced`).
     - Behind: fenced (direct gets, routes and relays wait for `whenSynced`) and reconciled. The server runs the
       cluster protocol against that child alone, with the modules cluster reloads gave its name prefix, to the
       server's current epoch; it retries if the server moved meanwhile.
     - Ahead: the link closes.
   - New workers spawned after a reload are reconciled the same way, which costs one reload round on their first
     connect. Fenced children are not participants of other reloads.
   - The child's epoch is never renumbered: reconciliation either loads the expected code or the link closes.
6. **Leaked leases on round trips.**
   - Problem: a server root that went to a worker and came back was marked foreign on the server, never ended, and
     its lease blocked later gates until their deadline.
   - Fix: roots started on a host are tracked as local (`#local`) and never become foreign there, even when they come
     back over a link.
   - Root ids carry the host's incarnation (`name#incarnation:n`), so a restarted host with the same name never
     reuses an id.
7. **Disconnects not cancelling downstream.** Fix: relays own their calls (`RelayCall`). A cancel, an origin
   disconnect, a release, a revocation or the downstream going away settles each call once, forwards `cancel` when
   the downstream hold still exists, and removes both id mappings.
8. **PID-file lock.**
   - Problem: the lock was a PID file taken by the manager. Two managers could both read the same stale PID and take
     over, and the child never held the lock itself.
   - Fix: the child holds a kernel lock: an abstract socket on Linux/Android, a named pipe on Windows, a probed
     socket file elsewhere (the approach Pi Mobile uses). `childControl().lock()` acquires it before storage opens.
   - The manager passes the lock name in the environment. A second child fails `ready` with
     `unavailable/locked`, which the manager reports as the start error.
9. **Relay release and unsubscribe races.**
   - Fix: `RelayHold` owns queued and forwarded subscriptions and calls. An unsubscribe before resolution drops the
     queued entry, so nothing is forwarded later.
   - A release or close during resolution rejects waiting calls and forwards nothing. Any close removes every
     mapping on both links.
10. **Malformed frames and duplicate ids.** Fix: every received frame is validated against a TypeBox schema
    (`isFrame`). Malformed frames, duplicate hold/call/sub ids, and control frames from the wrong side close the link.
11. **Snapshots through `accepts` adapters.**
    - Problem: snapshots through an `accepts` adapter were validated against the provider's schema instead of the
      consumer's.
    - Fix: they are validated against the consumer's contract, because the adapter's view is what the consumer gets.
      Direct bindings still use the provider's schema.
    - Handle readables also accept any readable an adapter returns, not only cells and derivations.
12. **Descendants surviving a graceful exit.** Fix: the process group is killed when the leader exits, on every
    path (graceful, crash, kill).
13. **Idle clock.** Fix: `idleFor` counts from the busy → idle transition (or from ready), not from the last busy
    report.

### Remaining limits

- Reconciliation needs the child's module list. It is remembered from cluster reloads (`host.remoteModules`), so a
  server restart forgets it, and a child behind a restarted server then reloads no modules: it gets the epoch id with
  its own code. Persisting the module list with the epoch would close this.
- The vote deadline for reconciliation is fixed at 30 s. A failed reconciliation closes the link, so the manager
  restarts the worker.
- On non-Linux Unix, two processes that probe the same stale socket file at the same moment could both take it
  (accepted for Pi Mobile too). Managers serialize starts per lock name.


## p2 requests (docs/requests.md #1-#7)

Tests: `test/requests.test.ts`; each was checked to fail with its fix reverted (#1 also at the type level).

1. **Held state members as behavior state.** Behavior state members are typed `StateSource<T>` (`Readable<T> |
   Readable<T | undefined>`), and `validateBehavior` accepts any readable, not only cells and derivations. Such a member
   is not validated per write in dev mode (it is not this record's source); snapshots over links still are.
2. **Facet host access.** `FacetApi` is `{ serve, name, root, registry }`, for `install`, `load` and `reload` alike.
   Not added to `self`: methods have `ctx`, and a factory should not start roots.
3. **Listener resubscription.** A subscription is kept when the listener's origin (the resource, not its facade, or
   the source) and its `select` are unchanged; `select` counts as unchanged if identical or with the same source text.
   A kept listener's `select` is not called again. Limitation: a `select` whose behavior depends on captured values
   that change between factory runs is not detected (documented in the guide).
4. **`replace` diffing.** `replace(ctx, value, { diff? })`. Default: diff when the new value reuses at least one
   container of the old at the same key (a new revision of the same state), else `r`. The tracker still adopts a whole
   replacement; only the published ops come from `diffRevisions`. Unrelated replaces still publish `r` (existing
   behavior).
5. **Roots of a fenced child.** The parent records the epoch a child announced while behind (`fencedEpochs`). A call
   from that link carrying a root of such an epoch is admitted in the parent's current epoch at its first call and keeps
   that epoch for the root's later calls (`superseded` once the parent retires it). Other unknown epochs stay
   `superseded`. Notes item 17 (a worker root calling a server that retired an epoch both had) remains open.
6. **`self.expose(resource)`.** Returns an `Exposed<T>` marker accepted where a local `opaque<T>` member is expected.
   Handles resolve it to the resource's value when live (`undefined` while loading); the resource must be declared by
   the same record.
7. **Per-child reload reports.** A child's vote carries its prepared report (`Reload.summary()`); the coordinator's
   `ReloadReport.children` maps host names to them. Additive; local reloads have no `children`.

## p2 requests #8-#10

Tests: `test/requests.test.ts` (#8-#10); each fails with its fix reverted.

8. **Stale remote state members.** A `RemoteReadable` forgets its value when its last listener leaves (it is only
   kept current while subscribed). A new subscriber gets `undefined`, then the snapshot as a reset. Local handle members
   always read the current source and were not affected.
9. **`handle.onStatus(listener)`** on local and remote handles: called (through the publication queue) after every
   status change, with the error for `gone`. Remote handles also report `live` → `loading` while an upstream link
   reconnects. `onStatus` is now a reserved member name.
10. **Shutdown order.** `host.close()` and `invalidatePrincipal` dispose in waves: a record goes once no remaining
    record holds it, so holders close their resources while their holds (local and remote) still work. `host.close()`
    closes links only after the records. Caveat: a `close` that awaits a remote call over a link that is already down
    waits for a reconnect (calls without a signal never time out); the guide says to bound such calls.

## p2 request #11: eager startup readiness

Tests: `test/readiness.test.ts` (load/install activation delays, factory/dependency/resource failures,
missing providers, same-batch provider ordering, lazy preservation, configured eager input, readiness snapshots,
and deferred worker admission).

- **Problem:** load resolved after setup, while eager activation failed only through `onError`. Startup could claim
  readiness with a required object unavailable. Waiting for everything before worker control readiness would also
  deadlock: reporter waits for server SessionStatus; parent waits for worker readiness before accepting its link.
- **Solution:** install returns an eager-activation promise; load installs its entire batch synchronously before
  awaiting those promises. Failures use the existing handle activation errors, and still reach `onError`. Lazy
  objects remain lazy unless held by an eager dependency. Setup is still synchronous; installation is not rolled
  back by activation failure.
- **Bootstrap escape:** additive `LoadOptions.awaitEager` (default true) supports false on load/install. It starts
  eager activation without awaiting it. `host.ready()` later awaits the eager holds present at call time, including
  direct serves. No upstream-dependency detection or extra holds are needed. Connect the worker upstream before
  loading, await the independent local Harness handle, announce control readiness, then await the full barrier.
  Application control admission, bootstrap liveness and fatal reporting remain application responsibilities.
- **What p2 can drop:** eager declaration collection around facet `serve`, synthetic eager handles kept solely for
  startup, and explicit per-eager `ready` loops in the loader/testHost. Ordinary startup uses `await host.load`.
  Worker startup replaces its upstream eager-ready loop with `await host.ready()` after admission; retain the local
  Harness readiness wait, parent control announcement, and busy/fatal bookkeeping. This task does not change p2's
  loader or worker integration.

## Owner decision: keep the state API

The proposal to give each object exactly one state value and drop `cell()` and `derivation()` is rejected. The state
API stays as it is: named cells and derivations per object. Do not reopen this without a new, concrete problem.
