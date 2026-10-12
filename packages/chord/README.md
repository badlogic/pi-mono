# @earendil-works/chord

Chord builds applications out of **objects** that live in several processes (a server, workers, browser tabs) and can be **hot reloaded** while they run.

- An **object** is state plus code at an address. It is created on demand and lives while someone holds it.
- Everyone gets a **handle**, never the object. Handles work the same locally and across processes, and survive reloads.
- Every object knows its **principal**: an owner and a guest get different objects, with different methods.
- **State** is observable JSON. Remote viewers get a snapshot followed by deltas.
- **Hot reload** swaps code while it runs. Work in flight finishes on the code it started with, state is kept, and incompatible changes migrate at a safe point.

Contracts are runtime values described with [TypeBox](https://github.com/sinclairzx81/typebox) schemas. Hosts exchange JSON frames over links: in memory, a Node IPC channel, or a WebSocket.

## Entry points

| Import | Contents | Runs in |
|--------|----------|---------|
| `@earendil-works/chord` | Contracts (`local`, `remote`, `method`, `opaque`), declarations (`cell`, `derivation`, `listener`, `resource`), hosts (`createHost`, `defineFacet`, `defineRegistry`), links (`memoryLinkPair`, `ipcLink`, `webSocketLink`, `acceptWebSockets`), errors (`ChordError`, `isChordError`, `forbidden`, `invalid`). Also the shared base: `Context`, `JsonValue`, `JsonRepresentation`, `Draft`, `copyJson`, `isJsonValue`, and `replicatedState` with its types. | Node and browsers |
| `@earendil-works/chord/node` | Child host processes: `createHostManager`, `forkDriver`, `childControl`, `processLock`; the facet module loader `nodeLoader`. | Node |
| `@earendil-works/chord/context` | Explicit cancellation and invocation values: `BACKGROUND_CONTEXT`, `withCancel`, `withAbortSignal`, `withoutAbortSignal`, `withContextValue`, `awaitWithContext`. | Node and browsers |
| `@earendil-works/chord/delta` | The transactional JSON tracker, structural diff, immutable apply, and the wire encoder/decoder for operation batches. | Node and browsers |

## Quick start

```ts
import { Type } from "typebox";
import { cell, createHost, method, remote } from "@earendil-works/chord";

// contract.ts: shared by provider and consumers
export const Counter = remote("demo.counter", {
	version: 1,
	input: Type.Object({ name: Type.String() }),
	variants: {
		default: {
			state: { count: Type.Number() },
			methods: { increment: method(Type.Object({ by: Type.Number() }), Type.Null()) },
		},
	},
});

const host = createHost({ name: "server", principalKey: (p) => p.kind });

host.serve(Counter, ({ name }, _principal, self) => {
	const state = self.state({ count: cell(Type.Number(), 0) });
	return {
		kind: "default",
		count: state.count,
		increment: async ({ by }, ctx) => {
			state.count.change(ctx, (n) => n + by);
			return null;
		},
	};
});

await host.root(async (ctx) => {
	const clicks = ctx.get(Counter, { name: "clicks" }); // a handle; held until this root ends
	clicks.count.subscribe((n) => console.log("count", n));
	await clicks.increment({ by: 2 }, ctx); // logs 0, then 2
});
```

## Documentation

- [Tutorial](docs/tutorial.md): a shared todo list, built up section by section. Every example runs as `test/tutorial.test.ts`.
- [Usage guide](docs/guide.md): API reference for contracts, objects, state, roots, lifetime, plugins, hot reload, hosts, and links.
- [Specification](docs/spec.md): compatibility, lifetime, and reload semantics.
- [Implementation notes](docs/notes.md) and [requests](docs/requests.md): decisions, review findings, and resolved requests.
- [Delta guide](src/delta/README.md): ownership, lifecycle, operation, and replica contracts of `@earendil-works/chord/delta`.

## Replicated state

`replicatedState` is a standalone observable immutable JSON value, independent of hosts. Durable uses it for document, view, and task-graph states.

```ts
import { replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const status = replicatedState({ output: "", count: 0 }); // takes ownership of the initial value
status.subscribe((value, context, delivery) => console.log(delivery.kind, delivery.sequence, value.count));
status.change(BACKGROUND_CONTEXT, (draft) => {
	draft.output += "done\n";
	draft.count += 1;
});
```

`replicatedState(source, { onError })` instead attaches a publication-only state to an authoritative revision source (`ReplicatedStateSource`): it captures a snapshot, then publishes every committed frame in cursor order.

A successful `change()` publishes exactly one atomic revision. If its callback throws, the value and sequence stay unchanged. Draft handles become unusable when the callback returns. Values placed through drafts are copied; `replicatedState(initial)` and `replace(context, value)` take ownership of alias-free strict-JSON roots without copying them, so callers must not mutate them afterwards. Published values are not frozen.

Each subscription serializes its callbacks: hydration settles before updates start. At most 100 deliveries wait behind a running callback; on overflow only the newest pending value is kept, so update sequences may skip. Listener failures go to `onError` (attached states) or are thrown in a microtask (mutable states), and never stop other subscriptions. Unsubscribing discards pending work without aborting the running callback.

## Tracking JSON deltas

```ts
import { applyImmutable, track } from "@earendil-works/chord/delta";

const tracker = track({ output: "", count: 0 });
const change = tracker.beginChange();
change.state.output += "done\n";
change.state.count += 1;
const prepared = change.prepare();

tracker.adopt(prepared);
const replica = applyImmutable(prepared.base, prepared.ops);
```

`tracker.value` is always the latest adopted immutable revision. Preparation does not change authority; adoption validates the preparation and swaps the root pointer. Assigned containers are copied by value and unchanged subtrees may be shared between revisions.
