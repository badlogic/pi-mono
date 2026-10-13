import type { Cell } from "./cell.ts";
import { type AnyContract, bind, coverage } from "./contract.ts";
import { asChordError, ChordError, invalid } from "./errors.ts";
import type { EpochState, Facet, HostImpl, PluginRef, Serve } from "./host.ts";
import { holdPublications } from "./publish.ts";
import {
	type Factory,
	HandleImpl,
	makeService,
	memberSchemas,
	type RecordImpl,
	type ResourceImpl,
	type Run,
	type ServeOptions,
	type Service,
	type StagedListeners,
} from "./record.ts";
import type { RegistryTable } from "./registry.ts";
import { assertValid, deepEqual } from "./schema.ts";

export interface ReloadOptions {
	/** Facet names to remove. */
	readonly remove?: readonly string[];
	/** Milliseconds the gate waits for grandfathered roots (default 5000). Missed: the reload aborts. */
	readonly gateDeadline?: number;
	/** Milliseconds to wait for the previous epoch to retire first (default 5000). Missed: it is retired anyway. */
	readonly retireDeadline?: number;
	/** Server: facet modules for child hosts by host-name prefix (longest wins). Every connected host participates. */
	readonly remote?: Readonly<Record<string, readonly string[]>>;
	/** Server: facet names to remove on child hosts, by the same host-name prefix rules. */
	readonly remoteRemove?: Readonly<Record<string, readonly string[]>>;
	/** Server: milliseconds to wait for every child's vote (default: gate + retire deadlines + 5000). */
	readonly voteDeadline?: number;
}

export interface ReloadReport {
	readonly epoch: number;
	readonly previous: number;
	readonly changed: readonly string[];
	readonly removed: readonly string[];
	/** Addresses of records whose new factory was installed. */
	readonly prepared: readonly string[];
	/** Addresses of records that went through the gate. */
	readonly gated: readonly string[];
	/**
	 * Cluster reloads: what each participating child host prepared, by host name (its vote; the child commits it after
	 * the server). Absent for local reloads.
	 */
	readonly children?: Readonly<Record<string, ReloadReport>>;
}

interface Candidate {
	readonly record: RecordImpl;
	readonly service: Service;
	readonly run: Run;
	/** Why the record needs the gate (empty: compatible). */
	readonly reasons: string[];
	/** New exclusive resources and their new dependents, opened at the gate. */
	readonly atGate: ResourceImpl[];
	/** Old exclusive resources closed at the gate. */
	readonly replaced: ResourceImpl[];
	readonly migrated: Map<Cell<unknown>, unknown>;
	/** Values of the run's derivations over the candidate (migrated) values, validated. */
	derived: Map<unknown, unknown>;
	/** Listener subscriptions made at the end of prepare, activated by the commit. */
	staged: StagedListeners | undefined;
}

const noop = (): void => {};

/**
 * Computes the new derivation functions over the candidate values and validates every prospective value (migrated
 * cells and derivations) against every schema that will apply after the commit: the cell's new schema and the new
 * behavior's remote state-member schemas. A failure fails prepare; the commit then installs without re-checking.
 */
function dryRun(candidate: Candidate): void {
	const { run, migrated, service, record } = candidate;
	const exposed = memberSchemas(service, run.behavior);
	for (const [cell, value] of migrated) {
		for (const schema of exposed.get(cell) ?? [])
			assertValid("state", `${record.address}: migrated state ${cell.key}`, schema, value);
	}
	const values = new Map<unknown, unknown>(migrated);
	const derives = [...run.decls.derives].sort(([, a], [, b]) => a.seq - b.seq);
	for (const [name, derived] of derives) {
		const value = derived.compute(
			(source) => (values.has(source) ? values.get(source) : source.value),
			run.decls.deriveFns.get(name),
		);
		for (const schema of exposed.get(derived) ?? [])
			assertValid("state", `${record.address}: derived ${name}`, schema, value);
		values.set(derived, value);
	}
	candidate.derived = values;
}

/** A reload error keeps the underlying code (`contract_mismatch`, `invalid`, ...) and says it aborted the reload. */
export function reloadError(error: unknown): ChordError {
	const cause = asChordError(error, "reload");
	if (/^reload aborted/.test(cause.message.replace(/^[^:]*: /, ""))) return cause;
	return new ChordError(cause.code, `reload aborted: ${cause.message}`, {
		cause,
		reason: cause.reason,
		details: cause.details,
	});
}

/** Serialized: a second reload while one runs is rejected. */
export async function runReload(
	host: HostImpl,
	plugins: readonly PluginRef[],
	options: ReloadOptions,
): Promise<ReloadReport> {
	const reload = await beginReload(host, plugins, options);
	try {
		await reload.prepare();
		return reload.commit();
	} finally {
		endReload(host);
	}
}

/** Takes the host's reload slot and loads the plugin modules. Pair with `endReload`. */
export async function beginReload(
	host: HostImpl,
	plugins: readonly PluginRef[],
	options: ReloadOptions,
	epoch?: number,
): Promise<Reload> {
	if (host.reloading) {
		throw new ChordError("unavailable", "a reload is already running", { reason: "reload_running" });
	}
	host.reloading = true;
	try {
		return new Reload(host, await host.resolve(plugins), options, epoch);
	} catch (error) {
		host.reloading = false;
		throw reloadError(error);
	}
}

export function endReload(host: HostImpl): void {
	host.reloading = false;
	host.maybeRetire();
}

/** One reload on one host: `prepare` (load, prepare, gate), then `commit` or `rollback`. */
export class Reload {
	readonly host: HostImpl;
	readonly facets: readonly Facet[];
	readonly options: ReloadOptions;
	/** Epoch id to commit (issued by the coordinating server); a local reload allocates one. */
	readonly epoch: number | undefined;
	readonly candidates = new Map<RecordImpl, Candidate>();
	readonly abort = new AbortController();
	readonly closed: [RecordImpl, ResourceImpl][] = [];
	services = new Map<string, Service>();
	changed = new Set<string>();
	removed = new Set<string>();
	tables = new Map<string, RegistryTable<unknown>>();
	gated: Candidate[] = [];
	rolledBack = false;
	/** Records of types this reload adds, with their staged listeners: their runtime starts at commit. */
	readonly deferred = new Map<RecordImpl, StagedListeners>();

	constructor(host: HostImpl, facets: readonly Facet[], options: ReloadOptions, epoch?: number) {
		this.host = host;
		this.facets = facets;
		this.options = options;
		this.epoch = epoch;
	}

	/** Everything up to the commit. On failure the host is rolled back and the underlying error is thrown. */
	async prepare(): Promise<void> {
		try {
			await this.waitForRetirement();
			this.load();
			this.checkProviders();
			await this.prepareAll();
			// From here new records of changed types are rejected (upgrade_conflict, retryable) until commit or abort,
			// so the candidate set is final once the activations already in flight have been prepared.
			this.host.gating = this.changed;
			await this.withDeadline(this.prepareAll(), "activations in flight did not finish");
			this.checkHolds();
			this.tables = this.host.buildTables(this.entries());
			await this.gate();
			this.#alive();
			this.#stage();
		} catch (error) {
			await this.rollback();
			throw reloadError(error);
		}
	}

	/** What a successful prepare will commit (a child sends it with its vote). */
	summary(): ReloadReport {
		const live = [...this.candidates.values()].filter(({ record }) => record.status === "live");
		return {
			epoch: this.host.pending?.id ?? this.host.current.id,
			previous: this.host.current.id,
			changed: [...this.changed],
			removed: [...this.removed],
			prepared: live.map(({ record }) => record.address),
			gated: this.gated.map(({ record }) => record.address),
		};
	}

	/** After every await of prepare: a rollback meanwhile (abort from the coordinator) ends it. */
	#alive(): void {
		if (this.rolledBack) throw new ChordError("aborted", "reload aborted while preparing", { reason: "aborted" });
	}

	/**
	 * Subscribes every new listener now, buffering its events, so a failing source fails prepare instead of leaving a
	 * half-installed epoch. Records running only the new code (types this reload adds) are staged too.
	 */
	#stage(): void {
		for (const candidate of this.candidates.values()) {
			if (candidate.record.status === "live")
				candidate.staged = candidate.record.stageListeners(candidate.run.decls);
		}
		for (const record of this.host.records.values()) {
			if (record.status === "live" && record.deferredRuntime)
				this.deferred.set(record, record.stageListeners(record.decls));
		}
	}

	async waitForRetirement(): Promise<void> {
		const host = this.host;
		if (host.previous === undefined) return;
		if (host.previous.roots.size > 0) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			await new Promise<void>((resolve) => {
				host.retired = resolve;
				timer = setTimeout(resolve, this.options.retireDeadline ?? 5000);
			});
			clearTimeout(timer);
			host.retired = noop;
		}
		// Roots of the dropped epoch still running get `superseded` on their next call.
		host.retire();
	}

	/** Builds the candidate service table: unchanged services plus everything the given facets serve. */
	load(): void {
		const replaced = new Set([...this.facets.map((facet) => facet.name), ...(this.options.remove ?? [])]);
		const current = this.host.current.services;
		this.services = new Map([...current].filter(([, service]) => !replaced.has(service.facet)));
		for (const facet of this.facets) {
			facet.setup(
				this.host.facetApi(((type: AnyContract, factory: Factory<AnyContract>, options: ServeOptions = {}) =>
					this.host.serveInto(this.services, makeService(type, factory, options, facet.name))) as Serve),
			);
		}
		for (const [name, service] of this.services) if (current.get(name) !== service) this.changed.add(name);
		for (const name of current.keys()) if (!this.services.has(name)) this.removed.add(name);
		this.host.pending = {
			id: this.host.nextEpochId(this.epoch),
			services: this.services,
			tables: new Map(),
			roots: new Map(),
		};
	}

	async withDeadline<T>(promise: Promise<T>, what: string): Promise<T> {
		const deadline = this.options.gateDeadline ?? 5000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new ChordError("aborted", `${what} within ${deadline} ms`, { reason: "deadline" })),
				deadline,
			);
		});
		try {
			return await Promise.race([promise, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** Same contract version must cover the old description (forgotten bump); facets' `uses` must bind. */
	checkProviders(): void {
		for (const name of this.changed) {
			const next = this.services.get(name)!.contract;
			const old = this.host.current.services.get(name)?.contract;
			if (old === undefined || old.version !== next.version) continue;
			const reason = coverage(next.description, old.description);
			if (reason !== undefined) {
				throw new ChordError(
					"contract_mismatch",
					`${name}@${next.version} changed incompatibly without a version bump (${reason})`,
				);
			}
		}
		const facets = new Map(this.host.facets);
		for (const facet of this.facets) facets.set(facet.name, facet);
		for (const name of this.options.remove ?? []) facets.delete(name);
		for (const facet of facets.values()) {
			for (const token of facet.uses ?? []) {
				const service = this.services.get(token.name);
				if (service !== undefined && this.changed.has(token.name))
					bind(service.contract, service.options.accepts, token);
			}
		}
	}

	/**
	 * Prepares every live record of a changed type, including records that activate meanwhile, to a fixpoint. Records
	 * already running the new code (types this reload adds) are skipped.
	 */
	async prepareAll(): Promise<void> {
		for (;;) {
			const todo = [...this.host.records.values()].filter(
				(record) =>
					this.changed.has(record.typeName) &&
					!this.candidates.has(record) &&
					record.service !== this.services.get(record.typeName) &&
					(record.status === "live" || record.status === "activating"),
			);
			if (todo.length === 0) return;
			await Promise.allSettled(todo.map((record) => record.ready));
			this.#alive();
			for (const record of todo) {
				if (record.status === "live" && record.service !== this.services.get(record.typeName)) {
					await this.prepareRecord(record);
					this.#alive();
				}
			}
		}
	}

	/** Runs the new factory in recording mode and opens what can be opened without the gate. */
	async prepareRecord(record: RecordImpl): Promise<void> {
		const service = this.services.get(record.typeName)!;
		const run = record.run(service, record.decls);
		const candidate: Candidate = {
			record,
			service,
			run,
			reasons: [],
			atGate: [],
			replaced: [],
			migrated: new Map(),
			derived: new Map(),
			staged: undefined,
		};
		this.candidates.set(record, candidate);
		const bumped = service.stateVersion !== record.stateVersion;
		if (bumped) candidate.reasons.push(`state version ${record.stateVersion} -> ${service.stateVersion}`);
		for (const [name, cell] of run.decls.cells) {
			if (record.decls.cells.get(name) !== cell || deepEqual(cell.schema, run.decls.cellSchemas.get(name))) continue;
			if (!bumped) {
				throw invalid("state", `${record.address}: schema of state ${name} changed without a state-version bump`);
			}
		}
		for (const name of Object.keys(service.options.state?.migrate ?? {})) {
			if (!run.decls.cells.has(name))
				throw invalid("state", `${record.address}: migrate for undeclared state ${name}`);
		}
		const deferred = new Set<ResourceImpl>();
		for (const resource of run.created.resources) {
			if (resource.exclusive || resource.deps.some((dep) => deferred.has(dep as ResourceImpl)))
				deferred.add(resource);
		}
		for (const resource of deferred) {
			candidate.atGate.push(resource);
			const old = record.decls.resources.get(resource.key);
			if (resource.exclusive && old?.exclusive && old.state === "open") candidate.replaced.push(old);
		}
		if (deferred.size > 0) candidate.reasons.push("exclusive resource replaced");
		if (candidate.reasons.length === 0) dryRun(candidate);
		await record.open(
			run.created.resources.filter((resource) => !deferred.has(resource)),
			run.created.holds,
			this.abort.signal,
		);
	}

	/**
	 * Every hold that survives into the new epoch must bind to the new provider. Browser holds don't block a reload:
	 * after the commit they get `upgrade_required` instead.
	 */
	checkHolds(): void {
		const dropped = new Set<unknown>();
		for (const { record, run } of this.candidates.values()) {
			for (const hold of record.decls.holds.values())
				if (![...run.decls.holds.values()].includes(hold)) dropped.add(hold);
		}
		for (const record of this.host.records.values()) {
			const service = this.services.get(record.typeName);
			if (service === undefined || !this.changed.has(record.typeName)) continue;
			for (const hold of record.holds) {
				// The host's bootstrap hold follows this provider at commit; it is not an old-code consumer.
				if (hold === this.host.eager.get(record.typeName)) continue;
				if (!dropped.has(hold) && hold.owner !== "client")
					bind(service.contract, service.options.accepts, hold.contract);
			}
		}
	}

	entries(): [RecordImpl, Run["decls"]][] {
		return this.host
			.liveDecls(true)
			.filter(([record]) => !this.removed.has(record.typeName))
			.map(([record, decls]) => [record, this.candidates.get(record)?.run.decls ?? decls]);
	}

	/**
	 * Admission cut, wait for grandfathered roots (deadline), replace exclusive resources, migrate into private
	 * copies. Old tasks of gated records are stopped at the cut; listener events are queued until commit or abort.
	 */
	async gate(): Promise<void> {
		this.gated = [...this.candidates.values()].filter(
			(candidate) => candidate.reasons.length > 0 && candidate.record.status === "live",
		);
		const drained = this.gated.map(({ record }) => {
			const grandfathered = new Set(record.leases.keys());
			return new Promise<void>((resolve) => {
				record.gate = { grandfathered, queue: [], drained: resolve };
				record.stopTasks();
				if (grandfathered.size === 0) resolve();
			});
		});
		const deadline = this.options.gateDeadline ?? 5000;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = await Promise.race([
			Promise.all(drained).then(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(true), deadline);
			}),
		]);
		clearTimeout(timer);
		if (timedOut) {
			const blocking = this.gated.flatMap(({ record }) => [...(record.gate?.grandfathered ?? [])]);
			throw new ChordError(
				"aborted",
				`gate deadline (${deadline} ms) missed; blocking roots: ${blocking.join(", ")}`,
				{
					reason: "gate_deadline",
					details: { blocking },
				},
			);
		}
		this.#alive();
		for (const candidate of this.gated) {
			const { record } = candidate;
			for (const old of candidate.replaced) {
				// Owned by the rollback before closing: a failing close must still be restored.
				this.closed.push([record, old]);
				await old.close(record.openOrder);
			}
			await record.open(candidate.atGate, [], this.abort.signal);
			this.#alive();
		}
		for (const candidate of this.gated) this.migrate(candidate);
	}

	migrate(candidate: Candidate): void {
		const { record, service, run } = candidate;
		const migrate = service.options.state?.migrate ?? {};
		const bumped = service.stateVersion !== record.stateVersion;
		for (const [name, cell] of run.decls.cells) {
			if (record.decls.cells.get(name) !== cell) continue;
			const schema = run.decls.cellSchemas.get(name)!;
			const fn = migrate[name];
			let value: unknown;
			if (bumped && fn !== undefined) value = fn(structuredClone(cell.value), record.stateVersion);
			else if (!deepEqual(cell.schema, schema)) value = cell.value;
			else continue;
			assertValid("state", `${record.address}: migrated state ${name}`, schema, value);
			candidate.migrated.set(cell, value);
		}
		dryRun(candidate);
	}

	async rollback(): Promise<void> {
		if (this.rolledBack) return;
		this.rolledBack = true;
		this.abort.abort(new ChordError("aborted", "reload aborted"));
		const report = (error: unknown): void => this.host.report(error);
		for (const candidate of this.candidates.values()) candidate.staged?.discard();
		for (const staged of this.deferred.values()) staged.discard();
		for (const { record, run } of this.candidates.values()) {
			record.pending.delete(run.decls);
			await record.unwind(run).catch(report);
		}
		// Replaced exclusive resources are restored; one that cannot be is marked unavailable, never silently closed.
		for (const [record, resource] of this.closed) {
			if (resource.state !== "closed") continue;
			await resource.open(new AbortController().signal, record.openOrder).catch((error: unknown) => {
				resource.markUnavailable();
				report(
					new ChordError("unavailable", `${record.address}: resource ${resource.key} could not be restored`, {
						cause: error,
					}),
				);
			});
		}
		for (const { record } of this.gated) {
			if (record.gate === undefined) continue;
			record.openGate();
			for (const name of record.decls.tasks.keys()) record.startTask(name, this.host.current.id);
		}
		// Records of types this reload would have added lose their code.
		const reason = new ChordError("gone", "reload aborted; type not served");
		for (const record of [...this.host.records.values()]) {
			if (!this.host.current.services.has(record.typeName)) await record.dispose(true, reason).catch(report);
		}
		this.host.pending = undefined;
		this.host.gating = undefined;
	}

	/**
	 * Publishes the new epoch in one synchronous step. Everything fallible ran in prepare (factories, opens, migration
	 * and derivation checks against the prospective schemas, listener subscriptions), so this only installs. Observers
	 * (state, shapes, registries, listener roots) are notified after the whole step. If an install still throws, the
	 * epoch is half-published: the host fails terminally and admits no more work.
	 */
	commit(beforeStart?: () => void): ReloadReport {
		try {
			return holdPublications(() => {
				const report = this.#publish();
				// Installed, not yet started: the coordinator queues its commit frames here, so nothing this epoch starts
				// (tasks, eager activations, then the held listener/registry/state notifications) can reach a child first.
				beforeStart?.();
				for (const start of this.#starts.splice(0)) start();
				return report;
			});
		} catch (error) {
			this.host.fail(error);
			throw reloadError(error);
		}
	}

	/** Work that may start new-epoch roots, run after installation (and after the coordinator's commit frames). */
	readonly #starts: (() => void)[] = [];

	#publish(): ReloadReport {
		const host = this.host;
		const previous = host.current;
		const next: EpochState = host.pending!;
		host.pending = undefined;
		host.epochs.set(next.id, next);
		host.previous = previous;
		host.current = next;
		const prepared: string[] = [];
		for (const record of [...host.records.values()]) {
			if (this.removed.has(record.typeName)) continue;
			const candidate = this.candidates.get(record);
			if (candidate === undefined) {
				const installed = record.behaviors.get(previous.id);
				if (installed !== undefined) record.behaviors.set(next.id, { ...installed, epoch: next.id });
				continue;
			}
			if (record.status !== "live") continue;
			this.install(candidate, next.id);
			prepared.push(record.address);
		}
		for (const { record, run, staged } of this.candidates.values()) {
			if (record.status === "live") continue;
			staged?.discard();
			record.pending.delete(run.decls);
			record.unwind(run).catch((error: unknown) => host.report(error));
		}
		// Records of types this reload adds start their runtime now.
		for (const [record, staged] of this.deferred) {
			if (record.status !== "live") {
				staged.discard();
				continue;
			}
			record.deferredRuntime = false;
			staged.activate();
			this.#starts.push(() => record.startTasks());
		}
		host.installTables(next, this.tables, true);
		const reason = new ChordError("gone", "type no longer served");
		for (const record of [...host.records.values()]) {
			if (this.removed.has(record.typeName))
				record.dispose(true, reason).catch((error: unknown) => host.report(error));
		}
		for (const name of this.removed) host.eager.delete(name);
		for (const facet of this.facets) host.facets.set(facet.name, facet);
		for (const name of this.options.remove ?? []) host.facets.delete(name);
		host.gating = undefined;
		for (const [name, service] of this.services) {
			if (service.options.eager && this.changed.has(name) && host.eager.get(name)?.record?.status !== "live") {
				this.#starts.push(() => host.startEager(service));
			}
		}
		return {
			epoch: next.id,
			previous: previous.id,
			changed: [...this.changed],
			removed: [...this.removed],
			prepared,
			gated: this.gated.map(({ record }) => record.address),
		};
	}

	install(candidate: Candidate, epoch: number): void {
		const { record, run, service } = candidate;
		const gated = candidate.reasons.length > 0;
		record.pending.delete(run.decls);
		record.stopTasks();
		if (gated) {
			// Old derivations would compute over migrated values; the old behavior can no longer run anyway.
			const kept = new Set(run.decls.derives.values());
			for (const derived of record.decls.derives.values()) if (!kept.has(derived)) derived.detach();
		}
		record.decls = run.decls;
		record.service = service;
		record.stateVersion = service.stateVersion;
		record.behaviors.set(epoch, { epoch, service, behavior: run.behavior, decls: run.decls });
		if (gated) {
			// Old code can never run over migrated state: drop the previous behavior now, not at retirement.
			record.minEpoch = epoch;
			for (const old of [...record.behaviors.keys()]) if (old !== epoch) this.host.retireBehavior(record, old);
		}
		// Schemas first, then the values validated against them in prepare.
		record.refreshSchemas();
		for (const [name, derived] of run.decls.derives) derived.setFn(run.decls.deriveFns.get(name)!);
		for (const [name, cell] of run.decls.cells) {
			const schema = run.decls.cellSchemas.get(name)!;
			if (candidate.migrated.has(cell)) cell.reset(candidate.migrated.get(cell), schema);
			else cell.schema = schema;
		}
		const created = new Set(run.created.derives);
		for (const derived of run.created.derives) derived.attach(candidate.derived);
		for (const derived of run.decls.derives.values()) if (!created.has(derived)) derived.refresh();
		candidate.staged?.activate();
		this.#starts.push(() => record.startTasks());
		record.openGate();
		const eager = this.host.eager.get(record.typeName);
		if (eager?.record === record && eager.contract.fingerprint !== service.contract.fingerprint) {
			const replacement = new HandleImpl(record, service.contract, "host");
			// Acquire first: releasing the only hold must not dispose/reopen the surviving eager record.
			record.addHold(replacement);
			this.host.eager.set(record.typeName, replacement);
			eager.release();
		}
		for (const handle of [...record.holds]) {
			// Browser holds whose contract no longer binds are told to reload their code (they never block a reload).
			if (handle.owner === "client") {
				try {
					bind(service.contract, service.options.accepts, handle.contract);
				} catch (error) {
					handle.gone(
						new ChordError("upgrade_required", `${record.typeName} changed; reload the web facets`, {
							cause: error,
						}),
					);
					record.release(handle);
					continue;
				}
			}
			handle.shapeChanged();
		}
	}
}
