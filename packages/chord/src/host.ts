import { ChildReloads, reconcileChild, runClusterReload } from "./cluster.ts";
import { type AcceptOptions, Connection, type LinkOptions, type RelayHold } from "./connection.ts";
import {
	type AnyContract,
	bind,
	type Handle,
	type InputOf,
	type LocalContract,
	type LocalDef,
	type RemoteContract,
	type RemoteDef,
} from "./contract.ts";
import { ChordError, invalid, runAll } from "./errors.ts";
import type { Link } from "./link.ts";
import { enqueue } from "./publish.ts";
import {
	CtxImpl,
	type Decls,
	type Factory,
	HandleImpl,
	type Hold,
	type HoldOwner,
	type HostCore,
	makeService,
	RecordImpl,
	type ServeOptions,
	type Service,
} from "./record.ts";
import type { Registry, RegistryTable, RegistryView } from "./registry.ts";
import { type ReloadOptions, type ReloadReport, runReload } from "./reload.ts";
import { RemoteHandle } from "./remote.ts";
import { canonicalIdentity, canonicalJson, deepEqual, normalize } from "./schema.ts";
import type { Ctx, GetOptions, Principal } from "./types.ts";
import type { Frame } from "./wire.ts";

/** The principal of in-host code. */
export const hostPrincipal: Principal = Object.freeze({ host: true });

/**
 * Registers a factory for a type. Overloaded on the contract's definition (not the contract type) so TypeScript
 * keeps literal `kind`s in factory returns.
 */
export interface Serve {
	<D extends RemoteDef>(
		type: RemoteContract<D>,
		factory: Factory<RemoteContract<D>>,
		options?: ServeOptions<RemoteContract<D>>,
	): void;
	<D extends LocalDef>(
		type: LocalContract<D>,
		factory: Factory<LocalContract<D>>,
		options?: ServeOptions<LocalContract<D>>,
	): void;
}

type AnyServe = (type: AnyContract, factory: Factory<AnyContract>, options?: ServeOptions) => void;

/**
 * What a facet's `setup` gets. `serve` registers types; `root` and `registry` give the facet's code that is not a
 * Chord method, listener or task (Durable tools and hooks, callbacks of native libraries) access to its own host,
 * so plugins never need a process-global host. Both may be kept and used after `setup` returns.
 */
export interface FacetApi {
	readonly serve: Serve;
	/** The host's name (`server`, `session:S1`, ...). */
	readonly name: string;
	/** Starts a root on the facet's host (in its current epoch at call time). */
	root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: RootOptions): Promise<T>;
	/** The facet's host's registry view (`get(key, ctx)` reads the table of `ctx.epoch`). */
	registry<V>(registry: Registry<V>): RegistryView<V>;
}

/** What a facet module exports (default export): the code that serves its types on one host kind. */
export interface FacetDefinition {
	/** Contract tokens this facet consumes; checked against providers at reload. */
	readonly uses?: readonly AnyContract[];
	setup(api: FacetApi): void;
}

/** A named facet. Modules are named by their URL; reloading a facet replaces everything it served. */
export interface Facet extends FacetDefinition {
	readonly name: string;
}

export const defineFacet = (
	setup: (api: FacetApi) => void,
	options: { readonly uses?: readonly AnyContract[] } = {},
): FacetDefinition => ({ setup, uses: options.uses });

/** Imports facet modules (fresh copies on every call) and names them by module URL. */
export type FacetLoader = (modules: readonly (string | URL)[]) => Promise<Facet[]>;

/** A facet object, or a module (path or URL) whose default export is a FacetDefinition. */
export type PluginRef = Facet | string | URL;

const isFacet = (ref: PluginRef): ref is Facet => typeof ref === "object" && !(ref instanceof URL);

export interface HostOptions {
	readonly name?: string;
	/** Maps a principal to its record key (should include connection provenance and grant revision). */
	readonly principalKey?: (principal: Principal) => string;
	/** Validates every cell write and exposed state value against its schemas. */
	readonly dev?: boolean;
	/** Errors from background work (disposal, listeners, tasks). Defaults to console.error. */
	readonly onError?: (error: unknown) => void;
	/** Needed for `load`/`reload` with modules; `nodeLoader` from loader.ts in Node. */
	readonly loader?: FacetLoader;
	/** `client` (browser): never a reload participant, never carries roots or epochs. Default `host`. */
	readonly kind?: "host" | "client";
	/** The link to this host's parent (server). Can also be set later with `connect`. */
	readonly upstream?: Link;
	readonly upstreamOptions?: LinkOptions;
}

/** Where requests for hosts named `prefix…` go (on the server). */
export interface Route {
	/** Checked before resolving (or spawning) and again after: grants may change meanwhile. */
	authorize(principal: Principal, hostName: string): boolean | Promise<boolean>;
	/** A link to the host, spawned if needed. */
	resolve(hostName: string): Promise<Link>;
	/** Principal the resolved host acts as when it calls back (default `{ host: hostName }`). */
	readonly principal?: (hostName: string) => Principal;
}

/** `invalidatePrincipal` matches: a predicate (this host only), or a pattern (fields that must be equal; propagates). */
export type PrincipalMatch = ((principal: Principal) => boolean) | Readonly<Record<string, unknown>>;

export interface RootOptions {
	readonly principal?: Principal;
	readonly signal?: AbortSignal;
	/** Start the root in a retained epoch (links carry epochs). Defaults to the current epoch. */
	readonly epoch?: number;
}

export interface LoadOptions {
	/** Await eager activation (default true). False starts it but leaves readiness to `host.ready()`. */
	readonly awaitEager?: boolean;
}

export interface Host {
	readonly name: string;
	readonly epoch: number;
	readonly previousEpoch: number | undefined;
	readonly serve: Serve;
	/** Installs synchronously, then awaits this facet's eager objects unless `awaitEager` is false. */
	install(facet: Facet, options?: LoadOptions): Promise<void>;
	/** Installs all facets before awaiting their eager objects; lazy objects stay lazy. */
	load(plugins: readonly PluginRef[], options?: LoadOptions): Promise<void>;
	/** Awaits the eager holds present at call time, including those started by `serve` or deferred loads. */
	ready(): Promise<void>;
	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C>;
	root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: RootOptions): Promise<T>;
	registry<V>(registry: Registry<V>): RegistryView<V>;
	/**
	 * Force-disposes every record whose principal matches (never the host principal), re-stamps or closes matching
	 * links, and propagates pattern matches to child hosts.
	 */
	invalidatePrincipal(match: PrincipalMatch): Promise<void>;
	/** Accepts a child link (a worker or a browser); requests on it act as `options.principal`. */
	accept(link: Link, options: AcceptOptions): void;
	/** Sets (or replaces, after a reconnect) the link to this host's parent; remote handles re-hold over it. */
	connect(link: Link, options?: LinkOptions): void;
	route(prefix: string, route: Route): void;
	/** Reloads the given facets (modules are re-imported); facets not listed keep running unchanged. */
	reload(plugins: readonly PluginRef[], options?: ReloadOptions): Promise<ReloadReport>;
	close(): Promise<void>;
}

export interface EpochState {
	readonly id: number;
	readonly services: Map<string, Service>;
	tables: ReadonlyMap<string, RegistryTable<unknown>>;
	/** Running roots with the number of their calls running here. */
	readonly roots: Map<string, number>;
}

const EMPTY_TABLE: RegistryTable<never> = new Map<string, never>();

export function createHost(options: HostOptions = {}): Host {
	return new HostImpl(options);
}

export class HostImpl implements Host, HostCore {
	readonly name: string;
	readonly dev: boolean;
	readonly principal: Principal = hostPrincipal;
	inFactory = 0;
	failed: unknown;
	readonly records = new Map<string, RecordImpl>();
	readonly epochs = new Map<number, EpochState>();
	readonly facets = new Map<string, Facet>();
	readonly eager = new Map<string, Hold>();
	readonly kind: "host" | "client";
	readonly connections = new Set<Connection>();
	upstream: Connection | undefined;
	/** Remote handles this host holds (re-held after an upstream reconnect). */
	readonly remotes = new Set<RemoteHandle>();
	readonly #routes = new Map<string, Route>();
	readonly #childReloads = new ChildReloads(this);
	/** Child facet modules by host-name prefix, from every committed cluster reload (for reconciling children). */
	remoteModules: Record<string, string[]> = {};
	/** Removal tombstones also reconcile children that connected during a transaction. */
	remoteRemoved: Record<string, string[]> = {};
	/** Highest epoch the parent has retired. */
	#retireAllowed = 0;
	/** Roots that came over a link, by the link they came from. */
	/** Foreign roots (started on another host), by the links they came over. */
	readonly #foreign = new Map<string, Set<Connection>>();
	/** Roots started on this host that have not ended. */
	readonly #local = new Set<string>();
	readonly #incarnation = Math.random().toString(36).slice(2, 8);
	/** Links each root's calls went out on. */
	readonly #rootLinks = new Map<string, Set<Connection>>();
	current: EpochState;
	previous: EpochState | undefined;
	/** The epoch a running reload will commit; new types activated during prepare install their behavior for it. */
	pending: EpochState | undefined;
	/** Activations of these types wait (reload gate). */
	/** Types behind a reload gate: new records of these types are rejected `upgrade_conflict` until commit/abort. */
	gating: ReadonlySet<string> | undefined;
	reloading = false;
	retired: () => void = () => {};
	readonly #principalKey: (principal: Principal) => string;
	readonly #onError: (error: unknown) => void;
	readonly #loader: FacetLoader | undefined;
	readonly #dying = new Map<string, RecordImpl>();
	readonly #touches = new Map<string, Set<RecordImpl>>();
	readonly #order = new Map<string, Map<string, number>>();
	readonly #subscribers = new Map<string, Set<(table: RegistryTable<unknown>, epoch: number) => void>>();
	#epochSeq = 1;
	#rootSeq = 0;

	constructor(options: HostOptions) {
		this.name = options.name ?? "host";
		this.dev = options.dev ?? false;
		this.#principalKey = options.principalKey ?? canonicalJson;
		this.#onError = options.onError ?? ((error) => console.error("chord:", error));
		this.#loader = options.loader;
		this.current = { id: this.#epochSeq, services: new Map(), tables: new Map(), roots: new Map() };
		this.epochs.set(this.current.id, this.current);
		this.kind = options.kind ?? "host";
		if (options.upstream !== undefined) this.connect(options.upstream, options.upstreamOptions);
	}

	get epoch(): number {
		return this.current.id;
	}

	get previousEpoch(): number | undefined {
		return this.previous?.id;
	}

	/** Allocates the next epoch id, or adopts one issued by the coordinating server. */
	nextEpochId(given?: number): number {
		if (given !== undefined && given <= this.current.id)
			throw new Error(`epoch ${given} is not newer than ${this.current.id}`);
		this.#epochSeq = given ?? this.#epochSeq + 1;
		return this.#epochSeq;
	}

	report(error: unknown): void {
		this.#onError(error);
	}

	// ─── serving ───

	readonly serve: Serve = ((type, factory, options = {}) => {
		if (this.reloading) throw new Error("host.serve during a reload; serve from a facet passed to reload()");
		this.serveInto(this.current.services, makeService(type, factory, options, ""));
		if (options.eager) this.startEager(this.current.services.get(type.name)!);
	}) satisfies AnyServe as Serve;

	install(facet: Facet, options: LoadOptions = {}): Promise<void> {
		if (this.reloading) throw new Error("host.install during a reload");
		if (this.facets.has(facet.name)) throw new Error(`facet ${facet.name} is already installed; use reload()`);
		const added: Service[] = [];
		facet.setup(
			this.facetApi(((type, factory, options = {}) => {
				const service = makeService(type, factory, options, facet.name);
				this.serveInto(this.current.services, service);
				added.push(service);
			}) satisfies AnyServe as Serve),
		);
		this.facets.set(facet.name, facet);
		const holds = added.filter((service) => service.options.eager).map((service) => this.startEager(service));
		return options.awaitEager === false ? Promise.resolve() : this.#eagerReady(holds);
	}

	async load(plugins: readonly PluginRef[], options: LoadOptions = {}): Promise<void> {
		const facets = await this.resolve(plugins);
		// No await between installs: an eager factory may consume a type served by a later facet.
		await Promise.all(facets.map((facet) => this.install(facet, options)));
	}

	ready(): Promise<void> {
		return this.#eagerReady(this.eager.values());
	}

	#eagerReady(holds: Iterable<Hold>): Promise<void> {
		const ready = Promise.all([...holds].map((hold) => hold.ready)).then(() => {});
		// Ignoring install's return still reports through onError without an unhandled rejection.
		ready.catch(() => {});
		return ready;
	}

	/** Turns plugin references into facets, importing modules through the loader. */
	async resolve(plugins: readonly PluginRef[]): Promise<Facet[]> {
		const modules = plugins.filter((ref): ref is string | URL => !isFacet(ref));
		if (modules.length > 0 && this.#loader === undefined) {
			throw new Error(
				"loading modules needs createHost({ loader }), e.g. nodeLoader from @earendil-works/chord/node",
			);
		}
		const loaded = modules.length > 0 && this.#loader !== undefined ? await this.#loader(modules) : [];
		return plugins.map((ref) => (isFacet(ref) ? ref : loaded.shift()!));
	}

	facetApi(serve: Serve): FacetApi {
		return {
			serve,
			name: this.name,
			root: (fn, options) => this.root(fn, options),
			registry: (registry) => this.registry(registry),
		};
	}

	serveInto(services: Map<string, Service>, service: Service): void {
		if (services.has(service.contract.name)) throw new Error(`${service.contract.name} is already served`);
		services.set(service.contract.name, service);
	}

	startEager(service: Service): Hold {
		const eager = service.options.eager;
		const input = typeof eager === "object" ? eager.input : {};
		const handle = this.acquire(service.contract, input, undefined, "host");
		this.eager.set(service.contract.name, handle);
		handle.ready.catch((error: unknown) => this.report(error));
		return handle;
	}

	// ─── HostCore ───

	currentEpoch(): number {
		return this.current.id;
	}

	hasEpoch(epoch: number): boolean {
		return this.epochs.has(epoch);
	}

	*retainedEpochs(): Iterable<readonly [number, ReadonlyMap<string, Service>]> {
		for (const [id, state] of this.epochs) yield [id, state.services];
		if (this.pending !== undefined) yield [this.pending.id, this.pending.services];
	}

	pendingEpoch(): number | undefined {
		return this.pending?.id;
	}

	/** The current code for a type; a type a running reload adds is served from the pending epoch. */
	service(typeName: string): Service | undefined {
		return this.current.services.get(typeName) ?? this.pending?.services.get(typeName);
	}

	addressOf(type: AnyContract, input: unknown, principal: Principal, at?: string, candidate = false): string {
		if (at !== undefined && at !== this.name)
			return remoteAddress(at, type, input, principal === this.principal ? undefined : principal);
		const service = this.#bindingService(type.name, candidate);
		if (service === undefined) throw unknownType(type.name, this.name);
		const normalized = normalize(service.contract.input, input, `${type.name} input`);
		return this.#address(service, normalized, principal);
	}

	#address(service: Service, normalized: unknown, principal: Principal): string {
		const key = principal === this.principal ? "host" : `p:${this.#principalKey(principal)}`;
		return `${service.contract.name}\u0000${canonicalIdentity(service.contract.input, normalized)}\u0000${key}`;
	}

	acquire(
		type: AnyContract,
		input: unknown,
		options: GetOptions | undefined,
		owner: HoldOwner,
		from?: RecordImpl,
		candidate = false,
	): Hold {
		if (options?.at !== undefined && options.at !== this.name)
			return this.#acquireRemote(type, input, options, owner);
		const service = this.#bindingService(type.name, candidate);
		if (service === undefined) throw unknownType(type.name, this.name);
		bind(service.contract, service.options.accepts, type);
		const principal = options?.principal ?? this.principal;
		const normalized = normalize(service.contract.input, input, `${type.name} input`);
		const address = this.#address(service, normalized, principal);
		let record = this.records.get(address);
		if (from !== undefined && record !== undefined && (record === from || reaches(record, from))) {
			throw invalid("cycle", `${from.address} -> ${address} would create a hold cycle`);
		}
		if (record === undefined) {
			if (this.gating?.has(type.name)) {
				throw new ChordError("upgrade_conflict", `${type.name} is being upgraded; retry`, { reason: "gate" });
			}
			const dying = this.#dying.get(address);
			if (dying?.status === "disposed") this.#dying.delete(address);
			record = new RecordImpl(this, {
				address,
				typeName: type.name,
				input: normalized,
				principal,
				eager:
					service.options.eager !== undefined && service.options.eager !== false && principal === this.principal,
			});
			this.records.set(address, record);
			// A new record for an address still being disposed waits for that cleanup (exclusive resources).
			record.start(dying?.status === "disposing" ? dying.dispose(false) : undefined);
		}
		const handle = new HandleImpl(record, type, owner);
		record.addHold(handle);
		return handle;
	}

	forget(record: RecordImpl): void {
		if (this.records.get(record.address) === record) this.records.delete(record.address);
		if (record.status === "disposing") this.#dying.set(record.address, record);
	}

	touch(rootId: string, record: RecordImpl): void {
		let touched = this.#touches.get(rootId);
		if (touched === undefined) {
			touched = new Set();
			this.#touches.set(rootId, touched);
		}
		touched.add(record);
	}

	// ─── roots ───

	async root<T>(fn: (ctx: Ctx) => T | Promise<T>, options: RootOptions = {}): Promise<T> {
		// The incarnation keeps root ids unique across restarts of a host with the same name.
		const rootId = `${this.name}#${this.#incarnation}:${++this.#rootSeq}`;
		this.#local.add(rootId);
		return this.joinRoot(rootId, options.epoch ?? this.current.id, fn, options);
	}

	/**
	 * Runs `fn` inside root `rootId` of `epoch`. A root counts as running here (for retirement) while any of its calls
	 * runs here. A root that started here ends when its last call here settles, even if it went out and came back
	 * over a link meanwhile. A foreign root (started elsewhere, arriving `from` a link) keeps its leases on records
	 * until every link it came over announced its end (`root_end`) or closed, so its re-entry stays grandfathered.
	 */
	async joinRoot<T>(
		rootId: string,
		epochId: number,
		fn: (ctx: Ctx) => T | Promise<T>,
		options: { readonly principal?: Principal; readonly signal?: AbortSignal; readonly from?: Connection } = {},
	): Promise<T> {
		const epoch = this.epochs.get(epochId);
		if (epoch === undefined) {
			this.#local.delete(rootId);
			throw new ChordError("superseded", `epoch ${epochId} is not retained by ${this.name}`);
		}
		if (options.from !== undefined && !this.#local.has(rootId)) {
			let links = this.#foreign.get(rootId);
			if (links === undefined) {
				links = new Set();
				this.#foreign.set(rootId, links);
			}
			links.add(options.from);
		}
		epoch.roots.set(rootId, (epoch.roots.get(rootId) ?? 0) + 1);
		const ctx = new CtxImpl(this, {
			signal: options.signal ?? new AbortController().signal,
			rootId,
			epoch: epoch.id,
			principal: options.principal ?? this.principal,
		});
		try {
			return await fn(ctx);
		} finally {
			ctx.close();
			const count = (epoch.roots.get(rootId) ?? 1) - 1;
			if (count > 0) epoch.roots.set(rootId, count);
			else {
				epoch.roots.delete(rootId);
				if (!this.#foreign.has(rootId)) this.endRoot(rootId);
				this.maybeRetire();
			}
		}
	}

	/** Remembers that calls of `rootId` went out on `connection`, which must hear when the root ends. */
	rootSent(rootId: string, connection: Connection): void {
		let links = this.#rootLinks.get(rootId);
		if (links === undefined) {
			links = new Set();
			this.#rootLinks.set(rootId, links);
		}
		links.add(connection);
	}

	/** A root ended (here, or announced by its origin): end its leases and tell the links it went out on. */
	endRoot(rootId: string): void {
		this.#local.delete(rootId);
		this.#foreign.delete(rootId);
		for (const record of this.#touches.get(rootId) ?? []) record.rootEnded(rootId);
		this.#touches.delete(rootId);
		for (const connection of this.#rootLinks.get(rootId) ?? []) connection.send({ t: "root_end", rootId });
		this.#rootLinks.delete(rootId);
	}

	/**
	 * `from` announced the end of a foreign root (or closed). Honored only if the root came over `from`: a peer cannot
	 * end leases of roots it never carried. The root ends when no link that brought it remains.
	 */
	foreignRootEnded(rootId: string, from: Connection): void {
		const links = this.#foreign.get(rootId);
		if (links === undefined || !links.delete(from) || links.size > 0) return;
		const running = [...this.epochs.values()].some((epoch) => epoch.roots.has(rootId));
		// Still running here (a call in flight): the lease ends when it settles.
		if (running) this.#foreign.delete(rootId);
		else this.endRoot(rootId);
	}

	/**
	 * Retires the previous epoch once no local roots of it remain. A child also waits for its parent to retire it:
	 * roots span hosts, and an old root on the server may still call in.
	 */
	maybeRetire(): void {
		const previous = this.previous;
		if (previous === undefined || previous.roots.size > 0) return;
		if (this.kind !== "client" && this.upstream !== undefined && previous.id > this.#retireAllowed) return;
		this.retire();
	}

	allowRetire(epoch: number): void {
		this.#retireAllowed = Math.max(this.#retireAllowed, epoch);
		this.maybeRetire();
	}

	/** Drops the previous epoch: its behaviors and the declarations only it used. */
	retire(): void {
		const previous = this.previous;
		if (previous === undefined) return;
		this.previous = undefined;
		this.epochs.delete(previous.id);
		for (const record of [...this.records.values()]) this.retireBehavior(record, previous.id);
		for (const connection of this.connections) {
			if (connection.role === "downstream" && connection.peer?.kind === "host")
				connection.send({ t: "retire", epoch: previous.id });
		}
		this.retired();
	}

	/**
	 * Drops a record's behavior for `epoch` and what only that behavior declared, in disposal order: resources close
	 * (reverse open order) before its holds are released.
	 */
	retireBehavior(record: RecordImpl, epoch: number): void {
		const installed = record.behaviors.get(epoch);
		record.behaviors.delete(epoch);
		if (installed === undefined || installed.decls === record.decls) return;
		const kept = record.allDecls();
		const keep = <T>(pick: (decls: Decls) => Iterable<T>): Set<T> =>
			new Set([...kept].flatMap((decls) => [...pick(decls)]));
		const holds = keep((decls) => decls.holds.values());
		const resources = keep((decls) => decls.resources.values());
		const derives = keep((decls) => decls.derives.values());
		for (const derived of installed.decls.derives.values()) if (!derives.has(derived)) derived.detach();
		const closing = [...installed.decls.resources.values()]
			.filter((resource) => !resources.has(resource))
			.sort((a, b) => record.openOrder.indexOf(b) - record.openOrder.indexOf(a));
		const releasing = [...installed.decls.holds.values()].filter((hold) => !holds.has(hold));
		record.refreshSchemas();
		runAll(
			[
				...closing.map((resource) => () => resource.close(record.openOrder)),
				...releasing.map((hold) => () => hold.release()),
			],
			`${record.address}: retiring epoch ${epoch} failed`,
		).catch((error: unknown) => this.report(error));
	}

	// ─── registries ───

	registry<V>(registry: Registry<V>): RegistryView<V> {
		const table = (ctx?: Ctx): RegistryTable<V> => {
			const epoch = ctx === undefined ? this.current : this.epochs.get(ctx.epoch);
			if (epoch === undefined) throw new ChordError("superseded", `epoch ${ctx?.epoch} is retired`);
			return (epoch.tables.get(registry.name) ?? EMPTY_TABLE) as RegistryTable<V>;
		};
		return {
			table,
			get: (key, ctx) => table(ctx).get(key),
			subscribe: (listener) => {
				let set = this.#subscribers.get(registry.name);
				if (set === undefined) {
					set = new Set();
					this.#subscribers.set(registry.name, set);
				}
				const wrapped = listener as (table: RegistryTable<unknown>, epoch: number) => void;
				set.add(wrapped);
				wrapped(table(), this.current.id);
				return () => set.delete(wrapped);
			},
		};
	}

	/** Builds registry tables from (record, declarations) pairs. Throws registry_conflict. */
	buildTables(entries: Iterable<readonly [RecordImpl, Decls]>): Map<string, RegistryTable<unknown>> {
		const byRegistry = new Map<string, Map<string, { value: unknown; record: RecordImpl }>>();
		for (const [record, decls] of entries) {
			for (const { registry, key, value } of decls.registrations.values()) {
				let entries = byRegistry.get(registry.name);
				if (entries === undefined) {
					entries = new Map();
					byRegistry.set(registry.name, entries);
				}
				const existing = entries.get(key);
				if (existing !== undefined && existing.record !== record && registry.conflict === "error") {
					throw invalid(
						"registry_conflict",
						`${registry.name}: ${key} registered by ${existing.record.address} and ${record.address}`,
					);
				}
				entries.set(key, { value, record });
				let order = this.#order.get(registry.name);
				if (order === undefined) {
					order = new Map();
					this.#order.set(registry.name, order);
				}
				if (!order.has(key)) order.set(key, order.size);
			}
		}
		const tables = new Map<string, RegistryTable<unknown>>();
		for (const [name, entries] of byRegistry) {
			const order = this.#order.get(name)!;
			const sorted = [...entries].sort(([a], [b]) => order.get(a)! - order.get(b)!);
			tables.set(name, new Map(sorted.map(([key, entry]) => [key, entry.value])));
		}
		return tables;
	}

	/**
	 * The service a hold binds against: the current one, or for a prepare rerun (`candidate`) the running reload's
	 * pending one, so consumer and provider of a breaking change can reload in one batch.
	 */
	#bindingService(typeName: string, candidate: boolean): Service | undefined {
		return (candidate ? this.pending?.services.get(typeName) : undefined) ?? this.service(typeName);
	}

	/** Live records with their current declarations; records waiting for a reload's commit only with `candidates`. */
	liveDecls(candidates = false): [RecordImpl, Decls][] {
		return [...this.records.values()]
			.filter((record) => record.status === "live" && (candidates || !record.deferredRuntime))
			.map((record) => [record, record.decls]);
	}

	checkRegistrations(record: RecordImpl, decls: Decls): void {
		if (decls.registrations.size === 0) return;
		this.buildTables([...this.liveDecls().filter(([other]) => other !== record), [record, decls]]);
	}

	registriesChanged(including?: RecordImpl): void {
		const entries = this.liveDecls().filter(([record]) => record !== including);
		if (including !== undefined) entries.push([including, including.decls]);
		this.installTables(this.current, this.buildTables(entries));
	}

	/** A commit failed midway: from now on this host admits no work (calls fail `unavailable/host_failed`). */
	fail(error: unknown): void {
		this.failed ??= error;
		this.report(error);
	}

	/** Installs tables for `epoch`; subscribers hear about changed tables of the current epoch (all tables when `all`). */
	installTables(epoch: EpochState, tables: Map<string, RegistryTable<unknown>>, all = false): void {
		const before = epoch.tables;
		epoch.tables = tables;
		if (epoch !== this.current) return;
		for (const [name, listeners] of this.#subscribers) {
			const next = tables.get(name) ?? EMPTY_TABLE;
			if (!all && sameTable(before.get(name) ?? EMPTY_TABLE, next)) continue;
			const current = [...listeners];
			enqueue(() => {
				for (const listener of current) {
					try {
						listener(next, epoch.id);
					} catch (error) {
						this.report(error);
					}
				}
			});
		}
	}

	// ─── public API ───

	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C> {
		return this.acquire(type, input, options, "external").proxy as Handle<C>;
	}

	async invalidatePrincipal(match: PrincipalMatch): Promise<void> {
		const matches = typeof match === "function" ? match : (principal: Principal) => matchesPattern(match, principal);
		const reason = new ChordError("gone", "principal invalidated");
		// Links acting as a matching principal are re-stamped (if the acceptor can) or closed.
		for (const connection of [...this.connections]) {
			if (connection.role !== "downstream" || !matches(connection.principal)) continue;
			// Relays under the old principal close at once, including those still resolving their route.
			connection.revoke(connection.restamp?.(connection.principal));
		}
		// Patterns propagate to child hosts, which dispose their own matching records (e.g. relayed guests).
		if (typeof match !== "function") {
			for (const connection of this.connections) {
				if (connection.role === "downstream" && connection.peer.kind === "host") {
					connection.send({ t: "invalidate", pattern: match });
				}
			}
		}
		const matching = [...this.records.values()].filter(
			(record) => record.principal !== this.principal && matches(record.principal),
		);
		await disposeHoldersFirst(matching, reason, "invalidatePrincipal: disposal failed");
	}

	// ─── links ───

	accept(link: Link, options: AcceptOptions): void {
		const kind = options.kind ?? "client";
		if (kind === "host" && options.name === undefined) throw new TypeError("accepting a host link needs its name");
		this.#addConnection(link, {
			...options,
			role: "downstream",
			principal: options.principal,
			peer: { kind, name: kind === "host" ? options.name : undefined },
		});
	}

	connect(link: Link, options: LinkOptions = {}): void {
		if (this.upstream?.open) this.upstream.link.close("replaced");
		const connection = this.#addConnection(link, {
			...options,
			role: "upstream",
			principal: undefined,
			peer: { kind: "host", name: undefined },
		});
		this.upstream = connection;
		// Remote handles that lost their link re-hold over the new one; state subscribers get a reset.
		for (const handle of this.remotes) if (handle.binding === undefined) connection.hold(handle);
	}

	#addConnection(link: Link, config: ConstructorParameters<typeof Connection>[2]): Connection {
		const connection = new Connection(this, link, config);
		this.connections.add(connection);
		return connection;
	}

	route(prefix: string, route: Route): void {
		this.#routes.set(prefix, route);
	}

	/**
	 * A child host announced its epoch. In step: usable. Behind: fenced (nothing is routed to it) and reconciled by a
	 * reload of its modules to this host's epoch, never by renumbering what it runs. Ahead: impossible, refused.
	 */
	peerHello(connection: Connection, epoch: number): void {
		if (epoch === this.current.id) {
			connection.markSynced(epoch);
			return;
		}
		if (epoch > this.current.id) {
			this.report(new ChordError("invalid", `${connection.name} runs epoch ${epoch}, ahead of ${this.current.id}`));
			connection.link.close("epoch ahead of parent");
			return;
		}
		connection.peerEpoch = epoch;
		connection.fencedEpochs.add(epoch);
		reconcileChild(this, connection).catch((error: unknown) => {
			this.report(error);
			connection.link.close("reconciliation failed");
		});
	}

	connectionClosed(connection: Connection): void {
		this.connections.delete(connection);
		// Foreign roots that came over this link will never announce their end over it.
		for (const [rootId, links] of [...this.#foreign])
			if (links.has(connection)) this.foreignRootEnded(rootId, connection);
		for (const links of this.#rootLinks.values()) links.delete(connection);
		if (this.upstream === connection) {
			this.upstream = undefined;
			this.#childReloads.parentLost();
		}
	}

	forgetRemote(handle: RemoteHandle): void {
		this.remotes.delete(handle);
	}

	/** A downstream host connection by its configured name (never by what a peer announced). */
	#childNamed(name: string): Connection | undefined {
		return [...this.connections].find(
			(connection) =>
				connection.role === "downstream" && connection.peer.kind === "host" && connection.peer.name === name,
		);
	}

	#acquireRemote(type: AnyContract, input: unknown, options: GetOptions, owner: HoldOwner): Hold {
		const at = options.at!;
		if (type.scope !== "remote") throw invalid("local", `${type.name} is local and cannot be reached at ${at}`);
		const principal =
			options.principal === undefined || options.principal === this.principal ? undefined : options.principal;
		const handle = new RemoteHandle(this, {
			contract: type,
			at,
			input,
			principal,
			owner,
			address: remoteAddress(at, type, input, principal),
		});
		this.remotes.add(handle);
		const bindWhenSynced = (connection: Promise<Connection>): void => {
			connection.then(
				(target) => {
					if (handle.status === "loading" && handle.binding === undefined) target.hold(handle);
				},
				(error: unknown) => handle.gone(error),
			);
		};
		const direct = this.#childNamed(at);
		if (this.upstream !== undefined) this.upstream.hold(handle);
		else if (direct !== undefined) bindWhenSynced(direct.whenSynced().then(() => direct));
		else {
			const route = this.#routeFor(at);
			if (route === undefined) handle.gone(new ChordError("unavailable", `no route to ${at}`));
			else bindWhenSynced(this.#resolve(route, at, principal ?? this.principal));
		}
		return handle;
	}

	#routeFor(hostName: string): Route | undefined {
		let best: [string, Route] | undefined;
		for (const entry of this.#routes) {
			if (hostName.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length)) best = entry;
		}
		return best?.[1];
	}

	/** Authorize, resolve (maybe spawn), authorize again; returns the synced connection to the host. */
	async #resolve(
		route: Route,
		hostName: string,
		principal: Principal,
		still: () => boolean = () => true,
	): Promise<Connection> {
		const refuse = (): ChordError => new ChordError("forbidden", `${hostName} refused for this principal`);
		const revoked = (): ChordError => new ChordError("gone", "principal invalidated while resolving");
		if (!(await route.authorize(principal, hostName))) throw refuse();
		if (!still()) throw revoked();
		const link = await route.resolve(hostName);
		if (!still()) throw revoked();
		if (!(await route.authorize(principal, hostName))) throw refuse();
		if (!still()) throw revoked();
		let connection = [...this.connections].find((candidate) => candidate.link === link);
		connection ??= this.#addConnection(link, {
			role: "downstream",
			principal: route.principal?.(hostName) ?? { host: hostName },
			peer: { kind: "host", name: hostName },
		});
		await connection.whenSynced();
		if (!still()) throw revoked();
		return connection;
	}

	/**
	 * Relays a hold from `relay.origin` to the host it names. Relaying needs a route: it is where authorization
	 * lives. The origin's authorization generation is re-checked after every await and right before forwarding, so a
	 * revocation during resolution wins.
	 */
	async relay(relay: RelayHold): Promise<void> {
		const at = relay.frame.at;
		const route = this.#routeFor(at);
		if (route === undefined) {
			throw this.#childNamed(at) === undefined
				? new ChordError("unavailable", `no route to ${at}`)
				: new ChordError("forbidden", `no route authorizes ${at}`);
		}
		const down = await this.#resolve(route, at, relay.principal, () => relay.current);
		if (!relay.current) return;
		relay.open(down);
	}

	reload(plugins: readonly PluginRef[], options: ReloadOptions = {}): Promise<ReloadReport> {
		// Client-local facet epochs never cross the parent link; only child hosts require cluster coordination.
		if (this.kind !== "client" && this.upstream !== undefined) {
			return Promise.reject(
				new ChordError("unavailable", "reloads are coordinated by the server", { reason: "not_coordinator" }),
			);
		}
		const children = [...this.connections].some(
			(connection) => connection.role === "downstream" && connection.peer.kind === "host",
		);
		return children || options.remote !== undefined || options.remoteRemove !== undefined
			? runClusterReload(this, plugins, options)
			: runReload(this, plugins, options);
	}

	onReloadFrame(connection: Connection, frame: Extract<Frame, { t: "prepare" | "commit" | "abort" }>): void {
		this.#childReloads.handle(connection, frame);
	}

	rememberRemoteModules(
		remote: Readonly<Record<string, readonly string[]>> | undefined,
		remove: Readonly<Record<string, readonly string[]>> | undefined,
	): void {
		for (const prefix of new Set([...Object.keys(remote ?? {}), ...Object.keys(remove ?? {})])) {
			const modules = remote?.[prefix] ?? [];
			const removed = remove?.[prefix] ?? [];
			this.remoteModules[prefix] = [...new Set([...(this.remoteModules[prefix] ?? []), ...modules])].filter(
				(module) => !removed.includes(module),
			);
			this.remoteRemoved[prefix] = [...new Set([...(this.remoteRemoved[prefix] ?? []), ...removed])].filter(
				(module) => !modules.includes(module),
			);
		}
	}

	/** The epoch id the next reload would commit. */
	peekNextEpoch(): number {
		return this.#epochSeq + 1;
	}

	/**
	 * Disposes every record, holders before what they hold (a resource's `close` may still use the objects its record
	 * holds, local or remote), then closes the links.
	 */
	async close(): Promise<void> {
		this.eager.clear();
		const reason = new ChordError("gone", `host ${this.name} closed`);
		try {
			await disposeHoldersFirst([...this.records.values()], reason, "host close: disposal failed");
		} finally {
			for (const connection of [...this.connections]) connection.link.close("host closed");
		}
	}
}

/**
 * Force-disposes `records` in waves: a record goes once no record of the set that holds it is left, so holders are
 * disposed (and their resources closed) while what they hold is still live. In-host holds are acyclic. Errors of
 * every disposal are collected.
 */
async function disposeHoldersFirst(records: readonly RecordImpl[], reason: unknown, message: string): Promise<void> {
	const remaining = new Set(records);
	const held = (record: RecordImpl): Set<RecordImpl> => {
		const result = new Set<RecordImpl>();
		for (const decls of record.allDecls()) {
			for (const hold of decls.holds.values()) if (hold.record !== undefined) result.add(hold.record);
		}
		return result;
	};
	const holds = new Map(records.map((record) => [record, held(record)] as const));
	const errors: unknown[] = [];
	while (remaining.size > 0) {
		const heldByRemaining = new Set<RecordImpl>();
		for (const record of remaining) for (const target of holds.get(record) ?? []) heldByRemaining.add(target);
		let wave = [...remaining].filter((record) => !heldByRemaining.has(record));
		// A cycle cannot happen in-host; dispose the rest together rather than loop.
		if (wave.length === 0) wave = [...remaining];
		for (const record of wave) remaining.delete(record);
		const results = await Promise.allSettled(wave.map((record) => record.dispose(true, reason)));
		for (const result of results) if (result.status === "rejected") errors.push(result.reason);
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, message);
}

function sameTable(a: RegistryTable<unknown>, b: RegistryTable<unknown>): boolean {
	if (a.size !== b.size) return false;
	const keys = [...a.keys()];
	return [...b].every(([key, value], index) => keys[index] === key && a.get(key) === value);
}

const matchesPattern = (pattern: Readonly<Record<string, unknown>>, principal: Principal): boolean =>
	principal !== null &&
	typeof principal === "object" &&
	Object.entries(pattern).every(([key, value]) => deepEqual((principal as Record<string, unknown>)[key], value));

/** Address of a remote hold, as the consumer sees it (the provider normalizes the input). */
const remoteAddress = (at: string, type: AnyContract, input: unknown, principal: Principal | undefined): string =>
	`@${at}\u0000${type.name}\u0000${canonicalJson(input)}\u0000${principal === undefined ? "host" : canonicalJson(principal)}`;

const unknownType = (type: string, host: string): ChordError =>
	new ChordError("unavailable", `${type} is not served by ${host}`, { reason: "unknown_type" });

/** True if `from` holds `to`, directly or transitively, through record-owned holds on this host. */
function reaches(from: RecordImpl, to: RecordImpl): boolean {
	const seen = new Set<RecordImpl>();
	const stack = [from];
	while (stack.length > 0) {
		const record = stack.pop()!;
		if (record === to) return true;
		if (seen.has(record)) continue;
		seen.add(record);
		// Remote holds have no record here: cycles across hosts are avoided by convention.
		for (const decls of record.allDecls()) {
			for (const hold of decls.holds.values()) if (hold.record !== undefined) stack.push(hold.record);
		}
	}
	return false;
}
