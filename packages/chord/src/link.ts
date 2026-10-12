import type { Frame } from "./wire.ts";

/** An ordered (FIFO), bidirectional frame channel between two hosts. */
export interface Link {
	readonly closed: boolean;
	send(frame: Frame): void;
	/** Sets the single receiver. Frames arriving earlier are queued. */
	receive(handler: (frame: Frame) => void): void;
	onClose(handler: (reason: string) => void): void;
	/** Closes both ends: the peer gets a `bye`. */
	close(reason?: string): void;
}

/** Shared plumbing: receive queue, close handlers, `bye`. Transports implement `transmit` and `shutdown`. */
abstract class BaseLink implements Link {
	#handler: ((frame: Frame) => void) | undefined;
	#queue: Frame[] = [];
	readonly #closeHandlers = new Set<(reason: string) => void>();
	#closed = false;

	get closed(): boolean {
		return this.#closed;
	}

	protected abstract transmit(frame: Frame): void;
	protected abstract shutdown(): void;

	send(frame: Frame): void {
		if (this.#closed) return;
		this.transmit(frame);
	}

	receive(handler: (frame: Frame) => void): void {
		this.#handler = handler;
		for (const frame of this.#queue.splice(0)) handler(frame);
	}

	onClose(handler: (reason: string) => void): void {
		if (this.#closed) handler("closed");
		else this.#closeHandlers.add(handler);
	}

	close(reason = "closed"): void {
		if (this.#closed) return;
		try {
			this.transmit({ t: "bye", reason });
		} catch {
			// The transport may already be gone.
		}
		this.ended(reason);
	}

	/** Delivers a parsed frame from the transport. */
	protected deliver(frame: Frame): void {
		if (this.#closed) return;
		if (frame.t === "bye") {
			this.ended(frame.reason ?? "peer closed");
			return;
		}
		if (this.#handler === undefined) this.#queue.push(frame);
		else this.#handler(frame);
	}

	/** Marks the link closed (transport ended) and notifies once. */
	protected ended(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#queue = [];
		try {
			this.shutdown();
		} finally {
			for (const handler of this.#closeHandlers) handler(reason);
			this.#closeHandlers.clear();
		}
	}
}

/** Parses a JSON frame; anything else is a protocol error. */
function parseFrame(data: string): Frame {
	const frame = JSON.parse(data) as Frame;
	if (frame === null || typeof frame !== "object" || typeof frame.t !== "string") throw new TypeError("not a frame");
	return frame;
}

// ─── memory ──────────────────────────────────────────────────────────────────

export class MemoryLink extends BaseLink {
	peer: MemoryLink | undefined;
	#severed = false;
	#pending = Promise.resolve();

	/** Simulates a dead network: frames are dropped silently in both directions and no close is signalled. */
	sever(): void {
		this.#severed = true;
		if (this.peer) this.peer.#severed = true;
	}

	protected transmit(frame: Frame): void {
		if (this.#severed) return;
		// A JSON round trip detaches the frame (and rejects what JSON would mangle silently, e.g. bigint).
		const data = JSON.stringify(frame);
		const peer = this.peer;
		// One promise chain per direction keeps delivery FIFO and asynchronous, like a real transport.
		this.#pending = this.#pending.then(() => {
			if (!this.#severed && peer !== undefined) peer.deliver(parseFrame(data));
		});
	}

	protected shutdown(): void {
		const peer = this.peer;
		this.#pending = this.#pending.then(() => peer?.ended("peer closed"));
	}
}

/** Two connected in-memory links (tests). */
export function memoryLinkPair(): [MemoryLink, MemoryLink] {
	const a = new MemoryLink();
	const b = new MemoryLink();
	a.peer = b;
	b.peer = a;
	return [a, b];
}

// ─── Node IPC ────────────────────────────────────────────────────────────────

/** `process` in a forked child, or the parent's `ChildProcess`. Structural, so Chord needs no Node types here. */
export interface IpcChannel {
	readonly connected: boolean;
	send(message: unknown): boolean;
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "disconnect", listener: () => void): unknown;
	off(event: "message", listener: (message: unknown) => void): unknown;
	off(event: "disconnect", listener: () => void): unknown;
}

/** Chord frames on an IPC channel are wrapped as `{ chord2: frame }`; other messages (control) pass by. */
export class IpcLink extends BaseLink {
	readonly #channel: IpcChannel;
	readonly #onMessage = (message: unknown): void => {
		const frame = (message as { chord2?: Frame } | null)?.chord2;
		if (frame !== undefined) this.deliver(frame);
	};
	readonly #onDisconnect = (): void => this.ended("ipc disconnected");

	constructor(channel: IpcChannel) {
		super();
		this.#channel = channel;
		channel.on("message", this.#onMessage);
		channel.on("disconnect", this.#onDisconnect);
	}

	protected transmit(frame: Frame): void {
		if (this.#channel.connected) this.#channel.send({ chord2: frame });
	}

	protected shutdown(): void {
		this.#channel.off("message", this.#onMessage);
		this.#channel.off("disconnect", this.#onDisconnect);
	}
}

export const ipcLink = (channel: IpcChannel): IpcLink => new IpcLink(channel);

// ─── WebSocket ───────────────────────────────────────────────────────────────

/** The WHATWG WebSocket surface: the browser `WebSocket`, Node's global `WebSocket`, and `ws` sockets. */
export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
	addEventListener(type: "open" | "close" | "error", listener: () => void): void;
}

const OPEN = 1;

export class WebSocketLink extends BaseLink {
	readonly #socket: WebSocketLike;
	#outbox: string[] = [];

	constructor(socket: WebSocketLike) {
		super();
		this.#socket = socket;
		socket.addEventListener("open", () => {
			for (const data of this.#outbox.splice(0)) socket.send(data);
		});
		socket.addEventListener("message", (event) => {
			try {
				this.deliver(parseFrame(typeof event.data === "string" ? event.data : String(event.data)));
			} catch {
				this.close("protocol error");
			}
		});
		socket.addEventListener("close", () => this.ended("socket closed"));
	}

	protected transmit(frame: Frame): void {
		const data = JSON.stringify(frame);
		if (this.#socket.readyState === OPEN) this.#socket.send(data);
		else this.#outbox.push(data);
	}

	protected shutdown(): void {
		this.#outbox = [];
		if (this.#socket.readyState <= OPEN) this.#socket.close(1000);
	}
}

export const webSocketLink = (socket: WebSocketLike): WebSocketLink => new WebSocketLink(socket);
