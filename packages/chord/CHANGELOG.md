# Changelog

## [Unreleased]

### Added

- Links are flow controlled end to end: peers acknowledge what they processed (`ack` frames, announced with `acks` in `hello`), and while a window of frames is unacknowledged (`window` in `LinkOptions`, default 256 KiB), state frames wait at the sender, coalesced per subscription, instead of queuing in front of call results. A stalled peer costs a bounded slot per subscription; a slot that outgrows it becomes a reset. Calls, results and control frames are never held back, so under load a result can arrive before state changes made before it
- `maxCalls` in `AcceptOptions` limits the calls a peer may have in progress on a link; further ones are answered at once with `unavailable` (reason `too_many_calls`) and the link stays open

### Changed

- `Link.send` returns the encoded frame's size as sent (deflated payloads count as sent) when the transport knows it (memory and WebSocket links); flow control counts these sizes, so links that return nothing (IPC, custom links) are not windowed

### Fixed

- `nodeLoader` registers every facet's directory before importing any, so a facet that imports a file of a facet listed after it gets the same module copy as that facet; before, the load order could produce duplicates.
- A link that is already closed when a host accepts or routes to it is no longer kept as a connection: before, a route that returned a dead link (a child process that exited before its link was wrapped) made every later call to that host name fail with `unavailable` until restart, and leaked the connection's ping timer.
- Fixed `processLock()` failing with `listen EINVAL` on macOS and the BSDs when the temporary directory is too deep for a socket path (sun_path holds 104 bytes); the lock socket then lives in a private per-user directory, `/tmp/chord2-<uid>`

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

