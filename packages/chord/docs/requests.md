# Chord requests (from p2)

p2 is the first application built on Chord. These are the bugs, gaps and missing features found while building it. Each has the workaround p2 uses meanwhile.
#1-#7 are fixed in Chord (see notes.md, "p2 requests"); p2 dropped their workarounds.
Fixes live in `src`; additional resolved requests are marked below.

## 1. Handle state members cannot be returned as behavior state members (typing)

- Problem: the guide shows `return { kind: "viewer", view: c.view }` (a held object's state member exposed as this
  object's state). The handle member is typed `Readable<T | undefined>`, the behavior member `Readable<T>`, so this
  does not type-check.
- Workaround: `self.derive({ view: derivation([c.view], (v) => v ?? null) })`. Costs one more diff per change.
- Request: accept handle readables in `BehaviorOf` (they are `undefined` only while loading, and the record is live
  before its behavior is used), or a helper that narrows them.

## 2. Facets have no host access outside `serve`

- Problem: `FacetApi` only has `serve`. Code that is not a Chord method, listener or task needs a host to start a
  root or read a registry: Durable tools and hooks (`rename_session` calls the server), a method reading another
  registry (`HarnessConfig` in `Chat.configure`).
- Workaround: the worker entry stores its host in a runtime module (`workerHost()` in `src/runtime/worker.ts`).
- Request: `FacetApi.root(fn)` and `FacetApi.registry(r)` (or `self.root`/`self.registry` on records), so plugins do
  not reach for a process-global host.

## 3. A listener's `select` must return the same object for the same value

- Problem: at reload, `stageListeners` keeps a subscription only when `select(value)` returns the identical
  subscribable. A `select` that wraps the value in a new adapter object (natural for Durable watches) resubscribes
  at every reload. For a source that accepts one subscriber (a Durable `WatchHandle.start`), the reload aborts:
  `reload: Watch is already started`.
- Workaround: `watchSource()` and `summaries()` memoize their adapter per underlying value (WeakMap).
- Request: document it in the guide (`listener(source, select, fn)`), or compare `(resource, select)` instead of the
  selected object (a changed `select` function would still resubscribe).

## 4. `cell.replace` publishes the whole value

- Problem: mirroring an external immutable state (a Durable conversation view, revised on every streamed token)
  into a cell with `replace` sends a full `r` op to every remote subscriber per revision. `change` only diffs what a
  draft mutates; there is no way to hand over a new immutable revision and get a diff.
- Workaround: the cell holds the revision; a derivation `(v) => v` exposes it, and `Derived.install` diffs
  revisions with `diffRevisions` (cheap, unchanged subtrees are shared).
- Request: `cell.replace(ctx, value, { diff: true })` (or diff by default when the old and new values share
  structure).

## 5. Roots of a child behind the server get `superseded`

- Problem: a worker spawned after a cluster reload starts on epoch 1 and is reconciled to the server's epoch. Its
  eager objects run meanwhile; a listener root of epoch 1 calling the server gets `superseded: epoch 1 is not
  retained by server`. The event is lost unless the caller retries. Notes item 17 lists the general case as open.
- Workaround: `retrying(host, ctx, fn)` (`src/runtime/retry.ts`) retries retryable errors in fresh roots; the status
  reporter re-reads the latest task graph on each attempt.
- Request: hold upstream calls of a fenced child until it is reconciled, or have the parent admit such roots in its
  current epoch (the child had no old roots there).

## 6. Exposing a native object opened by a resource

- Problem: local members must exist when the factory returns, but a resource's value only exists after activation.
  An `opaque` member therefore cannot hand out, say, the Durable Harness opened by a resource.
- Workaround: methods returning it (`harness.harness(null)`), which makes every use asynchronous.
- Request: an `opaque` member backed by a resource (`self.expose(res.durable)`), readable once the record is live.

## 7. Cluster reload report does not include children

- Problem: `host.reload([], { remote })` on the server returns the server's `ReloadReport`; `changed` and `prepared`
  are empty when only worker facets changed, so a caller cannot tell what the workers did.
- Request: per-child reports in the coordinator's result.

## 8. An unsubscribed handle member keeps a stale value

- Problem: a remote handle's state member subscribes upstream only while someone listens. After the last listener
  leaves, `value` keeps the last received value, and the next `subscribe` first delivers that stale value
  synchronously, before the fresh snapshot arrives as a reset. Example (p2's sharing test): `until(drafts.drafts,
  (v) => v.length > 0)` resolved at once with a draft that had been claimed after the previous `until` unsubscribed;
  `poll(() => sharing.guests.value?.length === 0)` never saw the guests leave.
- Workaround: tests keep a subscription open while they wait for changes (`until`, or an explicit `subscribe`);
  React's `useReadable` subscribes for the component's lifetime.
- Request: reset `value` to `undefined` when the upstream subscription ends (a new subscriber then sees `undefined`,
  then the snapshot), or document it in the guide (State, Handles).

## 9. No public status event on handles

- Problem: a UI holding a handle must notice `gone` (revocation, worker stopped) to `get` again. `onShape` fires on
  live/variant/reload, not on `gone`; `goneListeners` is internal.
- Workaround: `useObject` (src/runtime/web.tsx) checks `handle.status` every second after `ready`.
- Request: `handle.onStatus(listener)` (or `onGone`).

## 10. Host shutdown disposes held objects before their holders

- Problem: when a worker host closes, a `Chat` record's resource `close` read `undefined` from the `opaque` member of
  its held `WorkerProcess` handle (`TypeError: Cannot read properties of undefined (reading 'add')`). The guide says
  an object's own holds are released after its resources close, so a dependency should still be live there.
- Workaround: the resource captures what it needs at `open` and uses that in `close` (p2's chat worker).
- Request: at host close, dispose holders before what they hold (reverse dependency order), or document that
  handles may be gone in `close` during shutdown.

## 11. Loading facets does not await eager activation failures

- Problem: `await host.load([facet])` can resolve even when an eager factory fails immediately (for example,
  `self.get(ModelConfig)` with no models plugin). The failure only reaches `onError`; startup/tests can report ready
  while a required object is already unavailable.
- Workaround: p2's loader and `testHost` collect `serve(..., { eager })` declarations and explicitly await their
  handles' `ready`. The worker opens its Harness, announces control ready (the parent then accepts its IPC link),
  and only then awaits upstream eager holds, counting this bootstrap as an active call. Waiting for a status
  reporter before announcing ready deadlocks:
  reporter waits for server SessionStatus, server waits for worker ready before accepting that link.
- Request: an awaited activation-ready API for loaded eager objects, with startup errors propagated, and a documented
  separation between local bootstrap readiness and upstream admission. Keep ordinary lazy objects lazy.

## 12. An eager object's bootstrap hold pins its old contract (resolved)

- Problem: chat-mode changed its store from one boolean to per-conversation state, with a contract-version bump
  and state migration. When the store itself was eager, its host-owned hold still required version 1, so reload
  failed with `contract_mismatch` even after every real consumer was updated.
- Historical workaround: a separate eager router held a non-eager store. This separation is no longer required
  for contract upgrades (it may still be useful organization).
- Resolved: `src/reload.ts` excludes only the exact eager bootstrap hold from old-consumer compatibility
  checks, then replaces it with a hold on the new provider contract at commit. The replacement attaches before
  the old hold releases: the record, migrated cells, unchanged resources and registrations survive. Abort leaves
  the old bootstrap hold untouched. Other consumers keep their own tokens and still need coverage/`accepts` or
  replacement in the same batch; forgotten version bumps and missing/invalid state migrations remain refused.
- Tests: `test/eager-reload.test.ts` covers configured input, consecutive contract bumps, migration/rollback,
  resource lifetime, external and record-owned consumers, adapters, forgotten bumps and cluster vote failure.
