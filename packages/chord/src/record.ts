import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { Cell, Derived, isSource, notReady } from "./cell.ts";
import {
	type Accepts,
	type Adapter,
	type AnyContract,
	type BehaviorOf,
	bind,
	type Handle,
	type InputOf,
	LOCAL_VARIANT,
	type MemberDescription,
} from "./contract.ts";
import {
	type CellDecl,
	type Cells,
	type DerivationDecl,
	type Derivations,
	declKind,
	type ListenerDecl,
	type Resource,
	type ResourceDecl,
	type ResourceSpec,
	type Resources,
	type Subscribable,
} from "./declare.ts";
import { asChordError, ChordError, invalid, runAll } from "./errors.ts";
import { enqueue } from "./publish.ts";
import type { Registration, Registry } from "./registry.ts";
import { assertValid } from "./schema.ts";
import type { Ctx, Exposed, GetOptions, HandleStatus, Principal, Readable, Shape, StateEvent } from "./types.ts";

const noop = (): void => {};

// ─── Services ────────────────────────────────────────────────────────────────

export interface ServeOptions<C extends AnyContract = AnyContract> {
	/**
	 * State version: the meaning of the record's cells. At a bump, `migrate[name](old, fromVersion)` maps a cell's value;
	 * the record may be several versions behind.
	 */
	readonly state?: {
		readonly version: number;
		readonly migrate?: Readonly<Record<string, (old: unknown, fromVersion: number) => unknown>>;
	};
	/** Milliseconds a record stays alive after its last hold is released. */
	readonly linger?: number;
	/** Host-held record created with this input (true: `{}` normalized). Only eager records may register. */
	readonly eager?: boolean | { readonly input: InputOf<C> };
	/** Adapters for consumers built against older contract versions. */
	readonly accepts?: Accepts;
}

export type Factory<C extends AnyContract> = (input: InputOf<C>, principal: Principal, self: Self) => BehaviorOf<C>;
type AnyFactory = (input: unknown, principal: Principal, self: Self) => unknown;

export interface Service {
	readonly contract: AnyContract;
	readonly factory: AnyFactory;
	readonly options: ServeOptions;
	readonly facet: string;
	readonly stateVersion: number;
}

export const makeService = <C extends AnyContract>(
	contract: C,
	factory: Factory<C>,
	options: ServeOptions<C>,
	facet: string,
): Service => ({
	contract,
	factory: factory as unknown as AnyFactory,
	options: options as ServeOptions,
	facet,
	stateVersion: options.state?.version ?? 1,
});

// ─── Declarations ────────────────────────────────────────────────────────────

export interface Self {
	/** Cells by name. Existing names keep their cell (and value) across reloads. */
	state<const D extends Readonly<Record<string, CellDecl<unknown>>>>(cells: D): Cells<D>;
	/** A record-owned hold, identified by its address. */
	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C>;
	resources<const D extends Readonly<Record<string, ResourceDecl<unknown>>>>(resources: D): Resources<D>;
	listen(listeners: Readonly<Record<string, ListenerDecl>>): void;
	tasks(tasks: Readonly<Record<string, (ctx: Ctx) => Promise<void>>>): void;
	derive<const D extends Readonly<Record<string, DerivationDecl<unknown>>>>(derivations: D): Derivations<D>;
	/** Eager records only. Keys are the registry's own keys. */
	register<V>(registry: Registry<V>, entries: Readonly<Record<string, V>>): void;
	/**
	 * A member backed by one of this record's resources, for local contracts: handles read the resource's value once
	 * the record is live (`undefined` before). Typically an `opaque` member: `{ harness: self.expose(res.durable) }`.
	 */
	expose<T>(resource: Resource<T>): Exposed<T>;
}

/** Runtime form of `Exposed<T>`. */
class ExposedImpl {
	readonly resource: ResourceImpl;
	constructor(resource: ResourceImpl) {
		this.resource = resource;
	}
}

export class ResourceImpl<T = unknown> implements Resource<T> {
	readonly key: string;
	readonly spec: ResourceSpec<T>;
	readonly deps: readonly (Hold | ResourceImpl)[];
	/** `unavailable`: a close/reopen failed during a reload rollback; the value is gone for good. */
	state: "closed" | "opening" | "open" | "unavailable" = "closed";
	#value: T | undefined;

	constructor(key: string, spec: ResourceSpec<T>, deps: readonly (Hold | ResourceImpl)[]) {
		this.key = key;
		this.spec = spec;
		this.deps = deps;
	}

	get value(): T {
		if (this.state === "unavailable")
			throw new ChordError("unavailable", `resource ${this.key} could not be restored`);
		if (this.state !== "open") throw notReady(`resource ${this.key}`);
		return this.#value as T;
	}

	get exclusive(): boolean {
		return this.spec.exclusive === true;
	}

	/**
	 * Opens the resource. An open that completes after `signal` aborted (rollback, abandonment) closes the value it
	 * produced at once: nobody owns it any more.
	 */
	async open(signal: AbortSignal, order: ResourceImpl[]): Promise<void> {
		if (this.state !== "closed") return;
		this.state = "opening";
		let value: T;
		try {
			value = await this.spec.open({ signal });
		} catch (error) {
			this.state = "closed";
			throw error;
		}
		if (signal.aborted) {
			this.state = "closed";
			await this.spec.close?.(value);
			throw new ChordError("aborted", `resource ${this.key} opened after abort`);
		}
		this.#value = value;
		this.state = "open";
		order.push(this);
	}

	async close(order: ResourceImpl[]): Promise<void> {
		if (this.state !== "open") return;
		this.state = "closed";
		const index = order.indexOf(this);
		if (index !== -1) order.splice(index, 1);
		const value = this.#value as T;
		this.#value = undefined;
		await this.spec.close?.(value);
	}

	markUnavailable(): void {
		this.state = "unavailable";
		this.#value = undefined;
	}
}

/**
 * What `self.resources` returns: the resource, except that `.value` throws `not_ready` while any factory runs, even
 * if the resource is open (a reload's prepare rerun must not touch the native resource the old code uses).
 */
class ResourceFacade<T> implements Resource<T> {
	readonly #resource: ResourceImpl<T>;
	readonly #host: HostCore;

	constructor(resource: ResourceImpl<T>, host: HostCore) {
		this.#resource = resource;
		this.#host = host;
		facades.set(this, resource as ResourceImpl);
	}

	get key(): string {
		return this.#resource.key;
	}

	get value(): T {
		if (this.#host.inFactory > 0) throw notReady(`resource ${this.key} (inside a factory)`);
		return this.#resource.value;
	}
}

const facades = new WeakMap<object, ResourceImpl>();
const resourceOf = (value: unknown): ResourceImpl | undefined =>
	value instanceof ResourceImpl ? value : value !== null && typeof value === "object" ? facades.get(value) : undefined;

type TaskFn = (ctx: Ctx) => Promise<void>;

/** Everything one factory run declared, by kind and key. */
export class Decls {
	readonly cells = new Map<string, Cell<unknown>>();
	readonly cellSchemas = new Map<string, TSchema>();
	readonly holds = new Map<string, Hold>();
	readonly resources = new Map<string, ResourceImpl>();
	readonly listeners = new Map<string, ListenerDecl>();
	readonly tasks = new Map<string, TaskFn>();
	readonly derives = new Map<string, Derived<unknown>>();
	readonly deriveFns = new Map<string, (...values: never[]) => unknown>();
	readonly registrations = new Map<string, Registration>();
}

/** One factory run: its behavior, declarations and the objects it created (not reused from the previous run). */
export interface Run {
	readonly behavior: Record<string, unknown>;
	readonly decls: Decls;
	readonly created: {
		readonly holds: Hold[];
		readonly resources: ResourceImpl[];
		readonly derives: Derived<unknown>[];
	};
}

export interface Installed {
	readonly epoch: number;
	readonly service: Service;
	readonly behavior: Record<string, unknown>;
	readonly decls: Decls;
}

// ─── Host interface the runtime pieces use ───────────────────────────────────

export interface HostCore {
	readonly name: string;
	readonly dev: boolean;
	readonly principal: Principal;
	inFactory: number;
	/** Set when a commit failed midway: the host admits no more work (terminal). */
	readonly failed: unknown;
	report(error: unknown): void;
	currentEpoch(): number;
	hasEpoch(epoch: number): boolean;
	retainedEpochs(): Iterable<readonly [number, ReadonlyMap<string, Service>]>;
	pendingEpoch(): number | undefined;
	service(typeName: string): Service | undefined;
	acquire(
		type: AnyContract,
		input: unknown,
		options: GetOptions | undefined,
		owner: HoldOwner,
		from?: RecordImpl,
		candidate?: boolean,
	): Hold;
	addressOf(type: AnyContract, input: unknown, principal: Principal, at?: string, candidate?: boolean): string;
	root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: { epoch?: number; signal?: AbortSignal }): Promise<T>;
	touch(rootId: string, record: RecordImpl): void;
	forget(record: RecordImpl): void;
	checkRegistrations(record: RecordImpl, decls: Decls): void;
	/** Rebuilds the current registry tables from live records (plus `including`, which is finishing activation). */
	registriesChanged(including?: RecordImpl): void;
}

// ─── Contexts ────────────────────────────────────────────────────────────────

export class CtxImpl implements Ctx {
	readonly host: HostCore;
	readonly signal: AbortSignal;
	readonly rootId: string;
	readonly epoch: number;
	readonly principal: Principal;
	/** Code holders (tasks): every call they make starts a fresh root. */
	readonly holder: boolean;
	readonly #holds: Hold[] = [];
	#closed = false;

	/** True after the call or root that received this ctx settled: it may no longer start work. */
	get closed(): boolean {
		return this.#closed;
	}

	/** Throws unless this ctx may start work on `host` now (not expired, not aborted, not from another host). */
	check(host: HostCore): void {
		if (this.host !== host) throw invalid("foreign_ctx", "ctx belongs to another host");
		if (this.#closed) throw new ChordError("aborted", "ctx expired: its call already settled", { reason: "expired" });
		if (this.signal.aborted) throw new ChordError("aborted", "ctx aborted", { cause: this.signal.reason });
	}

	constructor(
		host: HostCore,
		fields: { signal: AbortSignal; rootId: string; epoch: number; principal: Principal; holder?: boolean },
	) {
		this.host = host;
		this.signal = fields.signal;
		this.rootId = fields.rootId;
		this.epoch = fields.epoch;
		this.principal = fields.principal;
		this.holder = fields.holder ?? false;
	}

	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C> {
		this.check(this.host);
		const handle = this.host.acquire(type, input, { principal: this.principal, ...options }, "call");
		this.#holds.push(handle);
		return handle.proxy as Handle<C>;
	}

	/**
	 * A context for a call into `record`: same root and epoch, its own call-owned holds, aborted on forced disposal.
	 * Code inside an object acts as the host principal.
	 */
	child(record: RecordImpl): CtxImpl {
		return new CtxImpl(this.host, {
			signal: AbortSignal.any([this.signal, record.callAbort.signal]),
			rootId: this.rootId,
			epoch: this.epoch,
			principal: this.host.principal,
		});
	}

	close(): void {
		this.#closed = true;
		for (const handle of this.#holds.splice(0)) handle.release();
	}
}

export async function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) throw new ChordError("aborted", "call aborted", { cause: signal.reason });
	let onAbort = noop;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(new ChordError("aborted", "call aborted", { cause: signal.reason }));
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

// ─── Handles ─────────────────────────────────────────────────────────────────

/** Who a hold belongs to. `connection`: a peer host over a link; `client`: a browser (not a reload participant). */
export type HoldOwner = "record" | "call" | "host" | "external" | "connection" | "client";

/** A claim on an object: a local `HandleImpl`, or a `RemoteHandle` on another host (no record here). */
export interface Hold {
	readonly address: string;
	readonly contract: AnyContract;
	readonly status: HandleStatus;
	readonly ready: Promise<void>;
	readonly proxy: object;
	readonly record: RecordImpl | undefined;
	release(): void;
}

export const HANDLE_BASE: ReadonlySet<PropertyKey> = new Set([
	"contract",
	"status",
	"ready",
	"kind",
	"shape",
	"error",
	"onShape",
	"onStatus",
	"release",
]);

export type StatusListener = (status: HandleStatus, error: unknown) => void;

/** Queues a status notification (after the change that caused it is complete, like every publication). */
export function notifyStatus(
	listeners: ReadonlySet<StatusListener>,
	status: HandleStatus,
	error: unknown,
	report: (error: unknown) => void,
): void {
	if (listeners.size === 0) return;
	const current = [...listeners];
	enqueue(() => {
		for (const listener of current) {
			try {
				listener(status, error);
			} catch (thrown) {
				report(thrown);
			}
		}
	});
}

/** Proxy → hold, for `deps: [handle]` and links. */
export const holdsByProxy = new WeakMap<object, Hold>();
export const handleOf = (value: unknown): Hold | undefined =>
	value !== null && typeof value === "object" ? holdsByProxy.get(value) : undefined;

/**
 * A handle's state member: a stable readable that follows whatever source the current behavior exposes under that
 * name. `undefined` until the handle is live (or while the variant lacks the member). Rebinding (reload, variant)
 * delivers a reset. Upstream is subscribed only while someone listens.
 */
class MemberReadable implements Readable<unknown> {
	readonly #handle: HandleImpl;
	readonly #name: string;
	readonly #values = new Set<(value: unknown) => void>();
	readonly #events = new Set<(event: StateEvent<unknown>) => void>();
	#source: Readable<unknown> | undefined;
	#upstream = noop;
	/** The value listeners last saw; a first upstream snapshot equal to it is not re-announced. */
	#seen: unknown;

	constructor(handle: HandleImpl, name: string) {
		this.#handle = handle;
		this.#name = name;
	}

	get value(): unknown {
		return this.#current()?.value;
	}

	subscribe(listener: (value: unknown) => void): () => void {
		this.#values.add(listener);
		this.#seen = this.value;
		this.#safe(() => listener(this.#seen));
		this.bind();
		return () => this.#remove(this.#values, listener);
	}

	events(listener: (event: StateEvent<unknown>) => void): () => void {
		this.#events.add(listener);
		this.#seen = this.value;
		this.#safe(() => listener({ type: "snap", value: this.#seen }));
		this.bind();
		return () => this.#remove(this.#events, listener);
	}

	/** (Re)subscribes upstream to the current source; a changed source is announced as a reset. */
	bind(): void {
		const source = this.#values.size + this.#events.size > 0 ? this.#current() : undefined;
		if (source === this.#source) return;
		this.#upstream();
		this.#upstream = noop;
		this.#source = source;
		if (source === undefined) return;
		let first = true;
		this.#upstream = source.events((event) => {
			const isFirst = first;
			first = false;
			if (isFirst && event.value === this.#seen) return;
			this.#seen = event.value;
			const translated: StateEvent<unknown> = isFirst ? { type: "reset", value: event.value } : event;
			const events = [...this.#events];
			const values = [...this.#values];
			// Queued: a rebind during a commit must not run observers before the commit completes.
			enqueue(() => {
				for (const listener of events) if (this.#events.has(listener)) this.#safe(() => listener(translated));
				for (const listener of values) if (this.#values.has(listener)) this.#safe(() => listener(event.value));
			});
		});
	}

	stop(): void {
		this.#values.clear();
		this.#events.clear();
		this.bind();
	}

	#current(): Readable<unknown> | undefined {
		const view = this.#handle.currentView();
		if (view === undefined || !this.#handle.inVariant(view, this.#name)) return undefined;
		const value = view[this.#name];
		// Cells and derivations, or any readable an `accepts` adapter maps them to.
		return isSource(value) || isReadableLike(value) ? (value as Readable<unknown>) : undefined;
	}

	#remove<T>(set: Set<T>, listener: T): void {
		set.delete(listener);
		this.bind();
	}

	#safe(fn: () => void): void {
		try {
			fn();
		} catch (error) {
			this.#handle.record.host.report(error);
		}
	}
}

/** One hold on a record. Exposed through a Proxy so members bind late to the current behavior. */
export class HandleImpl {
	readonly record: RecordImpl;
	readonly contract: AnyContract;
	readonly owner: HoldOwner;
	readonly address: string;
	readonly proxy: object;
	readonly ready: Promise<void>;
	status: HandleStatus;
	error: unknown;
	readonly shapeListeners = new Set<(shape: Shape) => void>();
	/** Internal: notified when the handle becomes gone (links forward it). */
	readonly goneListeners = new Set<(error: unknown) => void>();
	readonly readables = new Map<string, MemberReadable>();
	readonly bindings = new Map<Service, Adapter | undefined>();
	readonly views = new WeakMap<Record<string, unknown>, Record<string, unknown>>();
	readonly callers = new Map<string, (args: unknown, ctx?: Ctx) => Promise<unknown>>();

	constructor(record: RecordImpl, contract: AnyContract, owner: HoldOwner) {
		this.record = record;
		this.contract = contract;
		this.owner = owner;
		this.address = record.address;
		this.status = record.status === "live" ? "live" : "loading";
		this.ready = record.ready.then(() => {
			if (this.status === "gone") throw this.error;
			if (this.status === "released") throw new ChordError("released", `handle ${this.address} released`);
		});
		this.ready.catch(noop);
		this.proxy = new Proxy(this, {
			get: (target, property) => {
				if (HANDLE_BASE.has(property)) {
					const value: unknown = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				}
				if (typeof property !== "string" || property === "then") return undefined;
				return target.member(property);
			},
			has: (target, property) => HANDLE_BASE.has(property) || target.member(String(property)) !== undefined,
		});
		holdsByProxy.set(this.proxy, this);
	}

	get kind(): string | undefined {
		const view = this.currentView();
		return view === undefined ? undefined : kindOf(view);
	}

	get shape(): Shape | undefined {
		const installed = this.status === "live" ? this.record.currentInstalled() : undefined;
		const view = installed === undefined ? undefined : this.#safeView(installed);
		if (installed === undefined || view === undefined) return undefined;
		return {
			kind: kindOf(view),
			members: Object.keys(view).filter((key) => key !== "kind"),
			contract: installed.service.contract.fingerprint,
			epoch: installed.epoch,
		};
	}

	onShape(listener: (shape: Shape) => void): () => void {
		this.shapeListeners.add(listener);
		return () => this.shapeListeners.delete(listener);
	}

	onStatus(listener: StatusListener): () => void {
		this.#statusListeners.add(listener);
		return () => this.#statusListeners.delete(listener);
	}

	readonly #statusListeners = new Set<StatusListener>();

	#statusChanged(): void {
		notifyStatus(this.#statusListeners, this.status, this.error, (error) => this.record.host.report(error));
	}

	release(): void {
		if (this.status === "released" || this.status === "gone") return;
		this.status = "released";
		this.#stopReadables();
		this.#statusChanged();
		this.record.release(this);
	}

	// ─── internal ───

	live(): void {
		if (this.status !== "loading") return;
		this.status = "live";
		this.#statusChanged();
		this.shapeChanged();
	}

	gone(error: unknown): void {
		if (this.status === "released" || this.status === "gone") return;
		this.status = "gone";
		this.error = error;
		this.#stopReadables();
		this.#statusChanged();
		for (const listener of [...this.goneListeners]) listener(error);
	}

	shapeChanged(): void {
		for (const readable of this.readables.values()) readable.bind();
		const shape = this.shape;
		if (shape === undefined) return;
		const listeners = [...this.shapeListeners];
		enqueue(() => {
			for (const listener of listeners) {
				try {
					listener(shape);
				} catch (error) {
					this.record.host.report(error);
				}
			}
		});
	}

	terminalError(): unknown {
		return this.status === "gone" ? this.error : new ChordError("released", `handle ${this.address} released`);
	}

	/** The behavior as this consumer sees it (through an accepts adapter when bound to another version). */
	viewOf(installed: Installed): Record<string, unknown> {
		let adapter = this.bindings.get(installed.service);
		if (!this.bindings.has(installed.service)) {
			adapter = bind(installed.service.contract, installed.service.options.accepts, this.contract);
			this.bindings.set(installed.service, adapter);
		}
		if (adapter === undefined) return installed.behavior;
		let view = this.views.get(installed.behavior);
		if (view === undefined) {
			view = adapter(installed.behavior);
			this.views.set(installed.behavior, view);
		}
		return view;
	}

	currentView(): Record<string, unknown> | undefined {
		if (this.status !== "live") return undefined;
		const installed = this.record.currentInstalled();
		return installed === undefined ? undefined : this.#safeView(installed);
	}

	/** The view, or undefined when this consumer no longer binds (reported; calls reject with the bind error). */
	#safeView(installed: Installed): Record<string, unknown> | undefined {
		try {
			return this.viewOf(installed);
		} catch (error) {
			this.record.host.report(error);
			return undefined;
		}
	}

	describe(kind: string | undefined, member: string): MemberDescription | undefined {
		const variants = this.contract.description.variants;
		if (kind !== undefined) return variants[kind]?.[member];
		for (const members of Object.values(variants)) if (members[member] !== undefined) return members[member];
		return undefined;
	}

	/** Remote consumers see only the members their contract lists for the current variant. */
	inVariant(view: Record<string, unknown>, name: string): boolean {
		return this.contract.scope !== "remote" || this.describe(kindOf(view), name) !== undefined;
	}

	member(name: string): unknown {
		const declared = this.describe(undefined, name);
		const view = this.currentView();
		const value = view?.[name];
		if (declared?.kind === "method" || (declared === undefined && typeof value === "function")) {
			return this.caller(name);
		}
		if (declared?.kind === "state" || (declared === undefined && (isSource(value) || isReadableLike(value)))) {
			let readable = this.readables.get(name);
			if (readable === undefined) {
				readable = new MemberReadable(this, name);
				this.readables.set(name, readable);
			}
			return readable;
		}
		if (view === undefined || !this.inVariant(view, name)) return undefined;
		return value instanceof ExposedImpl ? value.resource.value : value;
	}

	caller(name: string): (args: unknown, ctx?: Ctx) => Promise<unknown> {
		let caller = this.callers.get(name);
		if (caller === undefined) {
			caller = (args, ctx) => {
				if (this.record.host.inFactory > 0) {
					throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
				}
				if (ctx !== undefined && !(ctx instanceof CtxImpl)) {
					return Promise.reject(invalid("foreign_ctx", "ctx must come from a Chord host"));
				}
				if (ctx === undefined || ctx.holder) {
					// A code holder (task) starts a fresh root per call, cancelled with the holder.
					try {
						ctx?.check(this.record.host);
					} catch (error) {
						return Promise.reject(error);
					}
					return this.record.host.root((root) => this.record.call(this, name, args, root as CtxImpl), {
						signal: ctx?.signal,
					});
				}
				return this.record.call(this, name, args, ctx);
			};
			this.callers.set(name, caller);
		}
		return caller;
	}

	#stopReadables(): void {
		for (const readable of this.readables.values()) readable.stop();
	}
}

export const kindOf = (behavior: Record<string, unknown>): string | undefined =>
	typeof behavior.kind === "string" ? behavior.kind : undefined;

// ─── Records ─────────────────────────────────────────────────────────────────

export type RecordStatus = "activating" | "live" | "failed" | "disposing" | "disposed";

interface Gate {
	readonly grandfathered: Set<string>;
	readonly queue: { readonly key: string; readonly event: unknown }[];
	drained: () => void;
}

interface Subscription {
	/** What the listener was declared on: the resource (not its facade), or the source itself. */
	readonly origin: unknown;
	readonly select: ListenerDecl["select"];
	unsubscribe: () => void;
}

/**
 * Two `select` functions are the same if they are identical or have the same source text: an inline arrow is a new
 * object on every factory run, but its code is what matters. (A select whose behavior depends on captured values
 * that change between runs is not detected; such a listener keeps its old subscription until its source changes.)
 */
const sameSelect = (a: ListenerDecl["select"], b: ListenerDecl["select"]): boolean =>
	a === b || (a !== undefined && b !== undefined && String(a) === String(b));

/** Listener subscriptions made ahead of a commit: `activate` switches over, `discard` drops them. */
export interface StagedListeners {
	activate(): void;
	discard(): void;
}

interface RunningTask {
	readonly controller: AbortController;
	readonly done: Promise<void>;
}

export interface RecordIdentity {
	readonly address: string;
	readonly typeName: string;
	readonly input: unknown;
	readonly principal: Principal;
	readonly eager: boolean;
}

export class RecordImpl {
	readonly host: HostCore;
	readonly address: string;
	readonly typeName: string;
	readonly input: unknown;
	readonly principal: Principal;
	readonly eager: boolean;
	status: RecordStatus = "activating";
	ready: Promise<void> = Promise.resolve();
	service: Service | undefined;
	stateVersion = 0;
	/** Calls carrying an older epoch are rejected upgrade_conflict (state bump or exclusive resource replaced). */
	minEpoch = 0;
	decls = new Decls();
	/** Declarations of a factory run that has not been installed yet (activation or reload candidate). */
	readonly pending = new Set<Decls>();
	readonly behaviors = new Map<number, Installed>();
	readonly holds = new Set<HandleImpl>();
	readonly leases = new Map<string, number>();
	readonly openOrder: ResourceImpl[] = [];
	readonly callAbort = new AbortController();
	readonly activationAbort = new AbortController();
	gate: Gate | undefined;
	/** Served only by a running reload's pending epoch: listeners, tasks and registrations start at its commit. */
	deferredRuntime = false;
	readonly #subscriptions = new Map<string, Subscription>();
	readonly #invocations = new Set<Promise<unknown>>();
	#tasks = new Map<string, RunningTask>();
	readonly #stopped: Promise<void>[] = [];
	#linger: ReturnType<typeof setTimeout> | undefined;
	#disposal: Promise<void> | undefined;

	constructor(host: HostCore, identity: RecordIdentity) {
		this.host = host;
		this.address = identity.address;
		this.typeName = identity.typeName;
		this.input = identity.input;
		this.principal = identity.principal;
		this.eager = identity.eager;
	}

	start(after: Promise<void> | undefined): void {
		this.ready = this.#activate(after).then(
			() => {
				for (const handle of this.holds) handle.live();
				this.#maybeIdle();
			},
			(cause: unknown) => {
				if (this.status === "activating") this.status = "failed";
				this.host.forget(this);
				// A ChordError (forbidden, a dependency's error, ...) keeps its code; anything else is `unavailable`.
				const error = asChordError(cause, `activating ${this.address}`);
				for (const handle of this.holds) handle.gone(error);
				throw error;
			},
		);
		this.ready.catch(noop);
	}

	/**
	 * Activation as one transaction: factory, opens, then a synchronous finalization (registry check and publication,
	 * behaviors, runtime). Every failure, including one during finalization or a release while listeners start,
	 * unwinds everything this activation did.
	 */
	async #activate(after: Promise<void> | undefined): Promise<void> {
		await after?.catch(noop);
		const signal = this.activationAbort.signal;
		const abandoned = (): ChordError => new ChordError("aborted", `${this.address} abandoned`);
		if (signal.aborted) throw abandoned();
		const service = this.host.service(this.typeName);
		if (service === undefined)
			throw new ChordError("unavailable", `${this.typeName} is not served`, { reason: "unknown_type" });
		this.service = service;
		this.stateVersion = service.stateVersion;
		const run = this.run(service, undefined);
		try {
			await this.open(run.created.resources, run.created.holds, signal);
			if (signal.aborted) throw abandoned();
			this.host.checkRegistrations(this, run.decls);
			this.decls = run.decls;
			for (const [retained, services] of this.host.retainedEpochs()) {
				if (services.get(this.typeName) === service) {
					this.behaviors.set(retained, { epoch: retained, service, behavior: run.behavior, decls: run.decls });
				}
			}
			const pending = this.host.pendingEpoch();
			if (!this.behaviors.has(this.host.currentEpoch()) && (pending === undefined || !this.behaviors.has(pending))) {
				throw new ChordError("superseded", `${this.address}: code changed during activation`);
			}
			for (const derived of run.created.derives) derived.attach();
			this.refreshSchemas();
			// Served only by a running reload's pending epoch: new code must not run (listeners, tasks, registrations)
			// before that reload commits.
			this.deferredRuntime = !this.behaviors.has(this.host.currentEpoch());
			if (!this.deferredRuntime) {
				if (run.decls.registrations.size > 0) this.host.registriesChanged(this);
				this.startRuntime();
			}
			// A listener starting up may have released the last hold synchronously: no resurrection.
			if (signal.aborted) throw abandoned();
			this.status = "live";
		} catch (error) {
			// Invocations started during finalization (listener roots) end before their resources close.
			this.callAbort.abort(error);
			this.stopListeners();
			this.stopTasks();
			const registered = this.decls.registrations.size > 0 && !this.deferredRuntime;
			this.behaviors.clear();
			this.decls = new Decls();
			if (registered) this.host.registriesChanged();
			await Promise.allSettled([...this.#invocations, ...this.#stopped.splice(0)]);
			await this.unwind(run).catch((cleanup: unknown) => this.host.report(cleanup));
			throw error;
		} finally {
			this.pending.delete(run.decls);
		}
	}

	/**
	 * Runs the factory synchronously. With `previous`, runs in recording mode for a reload prepare. The run's
	 * declarations stay in `pending` (visible to the cycle check) until the caller installs or discards them.
	 */
	run(service: Service, previous: Decls | undefined): Run {
		const self = new SelfImpl(this, previous);
		const discard = (run: Run): void => {
			this.pending.delete(run.decls);
			void this.unwind(run).catch((cleanup: unknown) => this.host.report(cleanup));
		};
		this.pending.add(self.run(undefined).decls);
		this.host.inFactory++;
		let behavior: unknown;
		try {
			behavior = service.factory(this.input, this.principal, self);
		} catch (error) {
			this.host.inFactory--;
			discard(self.run(undefined));
			throw error;
		}
		this.host.inFactory--;
		const run = self.run(behavior);
		try {
			if (behavior instanceof Promise) throw invalid("behavior", `${this.typeName}: factories must be synchronous`);
			validateBehavior(service, run.behavior);
		} catch (error) {
			discard(run);
			throw error;
		}
		return run;
	}

	/** Opens resources (dependencies first) and waits for holds; settles all before failing. */
	async open(resources: readonly ResourceImpl[], holds: readonly Hold[], signal: AbortSignal): Promise<void> {
		const opening = new Map<ResourceImpl, Promise<void>>();
		const openOne = (resource: ResourceImpl): Promise<void> => {
			let promise = opening.get(resource);
			if (promise === undefined) {
				promise = (async () => {
					await Promise.all(
						resource.deps.map((dep) =>
							!(dep instanceof ResourceImpl) ? dep.ready : resources.includes(dep) ? openOne(dep) : undefined,
						),
					);
					await resource.open(signal, this.openOrder);
				})();
				opening.set(resource, promise);
			}
			return promise;
		};
		const results = await Promise.allSettled([...resources.map(openOne), ...holds.map((hold) => hold.ready)]);
		const failure = results.find((result) => result.status === "rejected");
		if (failure !== undefined) throw failure.reason;
	}

	/** Undoes the objects a run created: closes its resources (reverse order) and releases its holds. */
	async unwind(run: Run): Promise<void> {
		for (const derived of run.created.derives) derived.detach();
		const resources = [...run.created.resources].sort(
			(a, b) => this.openOrder.indexOf(b) - this.openOrder.indexOf(a),
		);
		await runAll(
			[
				...resources.map((resource) => () => resource.close(this.openOrder)),
				...run.created.holds.map((hold) => () => hold.release()),
			],
			`${this.address}: cleanup failed`,
		);
	}

	currentInstalled(): Installed | undefined {
		return this.behaviors.get(this.host.currentEpoch()) ?? [...this.behaviors.values()].at(-1);
	}

	/** Every state source exposed as a remote state member gets that member's schema (checked per write in dev mode). */
	refreshSchemas(): void {
		const schemas = new Map<Readable<unknown>, TSchema[]>();
		for (const installed of this.behaviors.values()) {
			for (const [source, list] of memberSchemas(installed.service, installed.behavior)) {
				schemas.set(source, [...(schemas.get(source) ?? []), ...list]);
			}
		}
		for (const decls of this.allDecls()) {
			for (const source of [...decls.cells.values(), ...decls.derives.values()])
				source.schemas = schemas.get(source) ?? [];
		}
	}

	allDecls(): Set<Decls> {
		const result = new Set<Decls>([this.decls, ...this.pending]);
		for (const installed of this.behaviors.values()) result.add(installed.decls);
		return result;
	}

	// ─── runtime: listeners and tasks of the current declarations ───

	/** The resource a listener is declared on, or its source itself. */
	#origin(decl: ListenerDecl): unknown {
		return resourceOf(decl.source) ?? decl.source;
	}

	/** Resolves a listener's subscribable: `select(resource value)`, `select(source)` or the source itself. */
	#listenSource(key: string, decl: ListenerDecl): Subscribable<unknown> {
		const resource = resourceOf(decl.source);
		const value = resource === undefined ? decl.source : resource.value;
		const source = (decl.select === undefined ? value : decl.select(value as never)) as Subscribable<unknown>;
		if (typeof source?.subscribe !== "function")
			throw invalid("behavior", `listener ${key}: source has no subscribe()`);
		return source;
	}

	/**
	 * Subscribes the listeners of `decls` without delivering: events are buffered until `activate`. A listener declared
	 * on the same resource (or source) with the same `select` keeps its subscription without calling `select` again
	 * (only its function is swapped, by name), so sources that accept a single subscriber survive reloads. Throws, with
	 * nothing left subscribed, if any source fails.
	 */
	stageListeners(decls: Decls): StagedListeners {
		const fresh = new Map<string, Subscription & { buffer: unknown[] | undefined }>();
		const kept = new Set<string>();
		try {
			for (const [key, decl] of decls.listeners) {
				const origin = this.#origin(decl);
				const previous = this.#subscriptions.get(key);
				if (previous !== undefined && previous.origin === origin && sameSelect(previous.select, decl.select)) {
					kept.add(key);
					continue;
				}
				const source = this.#listenSource(key, decl);
				const entry: Subscription & { buffer: unknown[] | undefined } = {
					origin,
					select: decl.select,
					unsubscribe: noop,
					buffer: [],
				};
				fresh.set(key, entry);
				entry.unsubscribe = source.subscribe((event) => {
					if (entry.buffer !== undefined) entry.buffer.push(event);
					else this.#deliver(key, event);
				});
			}
		} catch (error) {
			for (const entry of fresh.values()) entry.unsubscribe();
			throw error;
		}
		return {
			activate: () => {
				for (const [key, subscription] of this.#subscriptions) {
					if (kept.has(key)) continue;
					subscription.unsubscribe();
					this.#subscriptions.delete(key);
				}
				for (const [key, entry] of fresh) {
					this.#subscriptions.set(key, entry);
					const buffered = entry.buffer ?? [];
					entry.buffer = undefined;
					for (const event of buffered) this.#deliver(key, event);
				}
			},
			discard: () => {
				for (const entry of fresh.values()) entry.unsubscribe();
			},
		};
	}

	startRuntime(): void {
		this.stageListeners(this.decls).activate();
		this.startTasks();
	}

	startTasks(): void {
		for (const key of this.decls.tasks.keys()) this.startTask(key, this.host.currentEpoch());
	}

	stopListeners(): void {
		for (const subscription of this.#subscriptions.values()) subscription.unsubscribe();
		this.#subscriptions.clear();
	}

	startTask(key: string, epoch: number): void {
		const fn = this.decls.tasks.get(key);
		if (fn === undefined) return;
		const controller = new AbortController();
		const ctx = new CtxImpl(this.host, {
			signal: AbortSignal.any([controller.signal, this.callAbort.signal]),
			rootId: `task:${this.address}:${key}`,
			epoch,
			principal: this.host.principal,
			holder: true,
		});
		const done = (async () => {
			try {
				await fn(ctx);
			} catch (error) {
				if (!ctx.signal.aborted) this.host.report(error);
			} finally {
				ctx.close();
				if (this.#tasks.get(key)?.controller === controller) this.#tasks.delete(key);
			}
		})();
		this.#tasks.set(key, { controller, done });
	}

	/** Aborts running tasks; their completion is awaited at disposal. */
	stopTasks(): void {
		for (const task of this.#tasks.values()) {
			task.controller.abort(new ChordError("aborted", "task stopped"));
			this.#stopped.push(task.done);
		}
		this.#tasks.clear();
	}

	/**
	 * Delivers one listener event, in publication order. The invocation is a root that holds a lease on this record
	 * (a reload gate waits for it like for any other root that touched the record), counts as an invocation (disposal
	 * waits for it) and is cancelled by forced disposal.
	 */
	#deliver(key: string, event: unknown): void {
		enqueue(() => {
			if (this.gate !== undefined) {
				this.gate.queue.push({ key, event });
				return;
			}
			const decl = this.decls.listeners.get(key);
			if (decl === undefined || (this.status !== "live" && this.status !== "activating")) return;
			const invocation = this.host.root((root) => {
				this.lease(root);
				const child = (root as CtxImpl).child(this);
				return this.#invoke(async () => {
					try {
						await decl.fn(event, child);
					} finally {
						child.close();
					}
				});
			});
			invocation.catch((error: unknown) => this.host.report(error));
		});
	}

	/** Opens the record's gate and replays queued listener events through the current listeners. */
	openGate(): void {
		const gate = this.gate;
		this.gate = undefined;
		for (const { key, event } of gate?.queue ?? []) this.#deliver(key, event);
	}

	// ─── calls ───

	/** Admission for a call or write carrying `ctx`. */
	admit(ctx: Ctx): void {
		if (this.host.failed !== undefined) {
			throw new ChordError("unavailable", `${this.host.name} failed and admits no work`, { reason: "host_failed" });
		}
		if (!this.host.hasEpoch(ctx.epoch)) throw new ChordError("superseded", `epoch ${ctx.epoch} is retired`);
		if (ctx.epoch < this.minEpoch) {
			throw new ChordError("upgrade_conflict", `${this.address} was upgraded in epoch ${this.minEpoch}`);
		}
		if (this.gate !== undefined && !this.gate.grandfathered.has(ctx.rootId)) {
			throw new ChordError("upgrade_conflict", `${this.address} is being upgraded`);
		}
	}

	/** Records that the root of `ctx` touched this record (a reload gate grandfathers it). */
	lease(ctx: Ctx): void {
		if (this.leases.has(ctx.rootId)) return;
		this.leases.set(ctx.rootId, ctx.epoch);
		this.host.touch(ctx.rootId, this);
	}

	guard = (ctx: Ctx): void => {
		if (this.host.inFactory > 0) throw invalid("read_only", "cells cannot be written while a factory runs");
		if (ctx instanceof CtxImpl) ctx.check(this.host);
		if (ctx.signal.aborted) throw new ChordError("aborted", "write with an aborted ctx");
		if (this.status === "disposed") throw new ChordError("gone", `${this.address} is disposed`);
		if (ctx.rootId.startsWith("task:")) return;
		this.admit(ctx);
	};

	async call(handle: HandleImpl, name: string, args: unknown, ctx: CtxImpl): Promise<unknown> {
		ctx.check(this.host);
		if (handle.status === "released" || handle.status === "gone") throw handle.terminalError();
		if (handle.status === "loading") await raceSignal(handle.ready, ctx.signal);
		if (handle.status !== "live" || this.status !== "live") {
			throw handle.status === "live"
				? new ChordError("gone", `${this.address} is ${this.status}`)
				: handle.terminalError();
		}
		this.admit(ctx);
		const installed = this.behaviors.get(ctx.epoch);
		if (installed === undefined)
			throw new ChordError("superseded", `${this.address} has no behavior for epoch ${ctx.epoch}`);
		const view = handle.viewOf(installed);
		const kind = kindOf(view);
		const wanted = handle.describe(handle.contract.scope === "remote" ? kind : LOCAL_VARIANT, name);
		const fn = view[name];
		if (typeof fn !== "function" || (handle.contract.scope === "remote" && wanted?.kind !== "method")) {
			throw new ChordError(
				"not_in_variant",
				`${this.address}: ${name} is not a method of variant ${kind ?? "(local)"}`,
			);
		}
		const direct = view === installed.behavior;
		const schema = direct ? installed.service.contract.description.variants[kind ?? LOCAL_VARIANT]?.[name] : wanted;
		const validated = handle.contract.scope === "remote" && schema?.kind === "method" ? schema : undefined;
		// The additive rule assumes a consumer sends only what its own schema knows, and a provider sees only what its
		// schema knows: strip with both before validating.
		const own = handle.contract.scope === "remote" && wanted?.kind === "method" ? wanted.args : undefined;
		const sent = own === undefined ? args : Value.Clean(own, Value.Clone(args));
		const input = validated ? Value.Clean(validated.args, Value.Clone(sent)) : sent;
		if (validated) assertValid("args", `${this.address}.${name} args`, validated.args, input);
		this.lease(ctx);
		const child = ctx.child(this);
		let result: unknown;
		try {
			result = await this.#invoke(() => (fn as (args: unknown, ctx: Ctx) => unknown)(input, child));
		} finally {
			child.close();
		}
		if (validated) assertValid("result", `${this.address}.${name} result`, validated.result, result);
		return result;
	}

	/** Runs an invocation (method or listener) that keeps the record alive until it settles. */
	#invoke<T>(fn: () => T | Promise<T>): Promise<T> {
		const invocation = (async () => fn())();
		this.#invocations.add(invocation);
		const done = (): void => {
			this.#invocations.delete(invocation);
			if (this.#invocations.size === 0) this.#maybeIdle();
		};
		invocation.then(done, done);
		return invocation;
	}

	rootEnded(rootId: string): void {
		this.leases.delete(rootId);
		const gate = this.gate;
		if (gate?.grandfathered.delete(rootId) && gate.grandfathered.size === 0) gate.drained();
	}

	// ─── lifetime ───

	addHold(handle: HandleImpl): void {
		this.holds.add(handle);
		if (this.#linger !== undefined) clearTimeout(this.#linger);
		this.#linger = undefined;
	}

	release(handle: HandleImpl): void {
		if (this.holds.delete(handle)) this.#maybeIdle();
	}

	/** No holds and no invocations: dispose (after `linger` for a live record). */
	#maybeIdle(): void {
		if (this.holds.size > 0 || this.#invocations.size > 0 || this.#linger !== undefined) return;
		if (this.status === "activating") {
			this.#background(this.dispose(false));
			return;
		}
		if (this.status !== "live") return;
		const linger = this.service?.options.linger ?? 0;
		if (linger <= 0) {
			this.#background(this.dispose(false));
			return;
		}
		this.#linger = setTimeout(() => {
			this.#linger = undefined;
			if (this.holds.size === 0 && this.#invocations.size === 0 && this.status === "live") {
				this.#background(this.dispose(false));
			}
		}, linger);
		this.#linger.unref?.();
	}

	#background(disposal: Promise<void>): void {
		disposal.catch((error: unknown) => this.host.report(error));
	}

	/**
	 * Disposes the record. Forced: handles become gone at once (new calls are rejected) and running invocations are
	 * cancelled. Either way, resources close only after every invocation settled.
	 */
	dispose(forced: boolean, reason?: unknown): Promise<void> {
		this.#disposal ??= this.#dispose(forced, reason);
		return this.#disposal;
	}

	async #dispose(forced: boolean, reason: unknown): Promise<void> {
		const wasActivating = this.status === "activating";
		this.status = "disposing";
		this.host.forget(this);
		if (this.#linger !== undefined) clearTimeout(this.#linger);
		this.#linger = undefined;
		const error = reason ?? new ChordError("gone", `${this.address} was disposed`);
		if (forced) {
			for (const handle of this.holds) handle.gone(error);
			this.callAbort.abort(error);
		}
		this.activationAbort.abort(error);
		if (wasActivating) await this.ready.catch(noop);
		for (const handle of this.holds) handle.gone(error);
		const decls = this.allDecls();
		this.stopTasks();
		this.stopListeners();
		await Promise.allSettled([...this.#invocations]);
		const registered = [...decls].some((set) => set.registrations.size > 0) && !this.deferredRuntime;
		this.behaviors.clear();
		this.decls = new Decls();
		if (registered) this.host.registriesChanged();
		const holds = new Set<Hold>();
		for (const set of decls) {
			for (const derived of set.derives.values()) derived.detach();
			for (const hold of set.holds.values()) holds.add(hold);
		}
		try {
			await runAll(
				[
					() => Promise.allSettled(this.#stopped.splice(0)),
					...[...this.openOrder].reverse().map((resource) => () => resource.close(this.openOrder)),
					...[...holds].map((hold) => () => hold.release()),
				],
				`${this.address}: disposal failed`,
			);
		} finally {
			this.status = "disposed";
		}
	}
}

const isReadableLike = (value: unknown): boolean =>
	value !== null &&
	typeof value === "object" &&
	typeof (value as Readable<unknown>).events === "function" &&
	typeof (value as Readable<unknown>).subscribe === "function";

/** The remote state-member schemas a behavior exposes, by source. */
export function memberSchemas(service: Service, behavior: Record<string, unknown>): Map<Readable<unknown>, TSchema[]> {
	const schemas = new Map<Readable<unknown>, TSchema[]>();
	const contract = service.contract;
	if (contract.scope !== "remote") return schemas;
	const members = contract.description.variants[kindOf(behavior) ?? ""] ?? {};
	for (const [name, description] of Object.entries(members)) {
		const source = behavior[name];
		if (description.kind !== "state" || !isSource(source)) continue;
		schemas.set(source, [...(schemas.get(source) ?? []), description.schema]);
	}
	return schemas;
}

function validateBehavior(service: Service, behavior: Record<string, unknown>): void {
	const contract = service.contract;
	const fail = (message: string): never => {
		throw invalid("behavior", `${contract.name}: ${message}`);
	};
	if (behavior === null || typeof behavior !== "object") fail("factory must return an object");
	let members: Readonly<Record<string, MemberDescription>>;
	if (contract.scope === "remote") {
		const kind = behavior.kind;
		if (typeof kind !== "string" || contract.description.variants[kind] === undefined)
			fail(`unknown variant ${String(kind)}`);
		members = contract.description.variants[kind as string]!;
		for (const key of Object.keys(behavior))
			if (key !== "kind" && members[key] === undefined) fail(`${key} is not in variant ${String(kind)}`);
	} else {
		members = contract.description.variants[LOCAL_VARIANT] ?? {};
	}
	for (const [name, description] of Object.entries(members)) {
		const value = behavior[name];
		if (description.kind === "method" && typeof value !== "function") fail(`${name} must be a method`);
		if (description.kind === "state" && !isSource(value) && !isReadableLike(value)) {
			fail(`${name} must be a cell, a derivation or a held object's state member`);
		}
		if (description.kind === "opaque" && value === undefined) fail(`${name} is missing`);
	}
}

// ─── The factory's `self` ────────────────────────────────────────────────────

class SelfImpl implements Self {
	readonly #record: RecordImpl;
	readonly #previous: Decls | undefined;
	readonly #decls = new Decls();
	readonly #created: { holds: Hold[]; resources: ResourceImpl[]; derives: Derived<unknown>[] } = {
		holds: [],
		resources: [],
		derives: [],
	};

	constructor(record: RecordImpl, previous: Decls | undefined) {
		this.#record = record;
		this.#previous = previous;
	}

	run(behavior: unknown): Run {
		return { behavior: behavior as Record<string, unknown>, decls: this.#decls, created: this.#created };
	}

	/** Iterates named declarations of one kind, rejecting repeated names and wrong descriptors. */
	*#entries<T>(
		map: ReadonlyMap<string, unknown>,
		kind: string,
		entries: Readonly<Record<string, T>>,
		descriptor?: string,
	) {
		if (entries === null || typeof entries !== "object")
			throw new TypeError(`${kind} takes an object of named declarations`);
		for (const [name, value] of Object.entries(entries)) {
			if (map.has(name)) throw invalid("duplicate", `${this.#record.typeName}: duplicate ${kind} name ${name}`);
			if (descriptor !== undefined && declKind(value) !== descriptor) {
				throw new TypeError(`${kind}.${name} must be declared with ${descriptor}()`);
			}
			yield [name, value] as const;
		}
	}

	state<const D extends Readonly<Record<string, CellDecl<unknown>>>>(cells: D): Cells<D> {
		const result: Record<string, Cell<unknown>> = {};
		const host = this.#record.host;
		for (const [name, decl] of this.#entries(this.#decls.cells, "state", cells, "cell")) {
			const cell =
				this.#previous?.cells.get(name) ??
				new Cell(name, decl.schema, decl.initial, this.#record.guard, {
					dev: host.dev,
					report: (error) => host.report(error),
				});
			this.#decls.cells.set(name, cell);
			this.#decls.cellSchemas.set(name, decl.schema);
			result[name] = cell;
		}
		return result as Cells<D>;
	}

	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C> {
		const host = this.#record.host;
		// A prepare rerun (recording mode) binds new holds against the reload's pending contracts: a breaking provider
		// change and its updated consumer reload together.
		const candidate = this.#previous !== undefined;
		const address = host.addressOf(type, input, options?.principal ?? host.principal, options?.at, candidate);
		const declared = this.#decls.holds.get(address);
		if (declared !== undefined) {
			if (declared.contract.fingerprint !== type.fingerprint) {
				throw invalid("duplicate", `${this.#record.typeName}: ${type.name} held twice with different contracts`);
			}
			return declared.proxy as Handle<C>;
		}
		const existing = this.#previous?.holds.get(address);
		if (
			existing !== undefined &&
			existing.contract.fingerprint === type.fingerprint &&
			existing.status !== "gone" &&
			existing.status !== "released"
		) {
			this.#decls.holds.set(address, existing);
			return existing.proxy as Handle<C>;
		}
		const handle = host.acquire(type, input, options, "record", this.#record, candidate);
		this.#decls.holds.set(address, handle);
		this.#created.holds.push(handle);
		return handle.proxy as Handle<C>;
	}

	resources<const D extends Readonly<Record<string, ResourceDecl<unknown>>>>(resources: D): Resources<D> {
		const result: Record<string, ResourceImpl> = {};
		for (const [name, { spec }] of this.#entries(this.#decls.resources, "resources", resources, "resource")) {
			const deps = (spec.deps ?? []).map((dep) => {
				const resolved = handleOf(dep) ?? resourceOf(dep);
				if (resolved === undefined) {
					throw new TypeError(`resource ${name}: deps must be handles or resources of this record`);
				}
				return resolved;
			});
			const existing = this.#previous?.resources.get(name);
			const kept =
				existing !== undefined &&
				existing.spec.rev === spec.rev &&
				existing.exclusive === (spec.exclusive === true) &&
				existing.deps.length === deps.length &&
				existing.deps.every((dep, index) => dep === deps[index]);
			const resource = kept ? existing : new ResourceImpl(name, spec, deps);
			if (!kept) this.#created.resources.push(resource);
			this.#decls.resources.set(name, resource);
			result[name] = new ResourceFacade(resource, this.#record.host) as unknown as ResourceImpl;
		}
		return result as unknown as Resources<D>;
	}

	listen(listeners: Readonly<Record<string, ListenerDecl>>): void {
		for (const [name, decl] of this.#entries(this.#decls.listeners, "listen", listeners, "listener")) {
			this.#decls.listeners.set(name, decl);
		}
	}

	tasks(tasks: Readonly<Record<string, (ctx: Ctx) => Promise<void>>>): void {
		for (const [name, fn] of this.#entries(this.#decls.tasks, "tasks", tasks)) {
			if (typeof fn !== "function") throw new TypeError(`tasks.${name} must be a function`);
			this.#decls.tasks.set(name, fn);
		}
	}

	derive<const D extends Readonly<Record<string, DerivationDecl<unknown>>>>(derivations: D): Derivations<D> {
		const result: Record<string, Derived<unknown>> = {};
		const host = this.#record.host;
		for (const [name, { sources, fn }] of this.#entries(this.#decls.derives, "derive", derivations, "derivation")) {
			const existing = this.#previous?.derives.get(name);
			let derived: Derived<unknown>;
			if (
				existing !== undefined &&
				existing.sources.length === sources.length &&
				existing.sources.every((source, index) => source === sources[index])
			) {
				derived = existing;
			} else {
				derived = new Derived(name, sources, fn, { dev: host.dev, report: (error) => host.report(error) });
				this.#created.derives.push(derived);
			}
			this.#decls.derives.set(name, derived);
			this.#decls.deriveFns.set(name, fn);
			result[name] = derived;
		}
		return result as unknown as Derivations<D>;
	}

	expose<T>(resource: Resource<T>): Exposed<T> {
		const resolved = resourceOf(resource);
		if (resolved === undefined || ![...this.#decls.resources.values()].includes(resolved)) {
			throw new TypeError("expose takes a resource declared by this record");
		}
		return new ExposedImpl(resolved) as unknown as Exposed<T>;
	}

	register<V>(registry: Registry<V>, entries: Readonly<Record<string, V>>): void {
		if (!this.#record.eager) throw invalid("not_eager", `${this.#record.typeName}: only eager records may register`);
		const prefixed: Record<string, V> = {};
		for (const [key, value] of Object.entries(entries)) prefixed[`${registry.name}\u0000${key}`] = value;
		for (const [id, value] of this.#entries(this.#decls.registrations, "register", prefixed)) {
			this.#decls.registrations.set(id, {
				registry: registry as Registry<unknown>,
				key: id.slice(registry.name.length + 1),
				value,
			});
		}
	}
}
