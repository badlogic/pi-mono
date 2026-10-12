import type { Static, TSchema } from "typebox";
import { ChordError } from "./errors.ts";
import { canonicalJson, fits, hash64 } from "./schema.ts";
import type { Ctx, Exposed, HandleBase, Readable, StateSource } from "./types.ts";

const MEMBER = Symbol("chord.member");

export interface MethodSpec<A extends TSchema = TSchema, R extends TSchema = TSchema> {
	readonly [MEMBER]: "method";
	readonly args: A;
	readonly result: R;
}

export interface OpaqueSpec<T = unknown> {
	readonly [MEMBER]: "opaque";
	readonly id: string;
	/** Type carrier only; never set. */
	readonly type?: T;
}

export const method = <A extends TSchema, R extends TSchema>(args: A, result: R): MethodSpec<A, R> => ({
	[MEMBER]: "method",
	args,
	result,
});

/** A native in-process object identified by `name@version` (local contracts only). */
export const opaque = <T = unknown>(id: string): OpaqueSpec<T> => {
	if (!/^[^@\s]+@\d+$/.test(id)) throw new TypeError(`opaque id must be name@version: ${id}`);
	return { [MEMBER]: "opaque", id };
};

export interface VariantDef {
	readonly state?: Readonly<Record<string, TSchema>>;
	readonly methods?: Readonly<Record<string, MethodSpec>>;
}

export interface RemoteDef {
	readonly version: number;
	readonly input: TSchema;
	readonly variants: Readonly<Record<string, VariantDef>>;
}

/** A local member: a method, an opaque native object, or a state member described by its schema. */
export type LocalMember = MethodSpec | OpaqueSpec | TSchema;

export interface LocalDef {
	readonly version: number;
	readonly input: TSchema;
	readonly members?: Readonly<Record<string, LocalMember>>;
}

export type MemberDescription =
	| { readonly kind: "method"; readonly args: TSchema; readonly result: TSchema }
	| { readonly kind: "state"; readonly schema: TSchema }
	| { readonly kind: "opaque"; readonly id: string };

/** Local contracts have one unnamed variant. */
export const LOCAL_VARIANT = "";

export interface Description {
	readonly name: string;
	readonly scope: "remote" | "local";
	readonly version: number;
	readonly input: TSchema;
	readonly variants: Readonly<Record<string, Readonly<Record<string, MemberDescription>>>>;
}

interface ContractBase {
	readonly name: string;
	readonly version: number;
	readonly input: TSchema;
	readonly description: Description;
	readonly fingerprint: string;
}

export interface RemoteContract<D extends RemoteDef = RemoteDef> extends ContractBase {
	readonly scope: "remote";
	readonly def: D;
}

export interface LocalContract<D extends LocalDef = LocalDef> extends ContractBase {
	readonly scope: "local";
	readonly def: D;
}

export type AnyContract = RemoteContract | LocalContract;

/** Names a handle uses itself; members may not use them. */
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
	"kind",
	"status",
	"ready",
	"shape",
	"error",
	"onShape",
	"onStatus",
	"release",
	"then",
	"contract",
]);

function describeMember(name: string, member: unknown, scope: "remote" | "local"): MemberDescription {
	if (RESERVED_MEMBERS.has(name)) throw new TypeError(`member name is reserved: ${name}`);
	const brand = (member as { [MEMBER]?: string })[MEMBER];
	if (brand === "method") {
		const spec = member as MethodSpec;
		return { kind: "method", args: spec.args, result: spec.result };
	}
	if (brand === "opaque") {
		if (scope === "remote") throw new TypeError(`remote contracts cannot expose opaque members: ${name}`);
		return { kind: "opaque", id: (member as OpaqueSpec).id };
	}
	return { kind: "state", schema: member as TSchema };
}

function finish<C extends AnyContract>(contract: Omit<C, "fingerprint">): C {
	return { ...contract, fingerprint: hash64(canonicalJson(contract.description)) } as C;
}

function checkHeader(name: string, version: number): void {
	if (!name) throw new TypeError("contract name is empty");
	if (!Number.isInteger(version) || version < 1) throw new TypeError(`contract version must be a positive integer`);
}

export function remote<const D extends RemoteDef>(name: string, def: D): RemoteContract<D> {
	checkHeader(name, def.version);
	const variants: Record<string, Record<string, MemberDescription>> = {};
	if (Object.keys(def.variants).length === 0) throw new TypeError(`remote contract ${name} has no variants`);
	for (const [kind, variant] of Object.entries(def.variants)) {
		const members: Record<string, MemberDescription> = {};
		for (const [key, schema] of Object.entries(variant.state ?? {}))
			members[key] = describeMember(key, schema, "remote");
		for (const [key, spec] of Object.entries(variant.methods ?? {})) {
			if (key in members) throw new TypeError(`member ${key} is both state and method in ${name}.${kind}`);
			members[key] = describeMember(key, spec, "remote");
			if (members[key].kind !== "method") throw new TypeError(`methods.${key} is not a method()`);
		}
		variants[kind] = members;
	}
	const description: Description = { name, scope: "remote", version: def.version, input: def.input, variants };
	return finish<RemoteContract<D>>({
		scope: "remote",
		name,
		version: def.version,
		input: def.input,
		def,
		description,
	});
}

export function local<const D extends LocalDef>(name: string, def: D): LocalContract<D> {
	checkHeader(name, def.version);
	const members: Record<string, MemberDescription> = {};
	for (const [key, member] of Object.entries(def.members ?? {})) members[key] = describeMember(key, member, "local");
	const description: Description = {
		name,
		scope: "local",
		version: def.version,
		input: def.input,
		variants: { [LOCAL_VARIANT]: members },
	};
	return finish<LocalContract<D>>({ scope: "local", name, version: def.version, input: def.input, def, description });
}

/**
 * A consumer token received over a link (only its description travels). Has no `def`, so it is only good for binding
 * and validation, never for TypeScript types.
 */
export function contractFromDescription(description: Description): AnyContract {
	const { name, scope, version, input } = description;
	if (typeof name !== "string" || (scope !== "remote" && scope !== "local") || !Number.isInteger(version)) {
		throw new ChordError("invalid", "malformed contract token", { reason: "token" });
	}
	const base = { name, version, input, description, fingerprint: hash64(canonicalJson(description)) };
	return scope === "remote"
		? { ...base, scope, def: { version, input, variants: {} } }
		: { ...base, scope, def: { version, input } };
}

/** Returns why `provider` does not cover `consumer`, or undefined when it does. */
export function coverage(provider: Description, consumer: Description): string | undefined {
	if (provider.name !== consumer.name || provider.scope !== consumer.scope) return "different type";
	if (!fits(consumer.input, provider.input)) return "input";
	for (const [kind, consumerMembers] of Object.entries(consumer.variants)) {
		const providerMembers = provider.variants[kind];
		if (providerMembers === undefined) return `variant ${kind} missing`;
		for (const [name, wanted] of Object.entries(consumerMembers)) {
			const offered = providerMembers[name];
			if (offered === undefined || offered.kind !== wanted.kind) return `${kind}.${name} missing or of another kind`;
			if (offered.kind === "method" && wanted.kind === "method") {
				if (!fits(wanted.args, offered.args)) return `${kind}.${name} arguments`;
				if (!fits(offered.result, wanted.result)) return `${kind}.${name} result`;
			} else if (offered.kind === "state" && wanted.kind === "state") {
				if (!fits(offered.schema, wanted.schema)) return `${kind}.${name} state`;
			} else if (offered.kind === "opaque" && wanted.kind === "opaque" && offered.id !== wanted.id) {
				return `${kind}.${name} opaque ${offered.id} != ${wanted.id}`;
			}
		}
	}
	return undefined;
}

/** Maps the provider's current behavior to the view a consumer of an older contract version expects. */
export type Adapter = (current: Record<string, unknown>) => Record<string, unknown>;
export type Accepts = Readonly<Record<number, Adapter>>;

/** How a consumer token binds to a provider: directly or through an `accepts` adapter. Throws contract_mismatch. */
export function bind(provider: AnyContract, accepts: Accepts | undefined, consumer: AnyContract): Adapter | undefined {
	if (provider.fingerprint === consumer.fingerprint) return undefined;
	if (provider.version === consumer.version) {
		const reason = coverage(provider.description, consumer.description);
		if (reason === undefined) return undefined;
		throw new ChordError(
			"contract_mismatch",
			`${provider.name}@${provider.version} does not cover the consumer's description (${reason}); forgotten version bump?`,
		);
	}
	const adapter = accepts?.[consumer.version];
	if (adapter === undefined) {
		throw new ChordError(
			"contract_mismatch",
			`${provider.name}: provider version ${provider.version}, consumer version ${consumer.version}, no accepts adapter`,
		);
	}
	return adapter;
}

// ─── Static types ────────────────────────────────────────────────────────────

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
	? I
	: never;
type Empty = Record<never, never>;
type StateOf<V> = V extends { readonly state: infer S extends Readonly<Record<string, TSchema>> } ? S : Empty;
type StaticOf<S> = S extends TSchema ? Static<S> : never;
type MethodsOf<V> = V extends { readonly methods: infer M extends Readonly<Record<string, MethodSpec>> } ? M : Empty;

export type Implementation<M> = M extends MethodSpec<infer A, infer R>
	? (args: Static<A>, ctx: Ctx) => Static<R> | Promise<Static<R>>
	: never;
export type Call<M> = M extends MethodSpec<infer A, infer R>
	? (args: Static<A>, ctx?: Ctx) => Promise<Static<R>>
	: never;

type VariantBehavior<K, V> = { readonly kind: K } & {
	readonly [S in keyof StateOf<V>]: StateSource<StaticOf<StateOf<V>[S]>>;
} & {
	readonly [M in keyof MethodsOf<V>]: Implementation<MethodsOf<V>[M]>;
};
type VariantHandle<V> = { readonly [S in keyof StateOf<V>]: Readable<StaticOf<StateOf<V>[S]> | undefined> } & {
	readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
};

type LocalBehaviorMember<M> = M extends MethodSpec
	? Implementation<M>
	: M extends OpaqueSpec<infer T>
		? T | Exposed<T>
		: M extends TSchema
			? StateSource<Static<M>>
			: never;
type LocalHandleMember<M> = M extends MethodSpec
	? Call<M>
	: M extends OpaqueSpec<infer T>
		? T | undefined
		: M extends TSchema
			? Readable<Static<M> | undefined>
			: never;
type LocalMembers<D> = D extends { readonly members: infer M extends Readonly<Record<string, LocalMember>> }
	? M
	: Empty;

export type InputOf<C> = C extends { readonly def: { readonly input: infer I extends TSchema } } ? Static<I> : never;

/** What a factory returns for contract C. */
export type BehaviorOf<C> = C extends RemoteContract<infer D>
	? { [K in keyof D["variants"]]: VariantBehavior<K, D["variants"][K]> }[keyof D["variants"]]
	: C extends LocalContract<infer D>
		? { readonly [K in keyof LocalMembers<D>]: LocalBehaviorMember<LocalMembers<D>[K]> } & Record<string, unknown>
		: never;

/** Late-bound members a handle exposes for contract C (all variants merged). */
export type MembersOf<C> = C extends RemoteContract<infer D>
	? UnionToIntersection<{ [K in keyof D["variants"]]: VariantHandle<D["variants"][K]> }[keyof D["variants"]]>
	: C extends LocalContract<infer D>
		? { readonly [K in keyof LocalMembers<D>]: LocalHandleMember<LocalMembers<D>[K]> }
		: never;

export type Handle<C extends AnyContract = AnyContract> = HandleBase<C> & MembersOf<C>;
