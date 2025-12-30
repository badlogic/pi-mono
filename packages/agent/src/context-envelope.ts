import type { Message, Model, ReasoningEffort, Tool } from "@mariozechner/pi-ai";

export type ContextPatchScope = "cached" | "uncached";

/**
 * A named portion of the system prompt.
 *
 * Apps can choose to provide stable parts so hooks can precisely add/remove/replace sections
 * without stringly-typed regex hacks.
 */
export interface SystemPromptPart {
	name: string;
	text: string;
}

/**
 * Provider request envelope.
 *
 * This is the canonical request-shaping surface for context engineering.
 */
export interface ContextEnvelope {
	/** Provider request: compiled system prompt string. */
	system: {
		parts: SystemPromptPart[];
		compiled: string;
	};

	/**
	 * Provider request: tool definitions (name/description/schema).
	 *
	 * Note: these are tool *definitions*, not executors. Persisted transforms must be serializable.
	 * Apps rehydrate definitions to executors by name at runtime.
	 */
	tools: Tool[];

	/** Provider request: cached prefix + uncached tail (appended last). */
	messages: {
		cached: Message[];
		uncached: Message[];
	};

	/** Provider request options that may affect generation and caching semantics. */
	options: {
		reasoning?: ReasoningEffort;
		temperature?: number;
		maxTokens?: number;
	};

	/** Metadata for hooks / renderers (not sent to the provider directly). */
	meta: {
		model: Model<any>;
		/** Provider context window limit (tokens). */
		limit: number;
		turnIndex: number;
		requestIndex: number;
		signal: AbortSignal;
		/** Best-effort token estimate (provider-specific). */
		tokens?: number;
	};
}

// ---------------------------------------------------------------------------
// Patch language (schemaVersioned at the entry layer)
// ---------------------------------------------------------------------------

export type ContextPatchOp =
	| {
			op: "system_part_set";
			scope: "cached";
			partName: string;
			text: string;
			invalidateCacheReason: string;
	  }
	| {
			op: "system_part_remove";
			scope: "cached";
			partName: string;
			invalidateCacheReason: string;
	  }
	| {
			op: "system_parts_replace";
			scope: "cached";
			parts: SystemPromptPart[];
			invalidateCacheReason: string;
	  }
	| {
			op: "tools_replace";
			scope: "cached";
			tools: Tool[];
			invalidateCacheReason: string;
	  }
	| {
			op: "tools_remove";
			scope: "cached";
			toolNames: string[];
			invalidateCacheReason: string;
	  }
	| {
			op: "messages_cached_replace";
			scope: "cached";
			messages: Message[];
			invalidateCacheReason: string;
	  }
	| {
			op: "messages_uncached_append";
			scope: "uncached";
			messages: Message[];
	  }
	| {
			op: "options_set";
			scope: "cached";
			reasoning?: ReasoningEffort;
			temperature?: number;
			maxTokens?: number;
			invalidateCacheReason: string;
	  }
	| {
			op: "compaction_apply";
			scope: "cached";
			summary: string;
			/** Timestamp of the injected summary message (for deterministic replay). */
			timestamp: number;
			firstKeptMessageIndex: number;
			tokensBefore: number;
			invalidateCacheReason: string;
	  };

export interface ApplyPatchOptions {
	/**
	 * Optional formatter for compaction summaries.
	 * If provided, compaction_apply inserts the returned Message instead of a raw user text message.
	 */
	formatCompactionSummary?: (summary: string) => Message;
}

export interface ApplyPatchResult {
	envelope: ContextEnvelope;
	/** True if any cached patch op was applied. */
	cacheInvalidated: boolean;
	/** Reasons provided by cached patch ops (unique, in order). */
	invalidateCacheReasons: string[];
}

export function compileSystemPrompt(parts: SystemPromptPart[]): string {
	// Preserve exact formatting: no trimming, no extra separators.
	return parts.map((p) => p.text).join("");
}

function assertNonEmptyReason(reason: string, op: string): void {
	if (typeof reason !== "string" || reason.trim().length === 0) {
		throw new Error(`Context patch op "${op}" modifies cached content but did not provide invalidateCacheReason`);
	}
}

export function applyContextPatch(
	envelope: ContextEnvelope,
	patch: ContextPatchOp[],
	options?: ApplyPatchOptions,
): ApplyPatchResult {
	const next: ContextEnvelope = {
		...envelope,
		system: { ...envelope.system, parts: [...envelope.system.parts] },
		tools: [...envelope.tools],
		messages: { cached: [...envelope.messages.cached], uncached: [...envelope.messages.uncached] },
		options: { ...envelope.options },
		meta: { ...envelope.meta },
	};

	let cacheInvalidated = false;
	const reasons: string[] = [];
	const addReason = (r: string) => {
		const trimmed = r.trim();
		if (!trimmed) return;
		if (!reasons.includes(trimmed)) reasons.push(trimmed);
	};

	for (const op of patch) {
		switch (op.op) {
			case "system_part_set": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				const idx = next.system.parts.findIndex((p) => p.name === op.partName);
				if (idx === -1) {
					next.system.parts.push({ name: op.partName, text: op.text });
				} else {
					next.system.parts[idx] = { name: op.partName, text: op.text };
				}
				next.system.compiled = compileSystemPrompt(next.system.parts);
				break;
			}

			case "system_part_remove": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				next.system.parts = next.system.parts.filter((p) => p.name !== op.partName);
				next.system.compiled = compileSystemPrompt(next.system.parts);
				break;
			}

			case "system_parts_replace": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				next.system.parts = [...op.parts];
				next.system.compiled = compileSystemPrompt(next.system.parts);
				break;
			}

			case "tools_replace": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				next.tools = [...op.tools];
				break;
			}

			case "tools_remove": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				const names = new Set(op.toolNames);
				next.tools = next.tools.filter((t) => !names.has(t.name));
				break;
			}

			case "messages_cached_replace": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				next.messages.cached = [...op.messages];
				break;
			}

			case "messages_uncached_append": {
				next.messages.uncached = [...next.messages.uncached, ...op.messages];
				break;
			}

			case "options_set": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				next.options = {
					...next.options,
					reasoning: op.reasoning ?? next.options.reasoning,
					temperature: op.temperature ?? next.options.temperature,
					maxTokens: op.maxTokens ?? next.options.maxTokens,
				};
				break;
			}

			case "compaction_apply": {
				assertNonEmptyReason(op.invalidateCacheReason, op.op);
				cacheInvalidated = true;
				addReason(op.invalidateCacheReason);

				const formatted = options?.formatCompactionSummary?.(op.summary);
				const summaryMessage: Message = formatted
					? { ...formatted, timestamp: op.timestamp }
					: {
							role: "user",
							content: [{ type: "text", text: op.summary }],
							timestamp: op.timestamp,
						};

				const kept = next.messages.cached.slice(Math.max(0, op.firstKeptMessageIndex));
				next.messages.cached = [summaryMessage, ...kept];
				break;
			}
		}
	}

	return { envelope: next, cacheInvalidated, invalidateCacheReasons: reasons };
}
