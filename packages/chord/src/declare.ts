import type { Static, TSchema } from "typebox";
import type { Cell, Sources, SourceValues } from "./cell.ts";
import type { Ctx, Readable } from "./types.ts";

// Declaration descriptors. A factory passes them in object literals; the property name identifies the declaration
// across factory reruns (reload), independent of call order.

const DECL = Symbol("chord.decl");

export interface Subscribable<E> {
	subscribe(listener: (event: E) => void): () => void;
}

export interface CellDecl<T> {
	readonly [DECL]: "cell";
	readonly schema: TSchema;
	readonly initial: T;
}

export interface ResourceSpec<T> {
	/** Bump to replace the resource at the next reload. */
	readonly rev: number;
	/** Holds or resources that must be live/open first. A change replaces the resource. */
	readonly deps?: readonly unknown[];
	/** Exclusive resources are replaced at the gate: old closed before new opened. */
	readonly exclusive?: boolean;
	open(options: { readonly signal: AbortSignal }): T | Promise<T>;
	close?(value: T): void | Promise<void>;
}

export interface ResourceDecl<T> {
	readonly [DECL]: "resource";
	readonly spec: ResourceSpec<T>;
}

export interface Resource<T> {
	readonly key: string;
	/** Throws not_ready until opened. */
	readonly value: T;
}

export interface ListenerDecl {
	readonly [DECL]: "listener";
	readonly source: unknown;
	readonly select: ((value: never) => Subscribable<unknown>) | undefined;
	readonly fn: (event: unknown, ctx: Ctx) => void | Promise<void>;
}

export interface DerivationDecl<T> {
	readonly [DECL]: "derivation";
	readonly sources: Sources;
	readonly fn: (...values: never[]) => T;
}

/** A state cell: schema (required; there is no TypeScript at runtime) and initial value (validated). */
export const cell = <S extends TSchema>(schema: S, initial: Static<S>): CellDecl<Static<S>> => ({
	[DECL]: "cell",
	schema,
	initial,
});

export const resource = <T>(spec: ResourceSpec<T>): ResourceDecl<T> => ({ [DECL]: "resource", spec });

type ValueOf<S> = S extends Resource<infer T> ? T : S;
type EventOf<S> = S extends Resource<infer T> ? EventOf<T> : S extends Subscribable<infer E> ? E : never;

/**
 * Reacts to a source once the record is live. `listener(source, fn)` subscribes to the source itself: a readable
 * (cell, derivation, handle state member: called with each value, starting with the current one), an event source,
 * or a resource whose value is one. `listener(source, select, fn)` subscribes to `select(value)`, where value is the
 * opened resource for a resource source. Each event runs `fn` in a fresh root.
 */
export function listener<S>(source: S, fn: (event: EventOf<S>, ctx: Ctx) => void | Promise<void>): ListenerDecl;
export function listener<S, E>(
	source: S,
	select: (value: ValueOf<S>) => Subscribable<E>,
	fn: (event: E, ctx: Ctx) => void | Promise<void>,
): ListenerDecl;
export function listener(source: unknown, ...rest: readonly unknown[]): ListenerDecl {
	const [select, fn] = rest.length === 1 ? [undefined, rest[0]] : [rest[0], rest[1]];
	return {
		[DECL]: "listener",
		source,
		select: select as ListenerDecl["select"],
		fn: fn as ListenerDecl["fn"],
	};
}

export const derivation = <const S extends Sources, T>(
	sources: S,
	fn: (...values: SourceValues<S>) => T,
): DerivationDecl<T> => ({ [DECL]: "derivation", sources, fn: fn as unknown as (...values: never[]) => T });

export const declKind = (value: unknown): string | undefined =>
	value !== null && typeof value === "object" ? (value as { [DECL]?: string })[DECL] : undefined;

export type Cells<D> = { readonly [K in keyof D]: D[K] extends CellDecl<infer T> ? Cell<T> : never };
export type Resources<D> = { readonly [K in keyof D]: D[K] extends ResourceDecl<infer T> ? Resource<T> : never };
export type Derivations<D> = { readonly [K in keyof D]: D[K] extends DerivationDecl<infer T> ? Readable<T> : never };
