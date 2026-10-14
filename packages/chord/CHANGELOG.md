# Changelog

## [Unreleased]

### Breaking Changes

- Terminology follows the concepts: a reference (what `get` returns) is `Ref<C>` (was `Handle<C>`), its status `RefStatus` (was `HandleStatus`); what a factory returns is `ImplementationOf<C>` (was `BehaviorOf<C>`); a resource's options are a `ResourceDeclaration` (was `ResourceSpec`); epochs are code versions: `Ctx.codeVersion`, `RootOptions.codeVersion`, `Shape.codeVersion`, `Host.codeVersion`/`previousCodeVersion`, and the `codeVersion` fields of frames and reload reports (all were `epoch`). Docs and messages say object (was record) and reference (was handle and hold); the `hold` and `release` frame types keep their names
- A remote object's variant is named `variant` (was `kind`): factories return `{ variant: "editor", … }`, references expose `ref.variant` and `shape.variant`, and the `shape` frame carries `variant`. `variant` is reserved as a member name; `kind` no longer is
- Links have a protocol version (`PROTOCOL_VERSION`, now 2), announced in `hello`. Peers of different versions do not talk: the side that notices closes the link with reason `protocol-version <n>`, and both sides report it through `LinkOptions.onProtocolMismatch`. Peers without a version (older Chord) are refused
- `serve(…, { lifetime })` replaces `eager`: `"referenced"` (the default) creates an object at the first `get` of its address and disposes it after the last reference is released (plus `linger`); `"host"` creates the type's one object when its facet loads and keeps it until the host closes or a reload removes its facet. `lifetime: "host"` is refused at `serve` for remote types, for inputs that do not accept `{}` and together with `linger`; every `get` of such a type reaches its one object, created for the host principal, and another input is `invalid/input`. `eager: { input }` and the extra objects host-principal `get`s with other inputs created are gone. Only `"host"` objects may register (reason `invalid/not_host_lifetime`, was `not_eager`). `LoadOptions.awaitHostObjects` replaces `awaitEager`
- Declarations are calls by name: `self.state(name, schema, initial, { version?, migrate? })` returns the cell, `self.resource(name, { version, deps?, exclusive?, open, close? })` the resource (`rev` is now `version`), `self.on(name, source, [select,] handler)` declares a listener; `self.derive(sources, fn)` and `self.task(fn)` take no name. `cell()`, `derivation()`, `resource()`, `listener()`, `self.resources`, `self.listen`, `self.tasks` and the declaration maps are gone, and so are the types `CellDecl`, `ResourceDecl`, `DerivationDecl`, `ListenerDecl`. A repeated name of one kind in a run is `invalid/duplicate`
- State versions belong to cells: `ServeOptions.state` is gone; a cell's `version` (default 1) and `migrate(old, from)` replace it. A raised version migrates only that cell; a lowered one refuses the reload
- A derivation is new at every reload (computed at the commit) instead of kept with its function replaced. A listener whose state source a reload replaced subscribes again and gets the current value again: listeners on state must reconcile. Listeners on state subscribe when they activate, so they get the value current then
- `method(args?, result?)`: without arguments a method is called `ref.name(ctx?)` and implemented `(ctx) => …`; without a result it is void (callers get `undefined`). Descriptions record both by leaving `args`/`result` out (fingerprints of such methods change), `call` frames omit `args` and `result` frames `value` for them. Coverage requires both sides to agree on arguments; a void consumer accepts a result
- `FacetApi` has a `signal` (below): code that builds a `FacetApi` by hand, for example to wrap `serve`, must pass it on

### Added

- `StateOptions`, `EventOf`, `ValueOf` and `Lifetime` types
- Links are flow controlled end to end: peers acknowledge what they processed (`ack` frames, announced with `acks` in `hello`), and while a window of frames is unacknowledged (`window` in `LinkOptions`, default 256 KiB), state frames wait at the sender, coalesced per subscription, instead of queuing in front of call results. A stalled peer costs a bounded slot per subscription; a slot that outgrows it becomes a reset. Calls, results and control frames are never held back, so under load a result can arrive before state changes made before it
- `maxCalls` in `AcceptOptions` limits the calls a peer may have in progress on a link; further ones are answered at once with `unavailable` (reason `too_many_calls`) and the link stays open
- `FacetApi.signal` aborts once that run of the facet is no longer installed: a committed reload replaced or removed it, the reload that loaded it aborted, or the host closed. While a reload prepares, the installed and the candidate run are both live
- `HostOptions.taskStopDeadline` (default 5000 ms) bounds how long a reload waits for aborted tasks before it starts their replacements

### Changed

- `Link.send` returns the encoded frame's size as sent (deflated payloads count as sent) when the transport knows it (memory and WebSocket links); flow control counts these sizes, so links that return nothing (IPC, custom links) are not windowed
- A reload starts an object's new tasks only after its aborted ones finished (at most `taskStopDeadline`, then anyway, reported); before, the old and the new run of a task worked side by side
- When a reload forces the retirement of the previous code version, it first aborts the roots still running on it (their `ctx.signal`, reason `superseded`) and gives them up to 1 s to stop before it closes what only that code used; a call with such a ctx is `superseded`. Before, resources were closed under running roots, which were never told

### Fixed

- `nodeLoader` registers every facet's directory before importing any, so a facet that imports a file of a facet listed after it gets the same module copy as that facet; before, the load order could produce duplicates.
- A link that is already closed when a host accepts or routes to it is no longer kept as a connection: before, a route that returned a dead link (a child process that exited before its link was wrapped) made every later call to that host name fail with `unavailable` until restart, and leaked the connection's ping timer.
- Fixed `processLock()` failing with `listen EINVAL` on macOS and the BSDs when the temporary directory is too deep for a socket path (sun_path holds 104 bytes); the lock socket then lives in a private per-user directory, `/tmp/chord2-<uid>`
- A child host whose hello arrived while a cluster reload ran was marked in step without taking part, so it stayed on the old code version and every call to it failed `superseded` until it reconnected. It is now synced or reconciled when the reload ends; a child already behind is fenced at once, so its roots' calls up are admitted meanwhile. A reconciliation that is running when a reload starts likewise syncs its child only after that reload, against the committed code version
- A child host retired its previous code version as soon as a cluster reload's `prepare` arrived, before its parent did, so the parent's old roots got `superseded` on it. The coordinator now retires before it sends `prepare`, a child waits for its parent's `retire` (at most `retireDeadline`), and a child coming in step (or about to be reconciled) is told which code versions the parent retired before
- Disposed objects stayed reachable from the host until an object with the same address was created again (every distinct guest, session or input leaked one object, its references and the code they bind)
- References kept every code version's services, and with them the factory code of every reload, reachable for as long as they lived (held references, objects of lifetime `"host"`); old code generations could never be collected
- Call, task and root contexts were linked to long-lived signals with `AbortSignal.any`; Node keeps such dependants reachable while they have abort listeners, so a listener on `ctx.signal` kept its closure (and its code generation) alive for the object's lifetime. Contexts now detach when they close
- A relayed call ran under the origin's cancel signal only, so a forced retirement of the relaying host could not cancel it before closing the old code's resources; it now follows its root's signal
- A resource kept across a reload closed with the `close` of the factory run that first opened it, and kept that run's code reachable; it now adopts the newest declaration at commit

## [1.2.0] - 2026-10-12

### Breaking Changes

- Replaced the facet and service runtime with a typed host runtime: contracts (`local`, `remote`, `method`, `opaque`) are runtime values described with TypeBox schemas, objects are served by hosts (`createHost`, `defineFacet`, `defineRegistry`) and reached through handles, and hosts exchange JSON frames over memory, Node IPC, or WebSocket links (`memoryLinkPair`, `ipcLink`, `webSocketLink`, `acceptWebSockets`), with hot reload of plugins. See `docs/tutorial.md` and `docs/guide.md`
- Removed `defineService`, `createFacetHost`, `createRemoteServiceBinding`, `createStaticFacetLoader`, `combineFacetLoaders`, the remote-service endpoint, provider, error, and wire helpers, and their types. The old `defineFacet`, `Facet`, and `FacetLoader` are replaced by the new runtime's names of the same spelling
- Removed the `./bundler` export and the facet bundle loaders of `./node`; `./node` now exports the child host manager (`createHostManager`, `forkDriver`, `childControl`, `processLock`) and the facet module loader `nodeLoader`
- Removed `@earendil-works/pi-client`, `@earendil-works/pi-protocol`, and `@earendil-works/pi-server`, which served only the old runtime; they are no longer released

### Changed

- `replicatedState`, `copyJson`, `isJsonValue`, `Context`, `JsonValue`, `JsonRepresentation`, `Draft`, and the replicated state types keep their names on the root export; `./context` and `./delta` are unchanged, and `./context` also exports the `Context` and `ContextKey` types
- Depends on `typebox` instead of `esbuild`

### Fixed

- Fixed appending to an array costing a walk over the whole array: the delta tracker now plans inserts and removals that keep the remaining elements in order from the changed ranges alone, and `applyImmutable` builds an appended array in one copy instead of two. 32,000 one-item appends, one commit each, take 1.4 s instead of 11.3 s

