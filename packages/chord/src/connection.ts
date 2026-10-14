import { contractFromDescription, LOCAL_VARIANT } from "./contract.ts";
import { type Encoder, encoder } from "./delta/index.ts";
import { ChordError, invalid } from "./errors.ts";
import type { HostImpl } from "./host.ts";
import { type Link, Packed, unpack } from "./link.ts";
import { type CtxImpl, RefImpl, variantOf } from "./object.ts";
import type { RemoteChannel, RemoteRef, StateSink } from "./remote.ts";
import { assertValid } from "./schema.ts";
import type { Ctx, Principal, Readable, StateEvent } from "./types.ts";
import { type Frame, fromWireError, isFrame, PROTOCOL_VERSION, type RootRef, toWireError } from "./wire.ts";

export interface LinkOptions {
	/** Milliseconds between pings (default 15000). */
	readonly pingInterval?: number;
	/** Close the link when nothing arrived for this long (default 45000). Everything held through it is released. */
	readonly pingTimeout?: number;
	/**
	 * Unacknowledged frame bytes (JSON text length) beyond which state frames wait for the peer (default 256 KiB). Only
	 * applies when both ends acknowledge frames and the link reports sizes; `Infinity` never holds state back.
	 */
	readonly window?: number;
	/**
	 * The peer speaks another link protocol version (`peer`: undefined if it did not say): the link closes, and should
	 * not be reconnected with the same code. A browser reloads its page, for instance.
	 */
	readonly onProtocolMismatch?: (versions: { readonly local: number; readonly peer: number | undefined }) => void;
}

const DEFAULT_WINDOW = 256 * 1024;
/** A waiting subscription keeps at most this many windows of ops; beyond, its current value replaces them. */
const PENDING_WINDOWS = 4;

type StateFrame = Extract<Frame, { t: "state" }>;

/**
 * What waits for one subscription: a snapshot, reset or error (`base`), then encoded ops to apply after it, in order.
 * Ops stay as they arrived (the receiving decoder validates them).
 */
type PendingState = { base: StateFrame | undefined; ops: (readonly unknown[])[]; size: number };

export interface AcceptOptions extends LinkOptions {
	/** The principal of whatever connects, from the app's authenticator. Every request on the link acts as it. */
	readonly principal: Principal;
	/**
	 * What the peer is, decided here and never by its `hello`: `client` (default; a browser: no roots, no code versions,
	 * not a reload participant, not addressable) or `host` (a child host; needs `name`).
	 */
	readonly kind?: "host" | "client";
	/** A child host's name: its hello must match, and it is reachable `at` this name. */
	readonly name?: string;
	/** On `invalidatePrincipal`: a new principal keeps the link, `undefined` closes it (default: close). */
	readonly restamp?: (principal: Principal) => Principal | undefined;
	/**
	 * Calls the peer may have in progress on this link (default: no limit). Further ones never run: they are answered
	 * at once with `unavailable` (reason `too_many_calls`), and the link stays open.
	 */
	readonly maxCalls?: number;
}

export interface Peer {
	readonly kind: "host" | "client";
	/** Configured (downstream hosts) or announced by the trusted parent (upstream). */
	readonly name: string | undefined;
}

/** A hold the peer made on this host: served locally or relayed to another link. */
type Served =
	| { readonly kind: "local"; readonly ref: RefImpl; readonly principal: Principal; readonly feeds: Set<number> }
	| { readonly kind: "relay"; readonly relay: RelayRef };

type Pending = { readonly resolve: (value: unknown) => void; readonly reject: (error: unknown) => void };

const unavailable = (message: string): ChordError => new ChordError("unavailable", message);

// ─── relay ───────────────────────────────────────────────────────────────────

/**
 * A hold relayed from an origin link to a downstream link. It owns everything done through it: subscriptions and
 * calls queued while the route resolves, and the downstream twins once forwarded. `close` undoes all of it exactly
 * once (cancels calls downstream, drops subscriptions, releases the downstream hold, rejects waiters).
 */
export class RelayRef {
	readonly origin: Connection;
	readonly frame: Extract<Frame, { t: "hold" }>;
	readonly principal: Principal;
	readonly client: boolean;
	/** The origin's authorization generation when the hold arrived; a revocation bumps it. */
	readonly generation: number;
	down: Connection | undefined;
	downId = 0;
	closed = false;
	readonly calls = new Map<number, RelayCall>();
	readonly subs = new Map<number, { readonly member: string; downId: number | undefined }>();
	readonly #waiters = new Set<Pending>();

	constructor(origin: Connection, frame: Extract<Frame, { t: "hold" }>, principal: Principal, client: boolean) {
		this.origin = origin;
		this.frame = frame;
		this.principal = principal;
		this.client = client;
		this.generation = origin.generation;
	}

	get originId(): number {
		return this.frame.id;
	}

	/** Still authorized as it was when it arrived. */
	get current(): boolean {
		return !this.closed && this.origin.open && this.origin.generation === this.generation;
	}

	/** The downstream connection once the route resolved; rejects if the relay closes first. */
	ready(): Promise<Connection> {
		if (this.closed) return Promise.reject(new ChordError("gone", "relayed hold closed"));
		if (this.down !== undefined) return Promise.resolve(this.down);
		return new Promise<Connection>((resolve, reject) => {
			this.#waiters.add({ resolve: resolve as (value: unknown) => void, reject });
		});
	}

	/** Forwards the hold (and what queued meanwhile) to `down`. */
	open(down: Connection): void {
		if (this.closed) return;
		this.down = down;
		this.downId = down.nextId();
		down.relayedRefs.set(this.downId, this);
		down.send({
			...this.frame,
			id: this.downId,
			principal: this.principal,
			...(this.client ? { client: true } : {}),
		});
		for (const [originSubId, entry] of this.subs)
			if (entry.downId === undefined) this.#forwardSub(originSubId, entry);
		for (const waiter of this.#waiters) waiter.resolve(down);
		this.#waiters.clear();
	}

	subscribe(originSubId: number, member: string): void {
		const entry = { member, downId: undefined as number | undefined };
		this.subs.set(originSubId, entry);
		this.origin.relaySubs.set(originSubId, this);
		if (this.down !== undefined) this.#forwardSub(originSubId, entry);
	}

	#forwardSub(originSubId: number, entry: { readonly member: string; downId: number | undefined }): void {
		const down = this.down!;
		entry.downId = down.nextId();
		down.relayedSubs.set(entry.downId, { relay: this, originSubId });
		down.send({ t: "sub", id: entry.downId, hold: this.downId, member: entry.member });
	}

	/**
	 * The origin could not keep up and dropped what waited for this subscription: subscribe downstream anew, so the
	 * provider's snapshot (a reset for the origin's consumer) replaces the ops that were lost.
	 */
	resync(originSubId: number): void {
		const entry = this.subs.get(originSubId);
		this.origin.dropState(originSubId);
		if (entry?.downId === undefined || this.down === undefined) return;
		this.down.relayedSubs.delete(entry.downId);
		this.down.send({ t: "unsub", id: entry.downId });
		this.#forwardSub(originSubId, entry);
	}

	unsubscribe(originSubId: number, forward = true): void {
		const entry = this.subs.get(originSubId);
		if (entry === undefined) return;
		this.subs.delete(originSubId);
		this.origin.relaySubs.delete(originSubId);
		this.origin.dropState(originSubId);
		if (entry.downId !== undefined && this.down !== undefined) {
			this.down.relayedSubs.delete(entry.downId);
			if (forward) this.down.send({ t: "unsub", id: entry.downId });
		}
	}

	/**
	 * Closes the relay. `releaseDown`: the downstream hold is still there (origin released, disconnected, or was
	 * revoked): cancel its calls and release it. `notify`: tell the origin the hold is gone.
	 */
	close(error: unknown, options: { readonly releaseDown: boolean; readonly notify: boolean }): void {
		if (this.closed) return;
		this.closed = true;
		for (const call of [...this.calls.values()]) call.cancel(error, options.releaseDown);
		for (const originSubId of [...this.subs.keys()]) this.unsubscribe(originSubId, options.releaseDown);
		if (this.origin.served.get(this.originId)?.kind === "relay") this.origin.served.delete(this.originId);
		if (this.down !== undefined) {
			this.down.relayedRefs.delete(this.downId);
			if (options.releaseDown) this.down.send({ t: "release", id: this.downId });
		}
		for (const waiter of this.#waiters) waiter.reject(error);
		this.#waiters.clear();
		if (options.notify) this.origin.send({ t: "gone", id: this.originId, error: toWireError(error) });
	}
}

/** One relayed call: settles once, by result, cancellation or the relay closing; removes both mappings. */
export class RelayCall {
	readonly relay: RelayRef;
	readonly originId: number;
	readonly downId: number;
	readonly #pending: Pending;
	#settled = false;

	constructor(relay: RelayRef, originId: number, downId: number, pending: Pending) {
		this.relay = relay;
		this.originId = originId;
		this.downId = downId;
		this.#pending = pending;
		relay.calls.set(originId, this);
		relay.down?.relayedCalls.set(downId, this);
	}

	finish(error: unknown, value?: unknown): void {
		if (this.#settled) return;
		this.#settled = true;
		this.relay.calls.delete(this.originId);
		this.relay.down?.relayedCalls.delete(this.downId);
		if (error === undefined) this.#pending.resolve(value);
		else this.#pending.reject(error);
	}

	/** Cancels downstream (when the downstream hold still exists) and settles with `error`. */
	cancel(error: unknown, forward: boolean): void {
		if (this.#settled) return;
		if (forward) this.relay.down?.send({ t: "cancel", id: this.downId });
		this.finish(error);
	}
}

// ─── connection ──────────────────────────────────────────────────────────────

/**
 * One end of a link on a host: consumer of remote references, provider for the peer's holds, and relay.
 *
 * Flow control
 * ------------
 *
 * Problem: state is pushed as fast as it changes, but a peer may read slowly (a phone behind a relay), and a relay may
 * hide that: Cloudflare forwards to browsers without backpressure. Everything sent then queues in front of the next
 * call result. Example: a browser opens three long transcripts (500 KiB of snapshots each) over a 5 Mbit/s path; a
 * result sent next waits 2.4 s, and the snapshot of a transcript the user already left is still sent in full.
 *
 * Solution: the peer acknowledges what it processed (`ack`, a cumulative frame count), and the sender counts the sizes
 * of the frames not yet acknowledged. While they exceed the window, *state* frames wait here, one slot per
 * subscription: ops are appended to the slot (encoded batches of one stream may be concatenated, see `encoder`), and
 * a snapshot, reset or error replaces it. Unsubscribing drops the slot. A slot whose ops outgrow `PENDING_WINDOWS`
 * windows is replaced by the current value (a reset), or, on a relay, by a fresh downstream subscription (`resync`),
 * so memory stays bounded however long the peer stalls. Acknowledgements send the slots in the order they were
 * created, as long as the window allows.
 *
 * Everything else (results, shapes, gone, reload control, pings) is sent at once: it is bounded by the requests the
 * peer makes, and it must not wait behind state. Hence the one ordering exception of a link: while state waits, a
 * result can arrive before state changes made before it. Frames of one subscription stay in order.
 *
 * The window bounds what is unacknowledged when a frame is sent, so one frame (a large snapshot) may exceed it. Both
 * hellos must announce `acks`; with an older peer nothing is acknowledged and nothing waits. Links that do not report
 * sizes (IPC) never fill the window.
 */
export class Connection implements RemoteChannel {
	readonly host: HostImpl;
	readonly link: Link;
	/** `upstream`: the link to this host's parent. `downstream`: a link this host accepted. */
	readonly role: "upstream" | "downstream";
	readonly peer: Peer;
	principal: Principal;
	readonly restamp: ((principal: Principal) => Principal | undefined) | undefined;
	/** Bumped when the stamped principal is revoked or re-stamped: relays from before are refused. */
	generation = 0;
	/** The code version a downstream host peer runs (from its hello, then from commits). */
	peerCodeVersion: number | undefined;
	/** A downstream host peer is usable once it runs this host's current code version (see `HostImpl.peerHello`). */
	synced: boolean;
	/** Code versions this child announced while behind this host (fenced): this host never ran them. */
	readonly fencedCodeVersions = new Set<number>();
	/** Roots of fenced code versions, by the code version of this host they were admitted in. */
	readonly #admitted = new Map<string, number>();
	#parentName: string | undefined;
	readonly #syncWaiters = new Set<Pending>();
	#nextId = 1;
	#lastSeen = Date.now();
	#pinger: ReturnType<typeof setInterval> | undefined;
	readonly #maxCalls: number;
	// flow control (see the class comment)
	readonly #window: number;
	/** Whether the peer acknowledges frames; until its hello is here, frames are counted in case it does. */
	#peerAcks: boolean | undefined;
	#sent = 0;
	#acked = 0;
	/** Sizes of the frames sent after the last acknowledged one. */
	#unacked: number[] = [];
	#unackedBytes = 0;
	readonly #pending = new Map<number, PendingState>();
	#received = 0;
	#ackTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #onProtocolMismatch: LinkOptions["onProtocolMismatch"];
	/** The peer speaks another protocol version: nothing it sends is processed any more. */
	#mismatched = false;
	// consumer side: what this host asked of the peer
	readonly remotes = new Map<number, RemoteRef>();
	readonly calls = new Map<number, Pending>();
	readonly subs = new Map<number, (frame: StateSink) => void>();
	// provider side: what the peer asked of this host
	readonly served = new Map<number, Served>();
	readonly incoming = new Map<number, AbortController>();
	readonly feeds = new Map<number, () => void>();
	/** Origin side of relays: the peer's sub ids that are relayed. */
	readonly relaySubs = new Map<number, RelayRef>();
	// downstream side of relays: ids this host used on this link
	readonly relayedRefs = new Map<number, RelayRef>();
	readonly relayedCalls = new Map<number, RelayCall>();
	readonly relayedSubs = new Map<number, { readonly relay: RelayRef; readonly originSubId: number }>();
	/** Reload votes awaited from this (child) peer. */
	readonly votes = new Map<number, Pending>();

	constructor(
		host: HostImpl,
		link: Link,
		config: {
			readonly role: "upstream" | "downstream";
			readonly principal: Principal;
			readonly peer: Peer;
			readonly restamp?: (principal: Principal) => Principal | undefined;
			readonly maxCalls?: number;
		} & LinkOptions,
	) {
		this.host = host;
		this.link = link;
		this.role = config.role;
		this.peer = config.peer;
		this.principal = config.principal;
		this.restamp = config.restamp;
		this.synced = !(this.role === "downstream" && this.peer.kind === "host");
		this.#window = config.window ?? DEFAULT_WINDOW;
		this.#maxCalls = config.maxCalls ?? Number.POSITIVE_INFINITY;
		this.#onProtocolMismatch = config.onProtocolMismatch;
		link.onClose((reason) => this.#closed(reason));
		link.receive((frame) => this.#receive(frame));
		this.send({
			t: "hello",
			protocol: PROTOCOL_VERSION,
			name: host.name,
			kind: host.kind,
			codeVersion: host.current.id,
			acks: true,
		});
		const interval = config.pingInterval ?? 15_000;
		const timeout = config.pingTimeout ?? 45_000;
		// A link that was already closed closed this connection above; it needs no keepalive.
		if (link.closed) return;
		let n = 0;
		this.#pinger = setInterval(() => {
			if (Date.now() - this.#lastSeen > timeout) link.close("ping timeout");
			else this.send({ t: "ping", n: ++n });
		}, interval);
		this.#pinger.unref?.();
	}

	get open(): boolean {
		return !this.link.closed;
	}

	/** The peer's name: configured for downstream hosts, announced by the parent upstream. */
	get name(): string | undefined {
		return this.role === "upstream" ? this.#parentName : this.peer.name;
	}

	send(frame: Frame): void {
		const size = this.link.send(frame) ?? 0;
		if (this.#peerAcks === false) return;
		this.#sent++;
		this.#unacked.push(size);
		this.#unackedBytes += size;
	}

	/** Sends a state frame, or keeps it waiting (see the class comment). False: the slot is full, send a reset. */
	sendState(frame: StateFrame): boolean {
		let slot = this.#pending.get(frame.id);
		if (slot === undefined && !this.#full) {
			this.send(frame);
			return true;
		}
		if (slot === undefined) {
			slot = { base: undefined, ops: [], size: 0 };
			this.#pending.set(frame.id, slot);
		}
		if (frame.ops === undefined) {
			slot.base = frame;
			slot.ops = [];
			slot.size = 0;
			return true;
		}
		const size = JSON.stringify(frame.ops).length;
		if (slot.size + size > this.#window * PENDING_WINDOWS) return false;
		for (const op of frame.ops) slot.ops.push(op);
		slot.size += size;
		return true;
	}

	/** Forgets what waits for a subscription that ended. */
	dropState(id: number): void {
		this.#pending.delete(id);
	}

	get #full(): boolean {
		return this.#peerAcks === true && this.#unackedBytes >= this.#window;
	}

	#onAck(n: number): void {
		if (this.#peerAcks !== true || n < this.#acked || n > this.#sent) {
			this.#violation(`ack ${n} outside ${this.#acked}..${this.#sent}`);
			return;
		}
		for (const size of this.#unacked.splice(0, n - this.#acked)) this.#unackedBytes -= size;
		this.#acked = n;
		for (const [id, slot] of this.#pending) {
			if (this.#full) return;
			this.#pending.delete(id);
			if (slot.base !== undefined) this.send(slot.base);
			if (slot.ops.length > 0) this.send({ t: "state", id, ops: slot.ops });
		}
	}

	/** Acknowledges once the frames that arrived together are processed: one ack per burst, not per frame. */
	#scheduleAck(): void {
		if (this.#peerAcks !== true || this.#ackTimer !== undefined || !this.open) return;
		this.#ackTimer = setTimeout(() => {
			this.#ackTimer = undefined;
			this.link.send({ t: "ack", n: this.#received });
		}, 0);
		this.#ackTimer.unref?.();
	}

	nextId(): number {
		return this.#nextId++;
	}

	/** Resolves once the peer is usable (a host peer runs this host's code version); rejects if the link closes first. */
	whenSynced(): Promise<void> {
		if (!this.open) return Promise.reject(unavailable(`link to ${this.name ?? "peer"} closed`));
		if (this.synced) return Promise.resolve();
		return new Promise<void>((resolve, reject) => this.#syncWaiters.add({ resolve: resolve as () => void, reject }));
	}

	markSynced(codeVersion: number): void {
		this.peerCodeVersion = codeVersion;
		this.synced = true;
		for (const waiter of this.#syncWaiters) waiter.resolve(undefined);
		this.#syncWaiters.clear();
	}

	/** Revokes the stamped principal: relays made under it close at once (also those still resolving a route). */
	revoke(next: Principal | undefined): void {
		this.generation++;
		const error = new ChordError("gone", "principal invalidated");
		for (const served of [...this.served.values()]) {
			if (served.kind === "relay") served.relay.close(error, { releaseDown: true, notify: true });
		}
		if (next === undefined) this.link.close("principal invalidated");
		else this.principal = next;
	}

	/** A protocol violation: the peer cannot be trusted with anything on this link any more. */
	/**
	 * Stops talking to a peer of another protocol version: reports it and closes the link. The close reason tells the
	 * peer this side's version (`protocol-version <n>`); a peer that noticed first told us the same way (`#closed`).
	 */
	#protocolMismatch(peer: number | undefined, close = true): void {
		if (this.#mismatched) return;
		this.#mismatched = true;
		try {
			this.#onProtocolMismatch?.({ local: PROTOCOL_VERSION, peer });
		} catch (error) {
			this.host.report(error);
		}
		if (close) this.link.close(`protocol-version ${PROTOCOL_VERSION}`);
	}

	#violation(reason: string): void {
		this.host.report(new ChordError("invalid", `link to ${this.name ?? "peer"}: ${reason}`, { reason: "protocol" }));
		this.link.close(`protocol error: ${reason}`);
	}

	// ─── consumer side (RemoteChannel) ───

	hold(ref: RemoteRef): number {
		const id = this.nextId();
		this.remotes.set(id, ref);
		ref.bound(this, id);
		const principal = ref.principal;
		this.send({
			t: "hold",
			id,
			at: ref.at,
			token: ref.contract.description,
			input: ref.input,
			...(principal === undefined ? {} : { principal }),
			...(ref.owner === "client" ? { client: true } : {}),
		});
		return id;
	}

	release(id: number): void {
		this.remotes.delete(id);
		this.send({ t: "release", id });
	}

	call(hold: number, member: string, args: unknown, root: RootRef | undefined, signal: AbortSignal): Promise<unknown> {
		const id = this.nextId();
		return new Promise<unknown>((resolve, reject) => {
			if (signal.aborted) {
				reject(new ChordError("aborted", "call aborted"));
				return;
			}
			const onAbort = (): void => {
				this.calls.delete(id);
				this.send({ t: "cancel", id });
				reject(new ChordError("aborted", "call aborted", { cause: signal.reason }));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			const done = (): void => signal.removeEventListener("abort", onAbort);
			this.calls.set(id, {
				resolve: (value) => {
					done();
					resolve(value);
				},
				reject: (error) => {
					done();
					reject(error);
				},
			});
			// Clients never carry roots or code versions: the server starts roots for them.
			const carried = root !== undefined && this.host.kind === "host";
			if (carried) this.host.rootSent(root.rootId, this);
			this.send({ t: "call", id, hold, member, args, ...(carried ? { root } : {}) });
		});
	}

	sub(hold: number, member: string, sink: (frame: StateSink) => void): number {
		const id = this.nextId();
		this.subs.set(id, sink);
		this.send({ t: "sub", id, hold, member });
		return id;
	}

	unsub(id: number): void {
		if (this.subs.delete(id)) this.send({ t: "unsub", id });
	}

	// ─── receiving ───

	#receive(frame: unknown): void {
		if (this.#mismatched) return;
		this.#lastSeen = Date.now();
		if (!isFrame(frame)) {
			this.#violation("malformed frame");
			return;
		}
		if (frame.t === "ack") {
			this.#onAck(frame.n);
			return;
		}
		this.#received++;
		try {
			this.#dispatch(frame);
		} catch (error) {
			this.host.report(error);
		}
		this.#scheduleAck();
	}

	#dispatch(frame: Frame): void {
		switch (frame.t) {
			case "hello":
				this.#onHello(frame);
				return;
			case "ping":
				this.send({ t: "pong", n: frame.n });
				return;
			case "pong":
			case "bye":
			case "ack":
				return;
			case "hold":
				this.#onHold(frame);
				return;
			case "release":
				this.#dropServed(frame.id, true);
				return;
			case "call":
				this.#onCall(frame);
				return;
			case "cancel":
				this.incoming.get(frame.id)?.abort(new ChordError("aborted", "cancelled by caller"));
				return;
			case "sub":
				this.#onSub(frame);
				return;
			case "unsub":
				this.#onUnsub(frame.id);
				return;
			case "shape":
			case "gone":
				this.#onHoldReply(frame);
				return;
			case "result":
				this.#onResult(frame);
				return;
			case "state":
				this.#onState(frame);
				return;
			case "root_end":
				// Honored only from the link the root came over (see HostImpl.foreignRootEnded).
				this.#admitted.delete(frame.rootId);
				this.host.foreignRootEnded(frame.rootId, this);
				return;
			case "invalidate":
			case "prepare":
			case "commit":
			case "abort":
			case "retire":
				// Control frames only from the parent.
				if (this.role !== "upstream") {
					this.#violation(`${frame.t} from a child`);
					return;
				}
				if (frame.t === "invalidate") {
					this.host.invalidatePrincipal(frame.pattern).catch((error: unknown) => this.host.report(error));
				} else if (frame.t === "retire") this.host.allowRetire(frame.codeVersion);
				else this.host.onReloadFrame(this, frame);
				return;
			case "vote": {
				if (this.role !== "downstream" || this.peer.kind !== "host") {
					this.#violation("vote from a non-participant");
					return;
				}
				const vote = this.votes.get(frame.reload);
				this.votes.delete(frame.reload);
				if (frame.error === undefined) vote?.resolve(frame.report);
				else vote?.reject(fromWireError(frame.error));
				return;
			}
		}
	}

	/**
	 * The peer's hello must agree with what this side decided about it. A downstream host announces its code version:
	 * the host either finds it in step or fences and reconciles it (never renumbers).
	 */
	#onHello(frame: Extract<Frame, { t: "hello" }>): void {
		if ((frame.protocol ?? 1) !== PROTOCOL_VERSION) {
			this.#protocolMismatch(frame.protocol ?? 1);
			return;
		}
		if (this.#peerAcks === undefined) {
			this.#peerAcks = frame.acks === true;
			if (!this.#peerAcks) {
				this.#unacked = [];
				this.#unackedBytes = 0;
			}
		}
		if (this.role === "upstream") {
			if (frame.kind !== "host") {
				this.#violation("parent is not a host");
				return;
			}
			this.#parentName ??= frame.name;
			return;
		}
		if (frame.kind !== this.peer.kind || (this.peer.name !== undefined && frame.name !== this.peer.name)) {
			this.#violation(
				`hello ${frame.kind} ${frame.name} does not match the accepted ${this.peer.kind} ${this.peer.name ?? ""}`,
			);
			return;
		}
		if (this.peer.kind === "host") this.host.peerHello(this, frame.codeVersion);
	}

	/**
	 * Principal stamping: a downstream link acts as the principal it was accepted with, whatever the frame says. Only
	 * the parent may forward a principal (relayed requests); its own requests act as `{ host: parentName }`.
	 */
	#principalOf(frame: { readonly principal?: Principal }): Principal {
		if (this.role === "downstream") return this.principal;
		return frame.principal ?? { host: this.#parentName ?? "parent" };
	}

	#isClient(frame: { readonly client?: boolean }): boolean {
		return this.role === "downstream" ? this.peer.kind === "client" : frame.client === true;
	}

	#onHold(frame: Extract<Frame, { t: "hold" }>): void {
		if (this.served.has(frame.id)) {
			this.#violation(`duplicate hold id ${frame.id}`);
			return;
		}
		const principal = this.#principalOf(frame);
		const client = this.#isClient(frame);
		if (frame.at !== this.host.name) {
			if (this.role === "upstream") {
				this.send({ t: "gone", id: frame.id, error: toWireError(unavailable(`${this.host.name} does not relay`)) });
				return;
			}
			const relay = new RelayRef(this, frame, principal, client);
			this.served.set(frame.id, { kind: "relay", relay });
			this.host.relay(relay).catch((error: unknown) => relay.close(error, { releaseDown: true, notify: true }));
			return;
		}
		let ref: RefImpl;
		try {
			const token = contractFromDescription(frame.token);
			if (token.scope !== "remote") throw invalid("token", `${token.name} is local; only remote types cross links`);
			const acquired = this.host.acquire(token, frame.input, { principal }, client ? "client" : "connection");
			if (!(acquired instanceof RefImpl)) throw unavailable("not a local reference");
			ref = acquired;
		} catch (error) {
			this.send({ t: "gone", id: frame.id, error: toWireError(client ? clientError(error) : error) });
			return;
		}
		const served: Served = { kind: "local", ref, principal, feeds: new Set() };
		this.served.set(frame.id, served);
		const shape = (): void => {
			const current = ref.shape;
			if (current === undefined || this.served.get(frame.id) !== served) return;
			this.send({
				t: "shape",
				id: frame.id,
				variant: current.variant,
				members: current.members,
				contract: current.contract,
				codeVersion: current.codeVersion,
			});
		};
		ref.onShape(shape);
		ref.goneListeners.add((error) => {
			if (this.served.get(frame.id) !== served) return;
			this.#dropServed(frame.id, false);
			this.send({ t: "gone", id: frame.id, error: toWireError(error) });
		});
		if (ref.status === "live") shape();
	}

	/** Forgets a served hold: unsubscribes its feeds and releases it (locally or downstream). */
	#dropServed(id: number, release: boolean): void {
		const served = this.served.get(id);
		if (served === undefined) return;
		this.served.delete(id);
		if (served.kind === "relay") {
			served.relay.close(new ChordError("released", "relayed hold released"), {
				releaseDown: release,
				notify: false,
			});
			return;
		}
		for (const feed of served.feeds) this.#onUnsub(feed);
		if (release) served.ref.release();
	}

	#onCall(frame: Extract<Frame, { t: "call" }>): void {
		if (this.incoming.has(frame.id)) {
			this.#violation(`duplicate call id ${frame.id}`);
			return;
		}
		if (this.incoming.size >= this.#maxCalls) {
			const error = new ChordError(
				"unavailable",
				`Too many calls in progress on this connection (${this.#maxCalls}); wait for earlier ones to finish`,
				{ reason: "too_many_calls" },
			);
			this.send({ t: "result", id: frame.id, error: toWireError(error) });
			return;
		}
		const served = this.served.get(frame.hold);
		if (served === undefined) {
			this.send({ t: "result", id: frame.id, error: toWireError(new ChordError("gone", "unknown hold")) });
			return;
		}
		const controller = new AbortController();
		this.incoming.set(frame.id, controller);
		// Roots are honored from hosts only; a request without one (or from a client) starts one here.
		const root = this.peer.kind === "host" ? this.#admitRoot(frame.root) : undefined;
		const principal = served.kind === "local" ? served.principal : served.relay.principal;
		const options = { principal, signal: controller.signal };
		const run =
			served.kind === "local"
				? (ctx: Ctx) => served.ref.object.call(served.ref, frame.member, unpack(frame.args), ctx as CtxImpl)
				: (ctx: Ctx) =>
						relayCall(
							served.relay,
							frame,
							{ rootId: ctx.rootId, codeVersion: ctx.codeVersion },
							// The root's signal: a cancel from the origin and the root's code version retiring both reach it.
							ctx.signal,
							this.host,
						);
		const result =
			root === undefined
				? this.host.root(run, options)
				: this.host.joinRoot(root.rootId, root.codeVersion, run, { ...options, from: this });
		result
			.then(
				(value) => this.send({ t: "result", id: frame.id, value }),
				(error: unknown) => this.send({ t: "result", id: frame.id, error: toWireError(error) }),
			)
			.finally(() => this.incoming.delete(frame.id));
	}

	/**
	 * A child that connected behind this host runs roots of a code version this host never had (it was fenced and is
	 * being, or was, reconciled). Such a root is admitted in this host's current code version at its first call here,
	 * and keeps that code version for its later calls (`superseded` once this host retired it). Other unknown code
	 * versions stay `superseded`.
	 */
	#admitRoot(root: RootRef | undefined): RootRef | undefined {
		if (root === undefined || this.role !== "downstream" || !this.fencedCodeVersions.has(root.codeVersion))
			return root;
		if (this.host.hasCodeVersion(root.codeVersion)) return root;
		let codeVersion = this.#admitted.get(root.rootId);
		if (codeVersion === undefined) {
			codeVersion = this.host.current.id;
			this.#admitted.set(root.rootId, codeVersion);
		}
		return { rootId: root.rootId, codeVersion };
	}

	#onSub(frame: Extract<Frame, { t: "sub" }>): void {
		if (this.feeds.has(frame.id) || this.relaySubs.has(frame.id)) {
			this.#violation(`duplicate sub id ${frame.id}`);
			return;
		}
		const served = this.served.get(frame.hold);
		if (served === undefined) {
			this.send({ t: "state", id: frame.id, error: toWireError(new ChordError("gone", "unknown hold")) });
			return;
		}
		if (served.kind === "relay") {
			served.relay.subscribe(frame.id, frame.member);
			return;
		}
		const readable = served.ref.member(frame.member) as Readable<unknown> | undefined;
		if (readable === undefined || typeof readable.events !== "function") {
			this.send({
				t: "state",
				id: frame.id,
				error: toWireError(new ChordError("not_in_variant", `${frame.member} is not state`)),
			});
			return;
		}
		let stream: Encoder = encoder();
		const send = (event: StateEvent<unknown>): void => {
			if (event.type === "ops") {
				if (this.sendState({ t: "state", id: frame.id, ops: stream.encode(event.ops) })) return;
				// Too many ops wait for a slow peer: the current value replaces them.
				event = { type: "reset", value: event.value };
			}
			// A loading provider reference has nothing yet: the hydrated value follows as a reset.
			if (event.value === undefined) return;
			// Snapshots are validated against the effective schema once per (re)subscription; ops only in dev mode.
			try {
				validateSnapshot(served.ref, frame.member, event.value);
			} catch (error) {
				this.sendState({ t: "state", id: frame.id, error: toWireError(error) });
				return;
			}
			stream = encoder();
			this.sendState(
				event.type === "snap"
					? { t: "state", id: frame.id, snap: event.value }
					: { t: "state", id: frame.id, reset: event.value },
			);
		};
		const unsubscribe = readable.events(send);
		this.feeds.set(frame.id, unsubscribe);
		served.feeds.add(frame.id);
	}

	#onUnsub(id: number): void {
		this.dropState(id);
		const unsubscribe = this.feeds.get(id);
		if (unsubscribe !== undefined) {
			this.feeds.delete(id);
			unsubscribe();
		}
		this.relaySubs.get(id)?.unsubscribe(id);
	}

	#onHoldReply(frame: Extract<Frame, { t: "shape" | "gone" }>): void {
		const relay = this.relayedRefs.get(frame.id);
		if (relay !== undefined) {
			if (frame.t === "gone") relay.close(fromWireError(frame.error), { releaseDown: false, notify: true });
			else if (!relay.closed) relay.origin.send({ ...frame, id: relay.originId });
			return;
		}
		const ref = this.remotes.get(frame.id);
		if (ref === undefined) return;
		if (frame.t === "gone") {
			this.remotes.delete(frame.id);
			ref.gone(fromWireError(frame.error));
			return;
		}
		ref.shaped({
			variant: frame.variant,
			members: frame.members,
			contract: frame.contract,
			codeVersion: frame.codeVersion,
		});
	}

	#onResult(frame: Extract<Frame, { t: "result" }>): void {
		const relayed = this.relayedCalls.get(frame.id);
		if (relayed !== undefined) {
			relayed.finish(frame.error === undefined ? undefined : fromWireError(frame.error), frame.value);
			return;
		}
		const pending = this.calls.get(frame.id);
		this.calls.delete(frame.id);
		if (frame.error !== undefined) {
			pending?.reject(fromWireError(frame.error));
			return;
		}
		let value: unknown;
		try {
			value = unpack(frame.value);
		} catch (error) {
			pending?.reject(error);
			return;
		}
		pending?.resolve(value);
	}

	#onState(frame: Extract<Frame, { t: "state" }>): void {
		const relayed = this.relayedSubs.get(frame.id);
		if (relayed !== undefined) {
			if (!relayed.relay.origin.sendState({ ...frame, id: relayed.originSubId })) {
				relayed.relay.resync(relayed.originSubId);
			}
			return;
		}
		const sink = this.subs.get(frame.id);
		if (sink === undefined) return;
		if (!(frame.snap instanceof Packed) && !(frame.reset instanceof Packed)) {
			sink(frame);
			return;
		}
		let unpacked: StateSink;
		try {
			unpacked =
				frame.snap !== undefined
					? { ...frame, snap: unpack(frame.snap) }
					: { ...frame, reset: unpack(frame.reset) };
		} catch (error) {
			unpacked = { error: toWireError(error) };
		}
		sink(unpacked);
	}

	// ─── lifetime ───

	#closed(reason: string): void {
		const told = /^protocol-version (\d+)$/.exec(reason);
		if (told !== null && Number(told[1]) !== PROTOCOL_VERSION) this.#protocolMismatch(Number(told[1]), false);
		if (this.#pinger !== undefined) clearInterval(this.#pinger);
		if (this.#ackTimer !== undefined) clearTimeout(this.#ackTimer);
		this.#pending.clear();
		const error = unavailable(`link to ${this.name ?? "peer"} closed: ${reason}`);
		// As origin: everything the peer held here, relayed or not, is released (downstream calls cancelled).
		for (const id of [...this.served.keys()]) this.#dropServed(id, true);
		for (const controller of this.incoming.values()) controller.abort(error);
		this.incoming.clear();
		for (const pending of this.calls.values()) pending.reject(error);
		this.calls.clear();
		this.subs.clear();
		for (const vote of this.votes.values()) vote.reject(error);
		this.votes.clear();
		for (const waiter of this.#syncWaiters) waiter.reject(error);
		this.#syncWaiters.clear();
		// As downstream of relays: their origins lose the hold.
		for (const relay of [...this.relayedRefs.values()]) relay.close(error, { releaseDown: false, notify: true });
		this.relayedRefs.clear();
		this.relayedCalls.clear();
		this.relayedSubs.clear();
		for (const ref of this.remotes.values()) {
			// An upstream link may be replaced (reconnect); a downstream host that went away is gone.
			if (this.role === "upstream") ref.detached();
			else ref.gone(error);
		}
		this.remotes.clear();
		this.host.connectionClosed(this);
	}
}

/**
 * A call through a relay: waits for the route, then forwards with the root it runs in. It settles exactly once; a
 * cancel (or the origin going away) is forwarded downstream and removes both mappings.
 */
async function relayCall(
	relay: RelayRef,
	frame: Extract<Frame, { t: "call" }>,
	root: RootRef,
	signal: AbortSignal,
	host: HostImpl,
): Promise<unknown> {
	const abortError = (): ChordError => new ChordError("aborted", "call cancelled", { cause: signal.reason });
	if (signal.aborted) throw abortError();
	let onAbort = (): void => {};
	let onCancel = (): void => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
	});
	aborted.catch(() => {});
	try {
		const down = await Promise.race([relay.ready(), aborted]);
		if (relay.closed) throw new ChordError("gone", "relayed hold closed");
		return await new Promise<unknown>((resolve, reject) => {
			const call = new RelayCall(relay, frame.id, down.nextId(), { resolve, reject });
			onCancel = () => call.cancel(abortError(), true);
			signal.addEventListener("abort", onCancel, { once: true });
			host.rootSent(root.rootId, down);
			down.send({ t: "call", id: call.downId, hold: relay.downId, member: frame.member, args: frame.args, root });
		});
	} finally {
		signal.removeEventListener("abort", onAbort);
		signal.removeEventListener("abort", onCancel);
	}
}

/**
 * Validates a snapshot against the schema the consumer is promised: the provider's own schema for a direct binding,
 * the consumer's contract for one through an `accepts` adapter (the adapter's view is what the consumer gets).
 */
function validateSnapshot(ref: RefImpl, member: string, value: unknown): void {
	if (value === undefined) return;
	const installed = ref.object.currentInstalled();
	if (installed === undefined) return;
	const view = ref.currentView();
	const variant = view === undefined ? variantOf(installed.implementation) : variantOf(view);
	const description =
		view !== undefined && view !== installed.implementation
			? ref.contract.description.variants[variant ?? LOCAL_VARIANT]?.[member]
			: installed.service.contract.description.variants[variantOf(installed.implementation) ?? LOCAL_VARIANT]?.[
					member
				];
	if (description?.kind === "state") assertValid("state", `${ref.address}.${member}`, description.schema, value);
}

/** Clients (browsers) holding an outdated contract are told to reload their code. */
function clientError(error: unknown): unknown {
	if (error instanceof ChordError && error.code === "contract_mismatch") {
		return new ChordError("upgrade_required", error.message, { cause: error });
	}
	return error;
}
