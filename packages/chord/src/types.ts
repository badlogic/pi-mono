import type { AnyContract, InputOf, Ref } from "./contract.ts";
import type { Op } from "./delta/index.ts";

/** App-defined, JSON-serializable identity of a caller. Mapped to an object key by `createHost({ principalKey })`. */
export type Principal = unknown;

export interface GetOptions {
	/** Principal the object is created for. Defaults to the host principal. */
	readonly principal?: Principal;
	/** Host name. Only the local host in phase 1a. */
	readonly at?: string;
}

/**
 * The explicit call context of one root (a short Chord call tree). Calls made with it carry its root id and code
 * version; `get` references are released when the call that received this ctx settles.
 */
export interface Ctx {
	readonly signal: AbortSignal;
	readonly rootId: string;
	readonly codeVersion: number;
	readonly principal: Principal;
	get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Ref<C>;
}

export type StateEvent<T> =
	| { readonly type: "snap"; readonly value: T }
	| { readonly type: "ops"; readonly ops: readonly Op[]; readonly value: T }
	| { readonly type: "reset"; readonly value: T };

/** A readable state source: a cell, a derivation, or a reference's state member. Values are immutable by contract. */
export interface Readable<T> {
	readonly value: T;
	/** Called with the current value immediately, then with every new value. */
	subscribe(listener: (value: T) => void): () => void;
	/** Delta stream: a snapshot immediately, then ops, or a reset after a migration or rebind. */
	events(listener: (event: StateEvent<T>) => void): () => void;
}

/**
 * What an implementation may expose as a state member: a cell, a derivation, or a held object's state member (whose
 * value is `undefined` only while that object is loading; an object is live only after its references are).
 */
export type StateSource<T> = Readable<T> | Readable<T | undefined>;

declare const EXPOSED: unique symbol;

/** A local member backed by a resource (`self.expose(res.x)`): references read the resource's value once live. */
export interface Exposed<T> {
	readonly [EXPOSED]: T;
}

export type RefStatus = "loading" | "live" | "released" | "gone";

export interface Shape {
	readonly variant: string | undefined;
	readonly members: readonly string[];
	/** Fingerprint of the provider contract. */
	readonly contract: string;
	readonly codeVersion: number;
}

export interface RefBase<C extends AnyContract> {
	/** The consumer contract token this reference was bound with. */
	readonly contract: C;
	readonly status: RefStatus;
	readonly ready: Promise<void>;
	readonly variant: string | undefined;
	readonly shape: Shape | undefined;
	/** Why the reference is gone, if it is. */
	readonly error: unknown;
	onShape(listener: (shape: Shape) => void): () => void;
	/**
	 * Called after every status change (`loading` → `live`, `live` → `loading` while a link reconnects, `released`,
	 * `gone` with `error`). A UI watches for `gone` to `get` again.
	 */
	onStatus(listener: (status: RefStatus, error: unknown) => void): () => void;
	release(): void;
}
