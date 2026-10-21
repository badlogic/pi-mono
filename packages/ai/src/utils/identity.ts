import type { Models } from "../models.ts";
import { PI_AI_VERSION } from "./version.ts";

/**
 * The `User-Agent` sent to providers:
 * - `"detailed"`: `pi/<version> (<platform>; <runtime>/<runtime version>; <arch>)`, or `pi/<version> (browser)`
 *   outside Node.js and Bun.
 * - `"short"`: `pi`.
 * - `{ custom }`: the given value.
 */
export type UserAgentMode = "short" | "detailed" | { custom: string };

/** Attribution with explicit values. Absent fields fall back to pi's own attribution only when `name` is absent. */
export interface ClientAttributionOptions {
	/**
	 * Name requests are attributed to (OpenRouter app title, NVIDIA invoke origin, OpenCode client, Codex originator).
	 * Absent: pi, spelled as each provider expects.
	 */
	name?: string;
	/** App URL, sent as OpenRouter's `HTTP-Referer`. Absent: `https://pi.dev` when `name` is absent too. */
	url?: string;
	/** OpenRouter app categories, comma-separated, e.g. `cli-agent`. */
	categories?: string;
}

/**
 * Provider attribution headers. `false` sends none; `true` attributes requests to pi; a string attributes them to that
 * name; an object gives the values explicitly.
 */
export type ClientAttribution = boolean | string | ClientAttributionOptions;

/**
 * How pi-ai identifies the calling app to providers. Every field is optional; absent fields use pi-ai's defaults:
 * a detailed `User-Agent` with pi-ai's version and no attribution headers. Plain JSON, so it can be persisted.
 */
export interface ClientIdentity {
	/** Default: `"detailed"`. */
	userAgent?: UserAgentMode;
	/** Default: `false`. */
	attribution?: ClientAttribution;
	/** Version in the detailed `User-Agent`. Default: the pi-ai version. */
	version?: string;
}

/** The provider and endpoint a request goes to. */
export interface ClientIdentityTarget {
	readonly provider: string;
	readonly baseUrl: string;
}

const PI_ATTRIBUTION_URL = "https://pi.dev";
const NVIDIA_NIM_HOST = "integrate.api.nvidia.com";
const OPENCODE_HOST = "opencode.ai";

/** Merge identities field by field; later sources win and undefined fields are skipped. */
export function mergeClientIdentity(...sources: (ClientIdentity | undefined)[]): ClientIdentity | undefined {
	let merged: ClientIdentity | undefined;
	for (const source of sources) {
		if (!source) continue;
		merged = { ...merged };
		if (source.userAgent !== undefined) merged.userAgent = source.userAgent;
		if (source.attribution !== undefined) merged.attribution = source.attribution;
		if (source.version !== undefined) merged.version = source.version;
	}
	return merged;
}

/** The version in the detailed `User-Agent`. */
export function getClientVersion(identity?: ClientIdentity): string {
	return identity?.version ?? PI_AI_VERSION;
}

function runtimeDescription(): string | undefined {
	if (typeof process === "undefined") return undefined;
	const versions = process.versions;
	if (versions?.bun) return `bun/${versions.bun}`;
	if (versions?.node) return `node/${process.version}`;
	return undefined;
}

/** The `User-Agent` value of an identity. */
export function formatUserAgent(identity?: ClientIdentity): string {
	const mode = identity?.userAgent ?? "detailed";
	if (typeof mode === "object") return mode.custom;
	if (mode === "short") return "pi";
	const product = `pi/${getClientVersion(identity)}`;
	const runtime = runtimeDescription();
	return runtime ? `${product} (${process.platform}; ${runtime}; ${process.arch})` : `${product} (browser)`;
}

function resolveAttribution(identity: ClientIdentity | undefined): ClientAttributionOptions | undefined {
	const attribution = identity?.attribution;
	if (attribution === undefined || attribution === false) return undefined;
	if (attribution === true) return {};
	if (typeof attribution === "string") return { name: attribution };
	return attribution;
}

/** The explicitly configured attribution name, if any. Absent when attribution is off or uses pi's defaults. */
export function getAttributionName(identity?: ClientIdentity): string | undefined {
	return resolveAttribution(identity)?.name;
}

function matchesHost(baseUrl: string, expectedHost: string): boolean {
	try {
		return new URL(baseUrl).hostname === expectedHost;
	} catch {
		return false;
	}
}

function isOpenRouter(target: ClientIdentityTarget): boolean {
	return target.provider === "openrouter" || target.baseUrl.includes("openrouter.ai");
}

function isNvidiaNim(target: ClientIdentityTarget): boolean {
	return target.provider === "nvidia" || matchesHost(target.baseUrl, NVIDIA_NIM_HOST);
}

function isOpenCode(target: ClientIdentityTarget): boolean {
	return (
		target.provider === "opencode" || target.provider === "opencode-go" || matchesHost(target.baseUrl, OPENCODE_HOST)
	);
}

/** Provider attribution headers of an identity for a request target. Empty when attribution is off. */
export function getAttributionHeaders(target: ClientIdentityTarget, identity?: ClientIdentity): Record<string, string> {
	const attribution = resolveAttribution(identity);
	if (!attribution) return {};
	const { name, categories } = attribution;
	if (isOpenRouter(target)) {
		const url = attribution.url ?? (name === undefined ? PI_ATTRIBUTION_URL : undefined);
		return {
			...(url === undefined ? {} : { "HTTP-Referer": url }),
			"X-OpenRouter-Title": name ?? "pi",
			...(categories === undefined ? {} : { "X-OpenRouter-Categories": categories }),
		};
	}
	if (isNvidiaNim(target)) return { "X-BILLING-INVOKE-ORIGIN": name ?? "Pi" };
	if (isOpenCode(target)) return { "x-opencode-client": name ?? "pi" };
	return {};
}

/**
 * Default headers an identity adds to a request: `User-Agent` and provider attribution. APIs apply them below model,
 * provider, and request headers, so configured headers override them and `null` request headers remove them.
 */
export function getIdentityHeaders(target: ClientIdentityTarget, identity?: ClientIdentity): Record<string, string> {
	return { "User-Agent": formatUserAgent(identity), ...getAttributionHeaders(target, identity) };
}

const IDENTITY_REQUEST_METHODS = new Set<PropertyKey>([
	"stream",
	"complete",
	"streamSimple",
	"completeSimple",
	"streamDeferred",
	"fetchDeferred",
	"cancelDeferred",
	"generateImages",
	"classify",
]);

/**
 * A view of `models` whose requests use `identity` as their default identity: a request's `identity` overrides it field
 * by field, and it overrides the identity `models` was created with. Everything else is delegated unchanged.
 */
export function withClientIdentity<T extends Models>(models: T, identity: ClientIdentity): T {
	return new Proxy(models, {
		get(target, property) {
			const value: unknown = Reflect.get(target, property, target);
			if (typeof value !== "function") return value;
			if (!IDENTITY_REQUEST_METHODS.has(property)) return value.bind(target);
			// Every request method takes (model, context or handle, options).
			return (model: unknown, input: unknown, options?: { identity?: ClientIdentity }) =>
				value.call(target, model, input, {
					...options,
					identity: mergeClientIdentity(identity, options?.identity),
				});
		},
	});
}
