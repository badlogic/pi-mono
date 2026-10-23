# Build a shared todo list with Chord

## 1. What problem does Chord solve?

A todo list has data, operations on that data, and several people looking at it.
You could hand-write object creation, subscription cleanup, messages between
processes, and code replacement. Chord connects these pieces for you.

A **host** is the runtime that owns objects. An **object** combines state with
methods at an address, such as “the family todo list.” A **handle** is a caller's
reference to that object, not the object itself. Several handles can reach the
same object. Handles can also reach another host over a connection.

```text
browser host                         server host
handle + subscribed rows -- link --> Todos view (owner or guest)
                                           |
                                        handle
                                           v
                                   TodoStore: rows + methods
```

We will start inside one host, add observable state, then share it with a
browser. Finally we will add background work, plugins, and hot reload.
**Live state** means subscribers receive new values when data changes, without
asking for it again.

<!-- example:01 -->
```ts
const host = createHost({ name: "todo-server" });
assert.equal(host.name, "todo-server");
await host.close();
```

The assertion passes: the host's name is `todo-server`. Creating a host does
not create a todo object, start a server socket, or persist data. `close()`
shuts down its objects and connections.

> **Tip:** These are executable TypeScript examples, using assertions to show
> results. Shared imports are at the end. Later sections reuse earlier contracts
> and functions, but each section's test starts with fresh hosts. Test-only
> cleanup closes hosts even when an assertion fails; snippets omit that cleanup.

## 2. Your first object

Before callers can use an object, they need to agree on its name and members.
That agreement is a **contract**: a runtime value that also gives TypeScript its
types. A **schema** describes a value's shape. We use TypeBox's `Type` to write
schemas; `Type.Null()` means this method takes no useful argument.

Start with a label for a named list. `local` means only code inside this host
can reach it. The input `{ list: "family" }` identifies which list we want;
it is not an argument to `label`.

<!-- example:02-contract -->
```ts
const TodoLabel = local("tutorial.todos", {
	version: 1,
	input: Type.Object({ list: Type.String() }),
	members: { label: method(Type.Null(), Type.String()) },
});
```

A **factory** is a synchronous function that creates the object's behavior:
the methods and state callers will see. `serve` registers a contract and its
factory. Registration alone does not activate this lazy object; the first
`get` does.

A **root** is one short tree of calls, such as the work for a button click.
`host.root` starts it. Its **context**, called `ctx`, carries cancellation,
caller identity, and the code version for nested calls. Pass it to methods you
call from that root.

<!-- example:02-call -->
```ts
const host = createHost();
host.serve(TodoLabel, ({ list }) => ({ label: () => `Todos for ${list}` }));
const result = await host.root(async (ctx) => {
	const todos = ctx.get(TodoLabel, { list: "family" });
	return todos.label(null, ctx);
});
assert.equal(result, "Todos for family");
```

The result is `"Todos for family"`. `ctx.get` returns a handle immediately;
method calls wait for the object to become live. The handle acquired through
`ctx.get` is released when this root ends. We never receive the factory's
returned object directly. A standalone call without `ctx`, such as
`todos.label(null)`, starts its own root. Inside a root or method, pass the
existing `ctx` so nested calls stay in the same call tree.

The factory may also receive `principal` (who is asking) and `self` (the
object's declaration API). We did not need them yet.

> **Why:** The handle separates callers from implementations. Later, replacing
> code will not require replacing every caller's reference.

## 3. Give the list live state

A label is not a todo list. We need rows that can change, and a count that always
agrees with them. A **cell** owns an observable JSON value. A **derivation**
computes another observable value from cells or other readable sources.

Extend the contract with `rows`, `openCount`, and editing methods. State
members describe values, not methods. This adds members at contract version 1;
older callers that only need `label` still have everything they need.

`self.state` declares named cells. The name `rows` is important: on reload,
Chord matches that name to the existing cell and keeps its value.

<!-- example:03-contract -->
```ts
const Todo = Type.Object({ text: Type.String(), done: Type.Boolean() });
const Rows = Type.Array(Todo);
const TodoStore = local("tutorial.todos", {
	version: 1,
	input: Type.Object({ list: Type.String() }),
	members: {
		label: method(Type.Null(), Type.String()),
		rows: Rows,
		openCount: Type.Number(),
		add: method(Type.Object({ text: Type.String() }), Type.Null()),
		finish: method(Type.Object({ index: Type.Integer() }), Type.Null()),
		reset: method(Rows, Type.Null()),
	},
});
```

The factory now declares a cell and a derivation. Each method receives its
arguments and a context; changing the cell updates its readers and its derived
count together.

<!-- example:03-factory -->
```ts
const todoFactory: Factory<typeof TodoStore> = ({ list }, _principal, self) => {
	const state = self.state({ rows: cell(Rows, []) });
	const derived = self.derive({
		openCount: derivation([state.rows], (rows) => rows.filter((todo) => !todo.done).length),
	});
	return {
		label: () => `Todos for ${list}`,
		rows: state.rows,
		openCount: derived.openCount,
		add: ({ text }, ctx) => {
			state.rows.change(ctx, (draft) => {
				draft.push({ text, done: false });
			});
			return null;
		},
		finish: ({ index }, ctx) => {
			state.rows.change(ctx, (draft) => {
				const todo = draft[index];
				if (!todo) throw invalid("args", "No such todo");
				todo.done = true;
			});
			return null;
		},
		reset: (rows, ctx) => {
			state.rows.replace(ctx, rows, { diff: true });
			return null;
		},
	};
};
```

`change(ctx, fn)` gives `fn` a temporary mutable **draft**. Here `add`
pushes a row and `finish` changes one field. The draft is discarded if the
callback throws. The callback must be synchronous.

`replace(ctx, value)` replaces the whole value. We use it for resetting a
list we own completely. `{ diff: true }` asks Chord to publish just the
structural changes. Without that option, replacement diffs automatically when
the new value shares containers at the same keys with the old one; unrelated
values normally publish a whole-value replacement. Either way, subscribers
receive the same resulting value.

<!-- example:03-call -->
```ts
const host = createHost({ dev: true });
host.serve(TodoStore, todoFactory);
const todos = host.get(TodoStore, { list: "family" });
await todos.ready;
const counts: (number | undefined)[] = [];
const stop = todos.openCount.subscribe((value) => counts.push(value));
await host.root(async (ctx) => {
	await todos.add({ text: "Buy milk" }, ctx);
	await todos.finish({ index: 0 }, ctx);
	await todos.reset([], ctx);
});
assert.deepEqual(counts, [0, 1, 0]);
assert.deepEqual(todos.rows.value, []);
stop();
todos.release();
```

The count subscriber sees `0, 1, 0`: initially empty, one unfinished todo,
then no unfinished todos. Resetting to empty does not add another count
notification because the derived count is still zero. The final rows are `[]`.
`subscribe` calls back immediately with the current value and returns an
unsubscribe function. We await `ready` first so that value is not a loading
placeholder.

> **Why:** Store reloadable state in cells, not closure variables. Treat
> `cell.value`, `handle.rows.value`, and subscriber values as immutable.
> Only mutate drafts inside `change`; do not keep a draft for later use.
> A derivation runs synchronously, so use it for projections, not database work.

## 4. Let objects use objects and resources

Saving a todo may require both the list and a database connection. A **hold**
is a handle's claim that keeps an object alive. `self.get` declares a hold
owned by this object; it lasts longer than a single method call.

A **resource** is something the runtime opens and later closes, such as a
database connection. Its `open` may be asynchronous even though the factory
must be synchronous. The example database is deliberately fake: it just saves
strings in memory.

`opaque<T>("name@version")` describes a native, host-only member. It is not
JSON state and cannot be sent over a link. `self.expose` connects that member
to a declared resource, without reading the resource during the factory.

<!-- example:04-database -->
```ts
const Database = local("tutorial.database", {
	version: 1,
	input: Type.Object({}),
	members: { db: opaque<{ saved: string[] }>("tutorial.database@1") },
});
const SavedTodos = local("tutorial.saved-todos", {
	version: 1,
	input: Type.Object({ list: Type.String() }),
	members: { add: method(Type.Object({ text: Type.String() }), Type.Null()) },
});
const host = createHost();
let opens = 0;
const closed = Promise.withResolvers<void>();
host.serve(Database, (_input, _principal, self) => {
	const res = self.resources({
		db: resource({
			rev: 1,
			open: async () => {
				opens++;
				return { saved: [] as string[] };
			},
			close: () => closed.resolve(),
		}),
	});
	return { db: self.expose(res.db) };
});
```

The factory returns an exposed marker, not an opened connection. Chord runs
`open` after declarations finish. The promise named `closed` lets the test
observe eventual cleanup.

Now declare `SavedTodos` as an object that holds both the store and the database.
Its editing method uses these dependencies only after activation.

<!-- example:04-saving -->
```ts
host.serve(TodoStore, todoFactory);
host.serve(
	SavedTodos,
	({ list }, _principal, self) => {
		const database = self.get(Database, {});
		const todos = self.get(TodoStore, { list });
		return {
			add: async ({ text }, ctx) => {
				database.db!.saved.push(text);
				await todos.add({ text }, ctx);
				return null;
			},
		};
	},
	{ linger: 0 },
);
```

An outside consumer holds a `SavedTodos` handle. We also hold `Database`
directly so we can inspect what was saved.

<!-- example:04-call -->
```ts
const saved = host.get(SavedTodos, { list: "family" });
const database = host.get(Database, {});
await saved.ready;
await host.root((ctx) => saved.add({ text: "Buy milk" }, ctx));
assert.deepEqual(database.db!.saved, ["Buy milk"]);
assert.equal(opens, 1);
const statuses: string[] = [];
saved.onStatus((status) => statuses.push(status));
database.release();
saved.release();
await closed.promise;
assert.equal(saved.status, "released");
assert.ok(statuses.includes("released"));
```

After the method, the fake database contains `["Buy milk"]`. It opened once,
even though two objects held it. `SavedTodos` and `Database` become live
only after their resources and declared dependencies are ready. That is why
`database.db!` is safe inside this live object's method: activation has
already established that dependency. An outside caller must await readiness.

When both external handles are released, `SavedTodos` is disposed and
releases its own database hold. With no holds left, the database closes; we
wait for `closed.promise` to prove it. The released handle stays
`released`, and `onStatus` reports that transition. `onStatus` watches
changes; unlike state subscription, it does not deliver an initial status.

`linger` is a delay in milliseconds after the last hold leaves. Zero disposes
without a grace period; a positive value can avoid reopening an expensive
resource when a screen is briefly hidden. Linger is not persistence.

> **Tip:** A factory only declares dependencies. Never call a held method or
> read `resource.value` there, including during reload. Activation happens
> afterward. Bump a resource's `rev` when its configuration should be reopened.
> Disposal stops tasks and listeners, closes resources, then releases holds.

## 5. Who is asking? One store, two views

Owners may add todos; guests may only read them. A **principal** is the
application-defined identity of a caller. A **variant** is a named set of
members a remote object offers to that principal. It lets the UI discover
whether an editing method is available.

Do not create a separate data cell for each viewer: their lists would diverge.
Instead, each view holds the same host-local `TodoStore` and exposes its rows.
`self.get` defaults to the host principal, so owner and guest views share
that store. Remote view records themselves are separate per principal key.

<!-- example:05-views -->
```ts
const Todos = remote("tutorial.todo-view", {
	version: 1,
	input: Type.Object({ list: Type.String() }),
	variants: {
		viewer: { state: { rows: Rows } },
		editor: {
			state: { rows: Rows },
			methods: { add: method(Type.Object({ text: Type.String() }), Type.Null()) },
		},
	},
});

function serveViews(api: Pick<Host, "serve">): void {
	api.serve(Todos, ({ list }, principal, self) => {
		if (list !== "family") throw forbidden("This list is not shared");
		const store = self.get(TodoStore, { list });
		if (principal !== "owner" && principal !== hostPrincipal) {
			return { kind: "viewer", rows: store.rows };
		}
		return {
			kind: "editor",
			rows: store.rows,
			add: ({ text }, ctx) => {
				if (text.trim().length === 0) throw invalid("args", "A todo needs text");
				return store.add({ text }, ctx);
			},
		};
	});
}
```

Here principals are the strings `"owner"` and `"guest"`, assigned by
trusted application code. The built-in `hostPrincipal` can also edit.
`principalKey` maps identity to record identity. Real applications should use
stable identity, connection provenance, and grant revision, not display names.

<!-- example:05-call -->
```ts
const host = createHost({ principalKey: (principal) => String(principal) });
host.serve(TodoStore, todoFactory);
serveViews(host);
const owner = host.get(Todos, { list: "family" }, { principal: "owner" });
const guest = host.get(Todos, { list: "family" }, { principal: "guest" });
await Promise.all([owner.ready, guest.ready]);
assert.equal(owner.kind, "editor");
assert.equal(guest.kind, "viewer");
await host.root((ctx) => owner.add({ text: "Buy milk" }, ctx), { principal: "owner" });
assert.deepEqual(guest.rows.value, [{ text: "Buy milk", done: false }]);
await assert.rejects(guest.add({ text: "Not allowed" }), (error) => isChordError(error, "not_in_variant"));
await assert.rejects(owner.add({ text: " " }), (error) => isChordError(error, "invalid"));
```

The owner gets `editor`; the guest gets `viewer`. Both see the same milk
todo. Calling the guest's `add` rejects with `not_in_variant`, even though
TypeScript exposes methods from all variants on a handle. Whitespace-only text
rejects with `invalid`: it is a string, as the schema demands, but it breaks a
rule only the method knows. Use `invalid` for bad input and `forbidden` only
for callers who may not do something.

> **Why:** A variant is not all of authorization. The factory checks which
> list may be opened; the method checks the operation's arguments. Production
> code must also enforce grants that can change. Use
> `host.invalidatePrincipal(match)` to revoke matching records; held handles
> become `gone`. A UI watches `onStatus` and gets a new handle when appropriate.
> Guest-provided names or message text must never establish identity.

## 6. Reach the list from another process

A browser cannot call a host-only contract. `remote` contracts describe only
schema-checked state and methods that can travel as JSON. Our `Todos` view is
remote; the underlying `TodoStore` and database stay local.

A **link** carries ordered messages between hosts. A memory link runs both ends
in one test process, but uses the remote protocol. The accepting host stamps
the caller's principal from its authenticator, not from method arguments or a
client's claimed identity.

<!-- example:06 -->
```ts
const server = createHost({ name: "server" });
server.serve(TodoStore, todoFactory);
serveViews(server);
const [down, up] = memoryLinkPair();
server.accept(down, { principal: "owner", kind: "client" });
const browser = createHost({ name: "browser", kind: "client", upstream: up });
const todos = browser.get(Todos, { list: "family" }, { at: "server" });
const hydrated = Promise.withResolvers<void>();
const updated = Promise.withResolvers<void>();
const stop = todos.rows.subscribe((rows) => {
	if (rows !== undefined) hydrated.resolve();
	if (rows?.length === 1) updated.resolve();
});
await todos.ready;
await hydrated.promise;
assert.deepEqual(todos.rows.value, []);
await browser.root((ctx) => todos.add({ text: "Buy milk" }, ctx));
await updated.promise;
assert.deepEqual(todos.rows.value, [{ text: "Buy milk", done: false }]);
// Deliberately bypass TypeScript to simulate a malformed caller.
await assert.rejects(todos.add({ text: 123 } as never), (error) => isChordError(error, "invalid"));
stop();
assert.equal(todos.rows.value, undefined);
todos.release();
```

The browser sees an empty snapshot, then the new milk todo. `ready` means
the remote handle has bound to a live object; it does **not** guarantee that
subscribed state has arrived. That is why we separately await `hydrated` and
`updated`. A remote readable starts at `undefined` and returns to
`undefined` when its last subscriber leaves.

What crosses the wire: the input and consumer's contract description, the
provider's shape (variant and members), method arguments and results, and
subscribed state. State starts with a **snapshot**, the whole current value;
subsequent **deltas** describe changes. Rebinds and reloads can send a
`reset`, a fresh whole value. Functions, resource connections, and cell
instances do not cross the wire.

The deliberate bad argument rejects with `invalid`. Remote arguments,
results, and outgoing state are validated at the provider boundary. Local
methods do not get per-call schema validation; they still need app-level checks.
`dev: true` additionally checks cell writes while developing.

> **Tip:** Replace `memoryLinkPair` with `webSocketLink` for a WebSocket or
> `ipcLink` for a child-process IPC channel; object contracts stay the same.
> Those adapters wrap an existing connection, not an authenticator. Configure
> `accept` with an authenticated principal. A browser is `kind: "client"`;
> a trusted child host is accepted with `kind: "host"` and its configured name.

## 7. React to changes and run background work

Not all work comes from method calls. The app may update an activity indicator
when rows change, or run a background reminder. A **listener** reacts to an
observable source. A **task** is background execution owned by an object,
which is aborted when the object is disposed or its code is reloaded.

Our activity object mirrors the row count. Its task inserts a sample todo,
then waits for shutdown. The promises make those events deterministic in a
test; they are not stored application state.

<!-- example:07 -->
```ts
const Activity = local("tutorial.activity", {
	version: 1,
	input: Type.Object({}),
	members: { seen: Type.Number() },
});
const host = createHost();
host.serve(TodoStore, todoFactory);
const observed = Promise.withResolvers<void>();
const seeded = Promise.withResolvers<void>();
const stopped = Promise.withResolvers<void>();
host.serve(Activity, (_input, _principal, self) => {
	const todos = self.get(TodoStore, { list: "family" });
	const state = self.state({ seen: cell(Type.Number(), 0) });
	self.listen({
		rows: listener(todos.rows, (rows, ctx) => {
			state.seen.replace(ctx, rows?.length ?? 0);
			if (rows?.length === 1) observed.resolve();
		}),
	});
	self.tasks({
		seed: async (ctx) => {
			await todos.add({ text: "Review the list" }, ctx);
			seeded.resolve();
			await new Promise<void>((resolve) => {
				if (ctx.signal.aborted) resolve();
				else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
			});
			stopped.resolve();
		},
	});
	return { seen: state.seen };
});
const activity = host.get(Activity, {});
await activity.ready;
await Promise.all([seeded.promise, observed.promise]);
assert.equal(activity.seen.value, 1);
activity.release();
await stopped.promise;
```

The final `seen` is `1`. Each listener event receives a fresh root's
`ctx`; its write belongs to that short call tree. A task is not one enormous
root: Chord method calls made with its task context start fresh short roots.
We pass that context into `todos.add` so cancellation follows the task.
Releasing the activity handle aborts its task and resolves `stopped`.

Listeners can also subscribe to a resource's event stream with
`listener(resource, select, fn)`: `select` gets the opened resource and
returns something with `subscribe`. Kept subscriptions survive reload while
the resource and selector remain unchanged; the callback switches to new code.
A selector that captures changing configuration should get a new listener name.

> **Why:** Do not wait for a person, sleep for minutes, or run an endless loop
> inside a method. That pins a root and can block state migration. Store a
> pending request in a cell and answer in another call, or use a task that obeys
> `ctx.signal`. Never retain a completed method's `ctx` for background work.

## 8. Package features as plugins

Now a plugin can contribute a menu action without editing a central switch.
A **registry** is a named table of contributions. A **facet** declares what a
plugin serves on one kind of host. A plugin can have server, worker, and browser
facets, each installing that part of the feature.

Registrations belong to eager objects: **eager** means the host creates and
holds the object at startup, even if no screen asks for it. That keeps our menu
contribution present. Lazy objects still activate only when held.

<!-- example:08 -->
```ts
const Actions = defineRegistry<(ctx: Ctx) => Promise<number>>("tutorial.actions");
const Menu = local("tutorial.menu", { version: 1, input: Type.Object({}) });
let click: (() => Promise<number>) | undefined;
const storeFacet: Facet = {
	name: "todo-store",
	...defineFacet((api) => api.serve(TodoStore, todoFactory)),
};
const menuFacet: Facet = {
	name: "todo-menu",
	...defineFacet(
		(api) => {
			api.serve(
				Menu,
				(_input, _principal, self) => {
					const todos = self.get(TodoStore, { list: "family" });
					self.register(Actions, {
						addSample: async (ctx) => {
							await todos.add({ text: "Try plugins" }, ctx);
							return todos.openCount.value!;
						},
					});
					return {};
				},
				{ eager: true },
			);
			click = () => api.root((ctx) => api.registry(Actions).get("addSample", ctx)!(ctx));
		},
		{ uses: [TodoStore] },
	),
};
const host = createHost();
await host.load([menuFacet, storeFacet], { awaitEager: false });
await host.ready();
assert.equal(await click!(), 1);
assert.equal(host.registry(Actions).table().size, 1);
```

Clicking returns `1`, and the registry has one entry. The menu's dependency
can come from a later facet in the load batch: `load` installs the whole
batch before waiting for eager activation. The facet declares `uses` so
reload can also check the contract it consumes.

The facet API supplies `serve`, `name`, `root`, and `registry`.
Our ordinary UI callback uses its saved `api.root`, not a process-global
host. Looking up a registry entry with `ctx` uses the table belonging to that
root's code version. Without `ctx`, lookup uses the current table. Duplicate
keys fail by default; `subscribe` can bridge tables to an imperative consumer.

Normally use `await host.load(facets)` (or `await host.install(facet)`),
which waits for those eager objects. This example explicitly defers that barrier
with `awaitEager: false`, then awaits `host.ready()`. That waits for a
snapshot of the host's eager holds, not for task completion or later loads.
Failures reject the readiness promise; abandoning startup requires closing the
host, because installation is not a rollback transaction.

> **Tip:** Use deferred readiness only when needed. A worker may have to await
> an independent local bootstrap handle, announce control readiness so its
> parent admits its link, and only then await `host.ready()`. Waiting for
> upstream-dependent eager objects before admission would deadlock.

For real plugin files, default-export `defineFacet(...)`. Node hosts configure
`createHost({ loader: nodeLoader })`, with `nodeLoader` imported from
`@earendil-works/chord/node`, then pass module URLs to `load` and `reload`.
The in-memory facet objects here avoid filesystem setup. Built-in facets are
trusted in-process code, not a sandbox; the current Node loader keeps old module
copies in memory, so repeated loading has that limitation.

## 9. Change running code without losing the list

A handle is useful precisely because callers keep it while implementations
change. An **epoch** identifies one committed set of code and registry tables.
A root keeps the epoch it started with. New roots use the latest one.

### Compatible code change: no waiting

Give the same named facet a new factory. It changes the label but keeps the
cell declarations. This test deliberately pauses one caller to show what an
old root sees; application methods should not pause like this.

<!-- example:09-compatible -->
```ts
const host = createHost();
const facet = (label: string): Facet => ({
	name: "todos",
	setup: (api) =>
		api.serve(TodoStore, (input, principal, self) => ({
			...todoFactory(input, principal, self),
			label: () => label,
		})),
});
await host.load([facet("Original")]);
const todos = host.get(TodoStore, { list: "family" });
await todos.add({ text: "Buy milk" });
const entered = Promise.withResolvers<void>();
const resume = Promise.withResolvers<void>();
const oldRoot = host.root(async (ctx) => {
	const first = await todos.label(null, ctx);
	entered.resolve();
	await resume.promise; // Test-only pause: pin an old caller during reload.
	return [first, await todos.label(null, ctx)];
});
await entered.promise;
const compatible = await host.reload([facet("Updated")]);
assert.deepEqual(compatible.gated, []);
assert.equal(await todos.label(null), "Updated");
resume.resolve();
assert.deepEqual(await oldRoot, ["Original", "Original"]);
assert.equal(todos.rows.value?.[0]?.text, "Buy milk");
```

Reload commits while the old root is paused: `gated` is empty. New calls see
`"Updated"`; the resumed old root sees `"Original"` twice. The milk row
survives. Compatible code changes do not wait for that old root to finish.

### State change: bump its version and migrate

Suppose a new policy converts existing todo text to uppercase. The schema is
unchanged, but the data's meaning changes. We still bump the **state version**.
This version belongs to stored cells, independently of the contract version.
A **migration** converts an old cell value to the new representation.

<!-- example:09-migrate -->
```ts
const events: string[] = [];
const stopEvents = todos.rows.events((event) => events.push(event.type));
const migrated = await host.reload([
	{
		name: "todos",
		setup: (api) =>
			api.serve(TodoStore, todoFactory, {
				state: {
					version: 2,
					migrate: {
						rows: (old, from) => {
							assert.equal(from, 1);
							return (old as Static<typeof Rows>).map((todo) => ({ ...todo, text: todo.text.toUpperCase() }));
						},
					},
				},
			}),
	},
]);
assert.equal(migrated.gated.length, 1);
assert.deepEqual(todos.rows.value, [{ text: "BUY MILK", done: false }]);
assert.deepEqual(events, ["snap", "reset"]);
stopEvents();
```

The migration receives the old rows and their state version, `1`. It returns
new rows; the handle now reads `[{ text: "BUY MILK", done: false }]`.
Subscribers get a `reset` event containing the migrated value. The event
assertion sees an initial `snap`, then that `reset`.
One record is gated. A **gate** waits for calls already inside that record to
finish before migrating a private copy, validating it, and committing. Old
roots that had not entered it cannot later use old code over migrated data:
they get `upgrade_conflict` and should retry in a new root.

Changing a cell's schema also requires a state-version bump and a migration
whose result fits the new schema. A change of meaning with the same schema,
like this example, cannot be detected automatically. Real migrations must
handle each stored version they support, not assume every installation is
exactly one version behind.

### Contract change: keep an adapter for old callers

Rename `label` to `heading`. That is a breaking contract change, so use
contract version 2. The provider's `accepts[1]` adapter builds the behavior
that version-1 consumers still expect.

<!-- example:09-contract -->
```ts
// Remove label from the new provider's contract: it is now called heading.
const { label: _label, ...members } = TodoStore.def.members;
const RenamedStore = local("tutorial.todos", {
	version: 2,
	input: TodoStore.def.input,
	members: { ...members, heading: method(Type.Null(), Type.String()) },
});
await host.reload([
	{
		name: "todos",
		setup: (api) =>
			api.serve(
				RenamedStore,
				(input, principal, self) => {
					const { label, ...behavior } = todoFactory(input, principal, self);
					return { ...behavior, heading: label };
				},
				{
					state: { version: 2 },
					accepts: {
						1: (current) => ({ ...current, label: current.heading }),
					},
				},
			),
	},
]);
assert.equal(await todos.label(null), "Todos for family");
const newer = host.get(RenamedStore, { list: "family" });
assert.equal(await newer.heading(null), "Todos for family");
assert.equal(todos.rows.value?.[0]?.text, "BUY MILK");
```

The old handle's `label` and the new handle's `heading` both return
`"Todos for family"`. Both still reach the migrated rows. The adapter maps
behaviors, not handles; forwarding the existing method preserves its context.
We keep state version 2 here so this code-only change does not repeat migration.

> **Why:** Contract versions protect callers; state versions protect stored
> data; resource revisions control reopening. Do not use one number for all
> three. Additive compatible contracts can keep their version; breaking shape
> or meaning changes need a contract bump and adapters for old consumers.
> Reload prepares candidates first; preparation failure leaves the old code
> running. A migration gate that misses its deadline aborts rather than
> switching data underneath active old code.

## 10. Test the objects, not a whole deployment

Most behavior needs only a bare host. Use real factories for state tests, and a
fake facet when you want to test delegation without a real database or service.
Here the fake records what the editing view sends to the store.

<!-- example:10 -->
```ts
const host = createHost({ dev: true });
const received: string[] = [];
const fake: Facet = {
	name: "fake-store",
	...defineFacet((api: FacetApi) => {
		api.serve(TodoStore, (input, principal, self) => ({
			...todoFactory(input, principal, self),
			add: ({ text }) => {
				received.push(text);
				return null;
			},
		}));
	}),
};
await host.load([fake]);
serveViews(host);
const owner = host.get(Todos, { list: "family" }, { principal: "owner" });
await owner.add({ text: "Test delegation" });
assert.deepEqual(received, ["Test delegation"]);
await assert.rejects(owner.add({ text: "" }), (error) => isChordError(error, "invalid"));
owner.release();
await assert.rejects(owner.add({ text: "Too late" }), (error) => isChordError(error, "released"));
```

The fake received `["Test delegation"]`. Empty text failed before reaching
the fake. The released handle rejects further calls with `released`.
`isChordError(error, code)` checks a stable error code; avoid testing only a
message's wording.

Our other tests exercise the real cells (section 3), resource cleanup (4),
principal variants (5), a client over a memory link (6), and callers held through
reload (9). For remote state tests, await the value you need, not just
`handle.ready`. Always unsubscribe and close hosts; leaked holds can hide
lifetime bugs or leave background tasks running.

> **Tip:** A fake must honor the contract it serves. This fake delegates all
> ordinary members to `todoFactory` and replaces only `add`; it deliberately
> records calls rather than updating rows. Do not confuse that with persistence.

## 11. Keep these habits

A temporary call handle should not accidentally become a permanent hold. A
screen should not lose its data merely because a button click finishes. Use
`ctx.get` for the first lifetime and `host.get` for the second.

<!-- example:11 -->
```ts
const host = createHost();
host.serve(TodoStore, todoFactory);
const screen = host.get(TodoStore, { list: "family" });
await screen.ready;
await host.root(async (ctx) => {
	const temporary = ctx.get(TodoStore, { list: "family" });
	await temporary.add({ text: "Keep roots short" }, ctx);
}); // The temporary handle is released here; screen still holds the store.
assert.equal(screen.openCount.value, 1);
screen.release(); // No hold remains; without persistence, disposal loses these rows.
```

The screen still sees count `1` after the root finishes, because it owns a
separate hold. When the screen releases, no hold remains. This tutorial's cells
are in memory: reload preserves a live record, but disposal or process restart
loses its rows. Real persistence belongs in a database resource, with an
explicit load/save policy.

### Checklist and common mistakes

- Keep reloadable state in cells, not closure variables: factories rerun.
- Change drafts, not published values: mutation outside cells bypasses updates.
- Use `change` for field edits and `replace` for owned snapshots: replacing
  can erase fields your code does not know about.
- Declare dependencies in a synchronous factory, not during methods: activation
  and reload need a complete declaration list.
- Use `ctx.get` for temporary method dependencies: their holds end with the call.
- Pass `ctx` into nested calls: cancellation and code versions must stay together.
- Keep roots short and tasks cancellable: migration and shutdown need work to settle.
- Check grants and arguments, not just variants: available methods are not a full policy.
- Stamp principals at trusted ingress, not from client payloads: names are not identities.
- Subscribe before expecting remote state: readiness is not snapshot hydration.
- Release handles and unsubscribe: otherwise unused objects remain held or observed.
- Bump state versions, contract versions, and resource revisions for their own changes:
  each protects a different boundary.
- Await eager readiness before reporting startup success: declared is not yet live.
- Keep hold dependencies acyclic: an object cannot wait for itself through another object.

### Imports and running the examples

These are the shared imports from `test/tutorial.test.ts`. The relative
path is correct from that test directory; applications import the same names
from `@earendil-works/chord`. `assert` expresses expected values; `it` and
`onTestFinished` come from the test runner; `readFileSync` is used by the
tutorial's source-matching check, not by the application.

<!-- example:imports -->
```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type Static, Type } from "typebox";
import { it, onTestFinished } from "vitest";
import {
	type Ctx,
	cell,
	createHost,
	defineFacet,
	defineRegistry,
	derivation,
	type Facet,
	type FacetApi,
	type Factory,
	forbidden,
	type Host,
	hostPrincipal,
	invalid,
	isChordError,
	listener,
	local,
	memoryLinkPair,
	method,
	opaque,
	remote,
	resource,
} from "../src/index.ts";
```

From `packages/chord`, run:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/tutorial.test.ts
```

There is one test per numbered section. Every TypeScript block is matched
against its runnable source, so changing either copy without the other fails a
test. The test harness adds teardown and drift checks; it never uses a real
database, network service, or provider API.

Next read [the usage guide](guide.md) for the API reference and
[the specification](spec.md) for compatibility, lifetime, and reload
rules, including its known limitations. If a reference disagrees with
`src`, the current implementation wins.
