# Chord specification (v7)

Status: implemented in `packages/chord`; this document was its design target. Synthesized from the round-6 reviews and the hot-reload designs of Sol, Astra, Opus and the DeepSeek-harness agent. Supersedes the `chord-guide` artifact v1 and design v6 where they disagree.

Hard constraints:
- Chord's runtime depends only on its own `delta` module (tracker, applyImmutable, encoder/decoder, diff) and Node/browser built-ins plus `typebox` for schemas. No other Pi packages.
- Built-in plugins are trusted, loaded from source in-process. The plugin loader uses dynamic `import()` with a cache-busting query (owner-approved exception, `TODO(loader)`: replace with an isolating, evicting loader; old module copies leak; TUI plugins need isolation).
- Hot reload is required. Host restart only for Chord/runtime code changes or host-level crash recovery.

## 1. Concepts

| Term | Meaning |
| --- | --- |
| type | Name + contract. `remote` (addressable from other hosts; schemas for input, variant state members, method args/results) or `local` (host-only; members may be anything, including functions and native objects, but must be listed in the contract: `method`, `opaque` or a state schema). |
| factory | `(input, principal, self) => behavior`. Synchronous. Registered with `host.serve(type, factory, options)` from a plugin facet. |
| record | Stable identity per `(type, canonicalInput, principalKey)`. Owns cells, resources, holds, listeners, tasks, registrations. Survives reloads. |
| behavior | What a factory run returns (methods + state members; `kind` for remote variants). Immutable, per epoch. |
| handle | What `get` returns. Late-bound. Never the record or behavior. |
| hold | One handle's claim. A record lives while held. |
| principal | App-defined. Stamped by links. In-host code acts as the `host` principal. |
| root | One short Chord call tree, admitted at trusted ingress (link request without root, UI event, timer, `host.root`). Carries `{ rootId, epoch }`. |
| epoch | One committed set of behaviors/registrations per host (server-issued id). |
| code holder | Long-lived execution that is NOT a root: Durable phases/tool runs, browsers, `self.task` loops. Every Chord call they make starts a fresh short root. |

## 2. Contracts

Contracts are runtime values for every type (shipped bundles have no TypeScript; third-party plugins are built separately). TS types are inferred from them.

```ts
export const Chat = remote("pi.chat", {
	version: 1,                                   // contract version: a plain number, bumped only on breaking changes
	input: Type.Object({ session: Type.String(), conversation: Type.Number() }),
	variants: {
		viewer: { state: { view: ViewSchema } },
		participant: {
			state: { view: ViewSchema },
			methods: { send: method(SendSchema, Type.Object({ submissionId: Type.Number() })) },
		},
	},
});

export const Index = local("pi.index", {
	version: 1,
	input: Type.Object({ session: Type.String() }),
	members: {
		search: method(Type.Object({ query: Type.String() }), Type.Array(Hit)),
		onChange: method(Type.Function([Change], Type.Void()), Unsubscribe),   // non-JSON allowed for locals
		harness: opaque("pi.durable-harness@1"),                               // native object, by name+version
	},
});
```

- Input identity: normalize (apply defaults, strip unknown), validate, then canonical JSON with fields equal to their schema default omitted. Changing defaults or normalization requires a new type name.
- Remote calls validate args/results and state values at the provider boundary. Local calls are not validated per call.
- Local contracts list every member (`members: { search: method(...), harness: opaque(...), status: Schema }`). A handle that is still `loading` must know whether `h.x` is a method (a caller that waits until live), a state member (a readable) or an opaque value, before any behavior exists. Members missing from the contract are found only once the handle is live.
- Every bundle embeds the contract tokens it was built against (its own copy). Fingerprint = hash of the canonical description.

### Compatibility rule

A consumer built against version M binds to a provider at version N iff N = M and the provider's description covers the consumer's; otherwise only through `accepts[M]` adapters declared by the provider (`serve(type, factory, { accepts: { 1: (current) => v1View } })`); else `contract_mismatch`.

Covers: every consumer member exists with the same kind; methods: provider accepts every argument the consumer can send (new fields optional, nothing newly required or retyped) and the provider's result fits the consumer's expected result (extra fields fine); state: provider value fits consumer schema (extra fields fine); opaque: same name@version.

Additive changes need no bump. Breaking changes (remove/rename/retype, newly required, or a change of meaning with the same shape) bump the number. Same version + non-covering description = forgotten bump, refused. Meaning changes without a bump are undetectable (author's responsibility, as with Durable document versions).

Checked at: `get` binding, reload prepare (new provider token vs every surviving consumer holding the type and every loaded plugin importing it), remote holds (consumer token in the hold frame).

The exact host-owned eager bootstrap hold is a lifecycle pin, not a surviving old-contract consumer. When its
provider is replaced, commit replaces that hold with one bound to the new provider contract, acquiring it before
releasing the old hold so the same record, state and unchanged resources survive. It needs no `accepts` adapter
for its own previous contract. Prepare/abort do not change that hold. All other consumers retain their own tokens
and the normal coverage/adapter checks; state-version and migration checks are unchanged.

## 3. Factory and declarations

Factories are synchronous; returning a promise throws. Declarations are identified across factory reruns by **property names** in object literals (not call order, not separate string keys). Names are unique per record per declaration kind; a declaration method may be called more than once if names don't repeat. Holds are identified by their address.

```ts
host.serve(StatusStore, ({ session }, _host, self) => {
	const state = self.state({
		status: cell(StatusSchema, { running: false, tasks: 0 }),   // schema required, initial value
		errors: cell(Type.Array(Type.String()), []),
	});
	const catalog = self.get(Catalog, {});                         // hold; identity = canonical address (+ at)
	const res = self.resources({
		watch: resource({
			rev: 1, deps: [catalog], exclusive: false,
			open: async ({ signal }) => openWatch(session, signal),
			close: async (w) => w.close(),
		}),
	});
	self.listen({
		changes: listener(res.watch, (w) => w.events, (event, ctx) => state.status.change(ctx, (d) => { d.tasks = event.tasks; })),
	});
	self.tasks({ poll: async (ctx) => { /* loop until ctx.signal aborts */ } });
	const derived = self.derive({ visible: derivation([state.status], (s) => project(s)) });  // synchronous
	self.register(Routes, { "GET /status": handler });              // registry keys are the registry's own keys; eager records only
	return { status: derived.visible, report: (args, ctx) => { state.status.replace(ctx, args); return null; } };
}, {
	state: { version: 2, migrate: { status: (old, from) => upgrade(old, from) } },  // migrate gets the old value and its version
	linger: 30_000,
	eager: false,
});
```

| Declaration | Survives reload | Notes |
| --- | --- | --- |
| `state({ name: cell(schema, initial) })` | same cell and value; migrated on state-version bump | Schema required (no TypeScript at runtime). `change(ctx, draft => void)`, `replace(ctx, value)`, `value`, `subscribe`. Writes through `change` touch only mutated paths. |
| `get(type, input, { at? })` | kept if declared again (same address) | returns a handle |
| `resources({ name: resource({ rev, deps?, exclusive?, open, close }) })` | kept unless `rev`/`deps` change | `open` runs at prepare (non-exclusive) or at the gate (exclusive); handle exposes `.value` |
| `listen({ name: listener(source, select?, fn) })` | same subscription while source (resource) and `select` (identity or source text) are unchanged; `fn` swapped | each event starts a fresh root in the current epoch; `select` is not re-run for a kept subscription |
| `tasks({ name: fn })` | restarted with new code at commit (old one aborted via ctx.signal) | a code holder; calls inside start fresh roots |
| `derive({ name: derivation(sources, fn) })` | kept; fn swapped | synchronous fn |
| `register(registry, { key: value })` | value swapped at commit | eager records only (v1) |
| `expose(resource)` | follows the resource | a local member (usually `opaque`) whose handle value is the resource's value once live |

State members of a behavior may be cells, derivations, or state members of handles the record holds (they are defined once the record is live). `cell.replace(ctx, value, { diff? })` publishes a structural diff when the new value shares containers with the old one (or `diff: true`), else `r`. Facet `setup` receives `{ serve, name, root, registry }` of its host.

`migrate` per cell is `(old, fromVersion) => new`. A record may be several versions behind (author bumped more than once between reloads).

Removed vs guide: `self.own`, `holdWhile`, async factories, inferred dependencies.

### Synchronous factory, asynchronous activation

`self.get` and `self.resource` only declare and return placeholders. Activation of a record:

1. run the factory synchronously (declarations);
2. await declared resources' `open()` (e.g. connect a DB);
3. await declared holds becoming live (dependencies activate first, coalesced);
4. record is live: handles `live`, `ready` resolves.

Inside the factory, placeholders must not be used (`resource.value` throws `not_ready`; handle calls throw). Methods/listeners/tasks run only on live records, so their dependencies are live. External consumers (UI, roots) holding a `loading` handle: calls wait until live (ctx cancellation, deadline); state members read `undefined` until hydrated. Activation failures propagate to dependents and all waiting gets; the next get retries.

### Host eager readiness

- `host.install(facet, { awaitEager? })` installs declarations synchronously and returns a promise for this facet's
  eager activations. `host.load(facets, { awaitEager? })` installs the entire batch before awaiting its eager
  activations. `awaitEager` defaults to true. Unheld lazy objects are not activated.
- Factory, resource-open, dependency and activation-finalization failures reject the returned promise with the
  activation error (ChordError codes preserved; ordinary errors wrapped as `unavailable`). Eager failures also
  reach `onError`. Installation is not a rollback transaction; setup/registration errors from `install` throw
  synchronously. Abandoned startup should close the host.
- `{ awaitEager: false }` starts the same eager objects but resolves after installation, without waiting for their
  activation. `host.ready()` awaits a snapshot of the host's eager holds at call time (including direct eager
  `serve` and deferred loads), rejects their activation failures, and does not acquire additional holds. It is not
  an ongoing health check and does not await task completion or remote state hydration.
- Local bootstrap readiness and upstream admission are separate. A worker connects its upstream link, loads with
  `{ awaitEager: false }`, awaits its local bootstrap handle (e.g. Harness, with no upstream dependency), then
  announces control readiness so its parent can accept the link. Only after admission does it await `host.ready()`.
  Otherwise an eager reporter depending on server SessionStatus deadlocks with the parent waiting for control
  readiness. Deferred loads skip the whole barrier, not selected dependencies; callers explicitly choose local
  bootstrap handles, keep bootstrap busy until full readiness, and propagate later startup errors.

## 4. Principals, variants, handles

- `createHost({ principalKey })` maps principal to a key that includes connection provenance and grant revision. Records are per principal key. `host` is a built-in principal for in-host calls.
- Remote factories return `{ kind, ...members }`; `kind` must be a declared variant; members must match it. Local factories return any object.
- Handle: `status` (`loading | live | released | gone`), `ready` promise, `kind`, `shape` (`{ kind, members, contract }`), `onStatus(listener)` (every status change, with the error for `gone`), late-bound members, `release()`. A remote handle's state member holds a value only while subscribed (`undefined` after its last subscriber leaves). Shape changes (reload, variant) are pushed; members missing from the current variant reject `not_in_variant`; released handles reject `released`; forced disposal makes handles `gone`.
- Methods are `(args, ctx) => Promise<result>`. Factories still check arguments; variants are not complete authorization.
- Revocation: `host.invalidatePrincipal(match)` force-disposes matching records on this host and propagates over links; links re-stamp or close.

## 5. Lifetime

- Hold owners: record (declared `get`), call (`ctx.get`, released at settle), connection (remote holds; relay maps per origin connection), host (eager), UI.
- Activation coalesced per address; if all requesters leave before it completes, the result is disposed. Factory throw: unwind declarations, reject gets, next get retries.
- Disposal after last hold + `linger`: tasks aborted, listeners removed, resources closed (reverse order; all run; errors aggregated), holds released (cascade).
- Bulk forced disposal (`host.close`, `invalidatePrincipal`) goes in waves, holders before what they hold, so a resource's `close` can still use its record's holds; `host.close` closes links after the records.
- Forced disposal: handles `gone` immediately, new calls rejected, in-flight call contexts aborted, then cooperative cleanup.
- Hold graph acyclic in-host (checked at get); across hosts by convention.
- Links have ping/timeout; a dead link releases everything held through it.

## 6. Roots and epochs

- `Ctx = { signal, rootId, epoch, get(...) , principal? }`. Explicit; no AsyncLocalStorage dependency (may be used in dev to warn).
- A link creates a root for a request that carries none; nested remote calls carry `{rootId, epoch}`.
- Dispatch: a call with epoch E runs the record's behavior for E. A host retains at most `current` and `previous` epochs (two-version rule). A call for an epoch the host doesn't have (older than previous, or host started later) is rejected `superseded` (retryable by starting a new root). Never substitute another epoch.
- Browsers never carry epochs into the server: browser calls start roots at the server. Browsers learn of changes via shape/reset pushes and a server `Manifest` object; incompatible contract fingerprint -> `upgrade_required`.

## 7. Reload

Explicit trigger (`reload_plugins` tool, button, API). Serialized; no nesting.

1. Build/type-check gate (p2 tooling): dependency-closed set; refuse breaking remote contract changes without a contract version bump.
2. Load: on every affected host, import new facet modules (cache-busted).
3. Prepare: for each live record of each affected type, run the new factory in recording mode: existing cells readable, writes throw; listeners/tasks/registrations recorded, not started; holds recorded; non-exclusive resources whose key is new or `rev`/`deps` changed are opened as candidate-owned (closed on abort). Validate keys, variants, registry collisions. New records activated during prepare use the current epoch (old code). Any failure: abort, discard candidates. Vote.
4. Gate (only records whose state version was bumped or which replace an exclusive resource, plus records depending on those resources):
   - Admission cut: from now, an old-epoch root that has not touched the record gets `upgrade_conflict` (retryable), not queued. Roots that already hold an activation lease on it are grandfathered; their re-entry is admitted.
   - Wait for grandfathered activations to finish, deadline (default 5 s). Missed deadline: abort the reload, reopen, nothing changed (report blocking roots).
   - Exclusive resources: close old, open new; on failure reopen old and abort.
   - Run `migrate` into private copies; validate.
5. Commit (server persists the decision, commits itself, then sends commit to children; FIFO links guarantee no host receives a new-epoch root before committing): each host in one synchronous step installs migrated cell values and state versions, installs behaviors as epoch E', swaps registry tables, restarts tasks with new code, rebinds listeners, pushes shape/reset to subscribers, opens gates. E' current, E previous.
   The coordinator's result carries `children`: each participating child's prepared report (its vote).
6. Retire: when no roots of `previous` remain (or on the next reload, which first waits for retirement with a deadline), drop its behaviors and release declarations only it declared.

Compatible changes (no state bump, no exclusive resource change) skip the gate: no waiting.

State compatibility rule: reload prepare compares each cell's old and new schema. Unchanged: compatible (no gate). Changed with the state version bumped: gate + `migrate`, output validated against the new schema. Changed without a bump: reload refused. A change of meaning with an identical schema needs a bump too (undetectable; author's responsibility). Initial values and migrate outputs are validated; per-write validation in dev mode.

## 8. Registries

```ts
export const Routes = defineRegistry<RouteHandler>("http.routes", { conflict: "error" });
self.register(Routes, { "GET /download": handler });       // in an eager record; keys are the registry's keys
host.registry(Routes).get("GET /download", ctx);            // table of ctx.epoch (or current without ctx)
host.registry(Routes).subscribe((table, epoch) => ...);     // bridges for imperative consumers (Durable)
```

Per-epoch immutable tables; order = first registration order, kept on replace. Durable bridge: implements Durable's `RegistryReader` from the table (snapshot per epoch) so phases pin a complete snapshot.

## 9. Hosts and links

- `createHost({ name, principalKey, upstream? })`; `host.accept(link)` for children; `host.route(prefix, { authorize(principal, hostName), resolve(hostName) => Promise<Link> })`.
- Links: `memoryLinkPair()` (tests), Node IPC (child_process), WebSocket (server `ws`, browser `WebSocket`).
- Principal stamping: the accepting side stamps the principal of what connects (from its authenticator); forwarded principals accepted only from the parent link; payload principal fields ignored.
- A child that connects behind its parent's epoch is fenced (nothing routed to it) and reconciled by a reload of its modules to the parent's epoch. Calls its roots of the old epoch make upstream are admitted in the parent's current epoch (the parent never ran that epoch), not rejected `superseded`.
- Relay: server forwards frames for `at` hosts to the resolved child link, mapping holds per origin connection; authorizes before resolving/spawning and re-checks after.
- Wire frames (JSON): `hello`, `get`/`hold`/`release`, `shape`, `call`/`result`/`cancel`, `state` (`snap`/`ops`/`reset` with per-subscription delta encoder), `gone`, `ping`/`pong`, reload control (`prepare`/`vote`/`commit`/`abort`).

## 10. Host manager (library)

`createHostManager({ driver, keepAlive })`: fork driver (entry, init, lock, env), serialized start/stop/replace, exit-before-replace, process-tree kill after grace, control channel (ready/fatal/shutdown), liveness callback (booting, activeCalls, viewers with heartbeats, durable tasks, idleFor).

## 11. Tests required (minimum)

Lifetime/holds/linger/forced disposal/gone; activation coalescing and abandonment; principals and variants; remote calls over memory links incl. relay and principal forgery attempts; state snap/ops/reset over a link with reconnect; registries per epoch; reload: compatible (no wait, pinned roots), prepare isolation (writes throw, failing factory leaves everything unchanged), state bump with migrate and gate, `upgrade_conflict` for late old roots, deadline abort, exclusive resource replacement, cross-host commit ordering, two-version retirement and `superseded`.
