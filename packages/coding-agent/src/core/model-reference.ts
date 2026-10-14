/**
 * Model reference resolution shared by CLI flags, model scopes, interactive `/model`, and auth commands.
 *
 * Each interpretation of the reference goes through the same tiers: reference matches (the named
 * provider's match and exact raw ids), then fuzzy matches across the pool.
 * A tier collects every candidate before one selection policy chooses between providers, so catalog
 * order never decides the provider. An ambiguous tier ends resolution instead of falling through to a
 * weaker tier.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { isValidThinkingLevel } from "../cli/args.ts";

export interface ModelReferenceRequest {
	/** Bare model id or `provider/id`, optionally followed by `:<thinking>`. */
	text: string;
	/** Hard provider constraint. Candidates never leave this provider. */
	provider?: string;
	/**
	 * Handling of a trailing `:<suffix>` when the full text matches no model:
	 * - `none`: the suffix stays part of the id
	 * - `strict`: a valid thinking level is parsed; any other suffix stays part of the id
	 * - `lenient`: like `strict`, but an invalid suffix is dropped with a warning
	 */
	thinkingSuffix: "none" | "strict" | "lenient";
	/** Match id and name substrings when no exact match exists. */
	fuzzy: boolean;
}

export type ModelReferenceResult =
	| { status: "resolved"; model: Model<Api>; thinkingLevel?: ThinkingLevel; warning?: string }
	| {
			status: "ambiguous";
			/** Matching models from more than one provider. */
			candidates: Model<Api>[];
			/** Number of candidates whose provider is usable. */
			usableCount: number;
			thinkingLevel?: ThinkingLevel;
			warning?: string;
	  }
	| { status: "not-found" };

type ResolvedOrAmbiguous = Exclude<ModelReferenceResult, { status: "not-found" }>;

/** Split `provider/rest` when `provider` names a provider that has models in `models`. */
export function splitProviderPrefix(
	text: string,
	models: readonly Model<Api>[],
): { provider: string; modelText: string } | undefined {
	const slashIndex = text.indexOf("/");
	if (slashIndex === -1) return undefined;
	const prefix = text.substring(0, slashIndex).trim().toLowerCase();
	const modelText = text.substring(slashIndex + 1).trim();
	if (!prefix || !modelText) return undefined;
	const provider = models.find((model) => model.provider.toLowerCase() === prefix)?.provider;
	return provider ? { provider, modelText } : undefined;
}

/**
 * Resolve a model reference to one model.
 *
 * `usable` reports whether a provider can serve requests. It only breaks ties between providers
 * and is called only when candidates span more than one provider.
 */
export function resolveModelReference(
	request: ModelReferenceRequest,
	models: readonly Model<Api>[],
	usable: (provider: string) => boolean,
): ModelReferenceResult {
	const text = request.text.trim();
	if (!text) return { status: "not-found" };
	const constraint = request.provider?.toLowerCase();
	const pool = constraint ? models.filter((model) => model.provider.toLowerCase() === constraint) : models;
	return resolveText(text, request, pool, usable);
}

/** Exact `provider/id` or bare id lookup without thinking suffixes or fuzzy matching. */
export function findExactModelReferenceMatch(
	modelReference: string,
	models: readonly Model<Api>[],
): Model<Api> | undefined {
	const result = resolveModelReference(
		{ text: modelReference, thinkingSuffix: "none", fuzzy: false },
		models,
		() => true,
	);
	return result.status === "resolved" ? result.model : undefined;
}

function resolveText(
	text: string,
	request: ModelReferenceRequest,
	pool: readonly Model<Api>[],
	usable: (provider: string) => boolean,
): ModelReferenceResult {
	const reference = selectReference(text, pool, request.fuzzy, usable);
	if (reference) return reference;

	if (request.fuzzy) {
		const fuzzy = selectFuzzy(fuzzyMatches(text, pool), usable);
		if (fuzzy) return fuzzy;
	}

	const colonIndex = text.lastIndexOf(":");
	if (colonIndex === -1 || request.thinkingSuffix === "none") return { status: "not-found" };
	const prefix = text.substring(0, colonIndex);
	const suffix = text.substring(colonIndex + 1);

	if (isValidThinkingLevel(suffix)) {
		const inner = resolveText(prefix, request, pool, usable);
		if (inner.status === "not-found") return inner;
		return { ...inner, thinkingLevel: inner.warning ? undefined : suffix };
	}
	if (request.thinkingSuffix === "strict") return { status: "not-found" };

	const inner = resolveText(prefix, request, pool, usable);
	if (inner.status === "not-found") return inner;
	return {
		...inner,
		thinkingLevel: undefined,
		warning: `Invalid thinking level "${suffix}" in pattern "${text}". Using default instead.`,
	};
}

/**
 * Reference candidates are the named provider's match and raw matches (the whole text equals a model
 * id, such as gateway id `anthropic/claude-opus-4-8`).
 *
 * For `provider/rest` where `provider` names a provider, that provider's match is its model with id
 * `rest`, else its model whose id is the whole text, else (with `fuzzy`) its best fuzzy match for
 * `rest`. The named provider is a hint, so its match competes with raw matches on other providers.
 *
 * Selection between providers: a usable named-provider match wins, then the sole usable raw match,
 * then an unusable named-provider match (so `--api-key` can set up the provider named in the
 * reference). Anything else is ambiguous.
 */
function selectReference(
	text: string,
	pool: readonly Model<Api>[],
	fuzzy: boolean,
	usable: (provider: string) => boolean,
): ResolvedOrAmbiguous | undefined {
	const lowerText = text.toLowerCase();
	const raw = pool.filter((model) => model.id.toLowerCase() === lowerText);
	const split = splitProviderPrefix(text, pool);
	let named: Model<Api> | undefined;
	if (split) {
		const providerModels = pool.filter((model) => model.provider === split.provider);
		const lowerModelText = split.modelText.toLowerCase();
		named =
			providerModels.find((model) => model.id.toLowerCase() === lowerModelText) ??
			raw.find((model) => model.provider === split.provider) ??
			(fuzzy ? bestFuzzyMatch(fuzzyMatches(split.modelText, providerModels)) : undefined);
	}

	const others = raw.filter((model) => model !== named);
	const candidates = named ? [named, ...others] : others;
	if (candidates.length === 0) return undefined;
	if (new Set(candidates.map((model) => model.provider)).size === 1)
		return { status: "resolved", model: candidates[0] };
	if (named && usable(named.provider)) return { status: "resolved", model: named };
	const usableOthers = others.filter((model) => usable(model.provider));
	if (usableOthers.length === 1) return { status: "resolved", model: usableOthers[0] };
	if (usableOthers.length === 0 && named) return { status: "resolved", model: named };
	return { status: "ambiguous", candidates, usableCount: usableOthers.length };
}

function fuzzyMatches(text: string, models: readonly Model<Api>[]): Model<Api>[] {
	const lowerText = text.toLowerCase();
	return models.filter(
		(model) => model.id.toLowerCase().includes(lowerText) || model.name?.toLowerCase().includes(lowerText),
	);
}

/**
 * Prefer usable providers, then the best fuzzy match. When the chosen id exists on more than one
 * remaining provider, the match is ambiguous.
 */
function selectFuzzy(matches: Model<Api>[], usable: (provider: string) => boolean): ResolvedOrAmbiguous | undefined {
	if (matches.length === 0) return undefined;
	const multipleProviders = new Set(matches.map((model) => model.provider)).size > 1;
	const usableMatches = multipleProviders ? matches.filter((model) => usable(model.provider)) : [];
	const pool = usableMatches.length > 0 ? usableMatches : matches;
	const best = bestFuzzyMatch(pool);
	if (!best) return undefined;
	const tied = pool.filter((model) => model.id === best.id);
	if (new Set(tied.map((model) => model.provider)).size === 1) return { status: "resolved", model: best };
	return {
		status: "ambiguous",
		candidates: tied,
		usableCount: usableMatches.length > 0 ? tied.length : 0,
	};
}

/** Prefer aliases over dated ids (`-YYYYMMDD`), then the highest id. */
function bestFuzzyMatch(matches: readonly Model<Api>[]): Model<Api> | undefined {
	const aliases = matches.filter((model) => isAlias(model.id));
	return [...(aliases.length > 0 ? aliases : matches)].sort((a, b) => b.id.localeCompare(a.id))[0];
}

function isAlias(id: string): boolean {
	return id.endsWith("-latest") || !/-\d{8}$/.test(id);
}
