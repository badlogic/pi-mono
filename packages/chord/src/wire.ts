import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Description } from "./contract.ts";
import type { WireOp } from "./delta/index.ts";
import { ChordError, type ChordErrorCode } from "./errors.ts";
import type { Principal } from "./types.ts";

// JSON frames between two hosts (or a host and a client). Ids are chosen by the side that creates the hold, call or
// subscription; every frame type has one direction, so ids never collide:
//   consumer → provider: hold, release, call, cancel, sub, unsub
//   provider → consumer: shape, gone, result, state
//   both: hello, ping, pong, bye, root_end; parent → child: invalidate, prepare, commit, abort, retire; child → parent: vote

export interface RootRef {
	readonly rootId: string;
	readonly epoch: number;
}

export interface WireError {
	readonly code: ChordErrorCode;
	readonly message: string;
	readonly reason?: string;
}

export interface WireReloadOptions {
	readonly remove?: readonly string[];
	readonly gateDeadline?: number;
	readonly retireDeadline?: number;
}

/** A child's prepared reload, sent with its vote (same fields as `ReloadReport`, without children). */
export interface WireReloadReport {
	readonly epoch: number;
	readonly previous: number;
	readonly changed: readonly string[];
	readonly removed: readonly string[];
	readonly prepared: readonly string[];
	readonly gated: readonly string[];
}

export type Frame =
	| { readonly t: "hello"; readonly name: string; readonly kind: "host" | "client"; readonly epoch: number }
	| {
			readonly t: "hold";
			readonly id: number;
			/** Target host name. */
			readonly at: string;
			/** The consumer's contract token; the provider checks that it covers it. */
			readonly token: Description;
			readonly input: unknown;
			/** A forwarded principal. Honored only on frames from the parent link. */
			readonly principal?: Principal;
			/** Set by a relay when the hold originates from a client (browser): not a reload participant. */
			readonly client?: boolean;
	  }
	| { readonly t: "release"; readonly id: number }
	| {
			readonly t: "shape";
			readonly id: number;
			readonly kind?: string;
			readonly members: readonly string[];
			readonly contract: string;
			readonly epoch: number;
	  }
	| { readonly t: "gone"; readonly id: number; readonly error: WireError }
	| {
			readonly t: "call";
			readonly id: number;
			readonly hold: number;
			readonly member: string;
			readonly args: unknown;
			/** Absent: the receiving host starts a root (browsers never carry roots). */
			readonly root?: RootRef;
	  }
	| { readonly t: "result"; readonly id: number; readonly value?: unknown; readonly error?: WireError }
	| { readonly t: "cancel"; readonly id: number }
	| { readonly t: "sub"; readonly id: number; readonly hold: number; readonly member: string }
	| { readonly t: "unsub"; readonly id: number }
	| {
			readonly t: "state";
			readonly id: number;
			readonly snap?: unknown;
			readonly reset?: unknown;
			/** Encoded with the subscription's delta encoder. */
			readonly ops?: readonly WireOp[];
			readonly error?: WireError;
	  }
	| { readonly t: "ping"; readonly n: number }
	| { readonly t: "pong"; readonly n: number }
	| { readonly t: "bye"; readonly reason?: string }
	/** The root ended at its origin: its leases on records end (sent on every link the root's calls used). */
	| { readonly t: "root_end"; readonly rootId: string }
	| { readonly t: "invalidate"; readonly pattern: Readonly<Record<string, unknown>> }
	| {
			readonly t: "prepare";
			readonly reload: number;
			readonly epoch: number;
			readonly plugins: readonly string[];
			readonly options: WireReloadOptions;
	  }
	| { readonly t: "vote"; readonly reload: number; readonly error?: WireError; readonly report?: WireReloadReport }
	| { readonly t: "commit"; readonly reload: number }
	/** The parent dropped `epoch`: roots of it may still come from there no longer. */
	| { readonly t: "retire"; readonly epoch: number }
	| { readonly t: "abort"; readonly reload: number };

export function toWireError(error: unknown): WireError {
	if (error instanceof ChordError) {
		return error.reason === undefined
			? { code: error.code, message: error.message }
			: { code: error.code, message: error.message, reason: error.reason };
	}
	return { code: "unavailable", message: error instanceof Error ? error.message : String(error) };
}

export const fromWireError = (error: WireError): ChordError =>
	new ChordError(error.code, error.message.replace(/^[a-z_]+(\/[a-z_]+)?: /, ""), { reason: error.reason });

// ─── validation ──────────────────────────────────────────────────────────────

const Id = Type.Integer({ minimum: 1 });
const Name = Type.String({ minLength: 1 });
const Root = Type.Object({ rootId: Name, epoch: Type.Integer({ minimum: 1 }) });
const ErrorShape = Type.Object({ code: Type.String(), message: Type.String(), reason: Type.Optional(Type.String()) });
const Reload = Type.Integer({ minimum: 1 });

/** Structural schema of every frame. Payloads (args, values, ops) are checked where they are used. */
const FrameSchema = Type.Union([
	Type.Object({
		t: Type.Literal("hello"),
		name: Name,
		kind: Type.Union([Type.Literal("host"), Type.Literal("client")]),
		epoch: Type.Integer({ minimum: 0 }),
	}),
	Type.Object({
		t: Type.Literal("hold"),
		id: Id,
		at: Name,
		token: Type.Object({
			name: Name,
			scope: Type.String(),
			version: Type.Integer(),
			input: Type.Unknown(),
			variants: Type.Record(Type.String(), Type.Unknown()),
		}),
		input: Type.Unknown(),
		principal: Type.Optional(Type.Unknown()),
		client: Type.Optional(Type.Boolean()),
	}),
	Type.Object({ t: Type.Literal("release"), id: Id }),
	Type.Object({
		t: Type.Literal("shape"),
		id: Id,
		kind: Type.Optional(Type.String()),
		members: Type.Array(Type.String()),
		contract: Type.String(),
		epoch: Type.Integer(),
	}),
	Type.Object({ t: Type.Literal("gone"), id: Id, error: ErrorShape }),
	Type.Object({
		t: Type.Literal("call"),
		id: Id,
		hold: Id,
		member: Name,
		args: Type.Unknown(),
		root: Type.Optional(Root),
	}),
	Type.Object({
		t: Type.Literal("result"),
		id: Id,
		value: Type.Optional(Type.Unknown()),
		error: Type.Optional(ErrorShape),
	}),
	Type.Object({ t: Type.Literal("cancel"), id: Id }),
	Type.Object({ t: Type.Literal("sub"), id: Id, hold: Id, member: Name }),
	Type.Object({ t: Type.Literal("unsub"), id: Id }),
	Type.Object({
		t: Type.Literal("state"),
		id: Id,
		snap: Type.Optional(Type.Unknown()),
		reset: Type.Optional(Type.Unknown()),
		ops: Type.Optional(Type.Array(Type.Array(Type.Unknown()))),
		error: Type.Optional(ErrorShape),
	}),
	Type.Object({ t: Type.Literal("ping"), n: Type.Integer() }),
	Type.Object({ t: Type.Literal("pong"), n: Type.Integer() }),
	Type.Object({ t: Type.Literal("bye"), reason: Type.Optional(Type.String()) }),
	Type.Object({ t: Type.Literal("root_end"), rootId: Name }),
	Type.Object({ t: Type.Literal("invalidate"), pattern: Type.Record(Type.String(), Type.Unknown()) }),
	Type.Object({
		t: Type.Literal("prepare"),
		reload: Reload,
		epoch: Type.Integer({ minimum: 1 }),
		plugins: Type.Array(Type.String()),
		options: Type.Object({
			remove: Type.Optional(Type.Array(Type.String())),
			gateDeadline: Type.Optional(Type.Number()),
			retireDeadline: Type.Optional(Type.Number()),
		}),
	}),
	Type.Object({
		t: Type.Literal("vote"),
		reload: Reload,
		error: Type.Optional(ErrorShape),
		report: Type.Optional(
			Type.Object({
				epoch: Type.Integer(),
				previous: Type.Integer(),
				changed: Type.Array(Type.String()),
				removed: Type.Array(Type.String()),
				prepared: Type.Array(Type.String()),
				gated: Type.Array(Type.String()),
			}),
		),
	}),
	Type.Object({ t: Type.Literal("commit"), reload: Reload }),
	Type.Object({ t: Type.Literal("retire"), epoch: Type.Integer({ minimum: 1 }) }),
	Type.Object({ t: Type.Literal("abort"), reload: Reload }),
]);

/** A frame that passes structural validation; anything else is a protocol violation. */
export const isFrame = (value: unknown): value is Frame => Value.Check(FrameSchema, value);
