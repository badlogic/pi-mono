# Changelog

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

