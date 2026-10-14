import { type Static, type TSchema, Type } from "typebox";
import { ChordError } from "./errors.ts";
import { canonicalJson, fits, hash64 } from "./schema.ts";
import type { Ctx, Exposed, Readable, RefBase, StateSource } from "./types.ts";

const MEMBER = Symbol("chord.member");

/** A method's arguments and result; `undefined`: it takes no arguments, or returns nothing (void). */
export interface MethodSpec<
	A extends TSchema | undefined = TSchema | undefined,
	R extends TSchema | undefined = TSchema | undefined,
> {
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

/**
 * A method. `method()`: no arguments (called as `ref.name(ctx)`, implemented as `(ctx) => …`) and no result.
 * `method(args)`: no result, the handler returns nothing (void). `method(args, result)`, or `method(undefined, result)`
 * for a method without arguments that returns something.
 */
export function method(): MethodSpec<undefined, undefined>;
export function method<A extends TSchema>(args: A): MethodSpec<A, undefined>;
export function method<A extends TSchema | undefined, R extends TSchema>(args: A, result: R): MethodSpec<A, R>;
export function method(args?: TSchema, result?: TSchema): MethodSpec {
	return { [MEMBER]: "method", args, result };
}

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

// A description travels as a reference's contract token (wire.ts), so it is declared once, as the schema that validates it.
// `TSchema` is an empty interface: any object is one, which is all a peer's schema is checked for here.
const SchemaObject = Type.Unsafe<TSchema>(Type.Object({}));

const MemberDescriptionSchema = Type.Union([
	// Absent `args`: the method takes none. Absent `result`: it returns nothing.
	Type.Object({
		kind: Type.Literal("method"),
		args: Type.Optional(SchemaObject),
		result: Type.Optional(SchemaObject),
	}),
	Type.Object({ kind: Type.Literal("state"), schema: SchemaObject }),
	Type.Object({ kind: Type.Literal("opaque"), id: Type.String() }),
]);
export type MemberDescription = Static<typeof MemberDescriptionSchema>;

/** Local contracts have one unnamed variant. */
export const LOCAL_VARIANT = "";

export const DescriptionSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	scope: Type.Union([Type.Literal("remote"), Type.Literal("local")]),
	version: Type.Integer(),
	input: SchemaObject,
	variants: Type.Record(Type.String(), Type.Record(Type.String(), MemberDescriptionSchema)),
});
export type Description = Static<typeof DescriptionSchema>;

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

/** Names a reference uses itself; members may not use them. */
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
	"variant",
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
		return {
			kind: "method",
			...(spec.args === undefined ? {} : { args: spec.args }),
			...(spec.result === undefined ? {} : { result: spec.result }),
		};
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
				// Both take arguments or neither does; a consumer that expects no result accepts any.
				if ((wanted.args === undefined) !== (offered.args === undefined)) return `${kind}.${name} arguments`;
				if (wanted.args !== undefined && offered.args !== undefined && !fits(wanted.args, offered.args))
					return `${kind}.${name} arguments`;
				if (wanted.result !== undefined && (offered.result === undefined || !fits(offered.result, wanted.result)))
					return `${kind}.${name} result`;
			} else if (offered.kind === "state" && wanted.kind === "state") {
				if (!fits(offered.schema, wanted.schema)) return `${kind}.${name} state`;
			} else if (offered.kind === "opaque" && wanted.kind === "opaque" && offered.id !== wanted.id) {
				return `${kind}.${name} opaque ${offered.id} != ${wanted.id}`;
			}
		}
	}
	return undefined;
}

/** Maps the provider's current implementation to the view a consumer of an older contract version expects. */
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

/** What a handler returns: the result's value, or nothing for a void method. */
type Returned<R> = [R] extends [TSchema] ? Static<R> | Promise<Static<R>> : void | Promise<void>;
/** What a call resolves to. */
type Resolved<R> = [R] extends [TSchema] ? Static<R> : undefined;

export type MethodImplementation<M> = M extends MethodSpec<infer A, infer R>
	? [A] extends [TSchema]
		? (args: Static<A>, ctx: Ctx) => Returned<R>
		: (ctx: Ctx) => Returned<R>
	: never;
export type Call<M> = M extends MethodSpec<infer A, infer R>
	? [A] extends [TSchema]
		? (args: Static<A>, ctx?: Ctx) => Promise<Resolved<R>>
		: (ctx?: Ctx) => Promise<Resolved<R>>
	: never;

/** Whether `contract`'s method `name` takes no arguments (it is called as `ref.name(ctx)`). */
export function takesNoArgs(contract: AnyContract, name: string): boolean {
	for (const members of Object.values(contract.description.variants)) {
		const member = members[name];
		if (member?.kind === "method") return member.args === undefined;
	}
	return false;
}

type VariantImplementation<K, V> = { readonly variant: K } & {
	readonly [S in keyof StateOf<V>]: StateSource<StaticOf<StateOf<V>[S]>>;
} & {
	readonly [M in keyof MethodsOf<V>]: MethodImplementation<MethodsOf<V>[M]>;
};
type VariantRef<V> = { readonly [S in keyof StateOf<V>]: Readable<StaticOf<StateOf<V>[S]> | undefined> } & {
	readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
};

type LocalImplementationMember<M> = M extends MethodSpec
	? MethodImplementation<M>
	: M extends OpaqueSpec<infer T>
		? T | Exposed<T>
		: M extends TSchema
			? StateSource<Static<M>>
			: never;
type LocalRefMember<M> = M extends MethodSpec
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
export type ImplementationOf<C> = C extends RemoteContract<infer D>
	? { [K in keyof D["variants"]]: VariantImplementation<K, D["variants"][K]> }[keyof D["variants"]]
	: C extends LocalContract<infer D>
		? { readonly [K in keyof LocalMembers<D>]: LocalImplementationMember<LocalMembers<D>[K]> } & Record<
				string,
				unknown
			>
		: never;

/** Late-bound members a reference exposes for contract C (all variants merged). */
export type MembersOf<C> = C extends RemoteContract<infer D>
	? UnionToIntersection<{ [K in keyof D["variants"]]: VariantRef<D["variants"][K]> }[keyof D["variants"]]>
	: C extends LocalContract<infer D>
		? { readonly [K in keyof LocalMembers<D>]: LocalRefMember<LocalMembers<D>[K]> }
		: never;

export type Ref<C extends AnyContract = AnyContract> = RefBase<C> & MembersOf<C>;
