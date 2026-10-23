import type { AnyContract, Handle, InputOf } from "./contract.ts";
import type { Op } from "./delta/index.ts";

/** App-defined, JSON-serializable identity of a caller. Mapped to a record key by `createHost({ principalKey })`. */
export type Principal = unknown;

export interface GetOptions {
	/** Principal the record is created for. Defaults to the host principal. */
	readonly principal?: Principal;
	/** Host name. Only the local host in phase 1a. */
	readonly at?: string;
}

/**
 * The explicit call context of one root (a short Chord call tree). Calls made with it carry its root id and epoch;
 * `get` holds are released when the call that received this ctx settles.
 */
export interface Ctx {
	readonly signal: AbortSignal;
	readonly rootId: string;
	readonly epoch: number;
	readonly principal: Principal;
	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Handle<C>;
}

export type StateEvent<T> =
	| { readonly type: "snap"; readonly value: T }
	| { readonly type: "ops"; readonly ops: readonly Op[]; readonly value: T }
	| { readonly type: "reset"; readonly value: T };

/** A readable state source: a cell, a derivation, or a handle's state member. Values are immutable by contract. */
export interface Readable<T> {
	readonly value: T;
	/** Called with the current value immediately, then with every new value. */
	subscribe(listener: (value: T) => void): () => void;
	/** Delta stream: a snapshot immediately, then ops, or a reset after a migration or rebind. */
	events(listener: (event: StateEvent<T>) => void): () => void;
}

/**
 * What a behavior may expose as a state member: a cell, a derivation, or a held object's state member (whose value is
 * `undefined` only while that object is loading; a record is live only after its holds are).
 */
export type StateSource<T> = Readable<T> | Readable<T | undefined>;

declare const EXPOSED: unique symbol;

/** A local member backed by a resource (`self.expose(res.x)`): handles read the resource's value once live. */
export interface Exposed<T> {
	readonly [EXPOSED]: T;
}

export type HandleStatus = "loading" | "live" | "released" | "gone";

export interface Shape {
	readonly kind: string | undefined;
	readonly members: readonly string[];
	/** Fingerprint of the provider contract. */
	readonly contract: string;
	readonly epoch: number;
}

export interface HandleBase<C extends AnyContract> {
	/** The consumer contract token this handle was bound with. */
	readonly contract: C;
	readonly status: HandleStatus;
	readonly ready: Promise<void>;
	readonly kind: string | undefined;
	readonly shape: Shape | undefined;
	/** Why the handle is gone, if it is. */
	readonly error: unknown;
	onShape(listener: (shape: Shape) => void): () => void;
	/**
	 * Called after every status change (`loading` → `live`, `live` → `loading` while a link reconnects, `released`,
	 * `gone` with `error`). A UI watches for `gone` to `get` again.
	 */
	onStatus(listener: (status: HandleStatus, error: unknown) => void): () => void;
	release(): void;
}
