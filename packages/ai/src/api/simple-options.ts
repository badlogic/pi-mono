import { clampThinkingLevel } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	ModelThinkingLevel,
	SamplingParams,
	SimpleStreamOptions,
	StreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
	TranscriptContext,
} from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";
import { AssistantMessageEventStream as AssistantMessageEventStreamImpl } from "../utils/event-stream.ts";

const CONTEXT_SAFETY_TOKENS = 4096;
const MIN_MAX_TOKENS = 1;

/** Estimated context usage and the response room left by the configured context window. */
export interface ContextOutputBudget {
	/** Estimated input tokens for the next request. */
	estimatedContextTokens: number;
	/**
	 * Context window minus the estimate and the safety margin. This is the real budget before the
	 * `clampMaxTokensToContext` floor, so it can be zero or negative. Infinity when the window is unknown.
	 */
	availableResponseTokens: number;
}

/**
 * Resolve the estimated context and usable response budget for one request.
 *
 * The estimate is a protective local bound, not proof of the provider's actual ceiling, so a
 * fixed safety margin is subtracted from the configured window.
 */
export function resolveContextOutputBudget(model: Model<Api>, context: TranscriptContext): ContextOutputBudget {
	const estimatedContextTokens = estimateContextTokens(context).tokens;
	if (model.contextWindow <= 0) {
		return { estimatedContextTokens, availableResponseTokens: Number.POSITIVE_INFINITY };
	}
	return {
		estimatedContextTokens,
		availableResponseTokens: model.contextWindow - estimatedContextTokens - CONTEXT_SAFETY_TOKENS,
	};
}

export function clampMaxTokensToContext(model: Model<Api>, context: TranscriptContext, maxTokens: number): number {
	if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
	const { availableResponseTokens } = resolveContextOutputBudget(model, context);
	return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, availableResponseTokens));
}

/**
 * Why a provider request cannot be made, or undefined when the context window leaves enough room.
 *
 * A request must still reserve `MIN_ANSWER_TOKENS` of answer room, or the caller's own cap when it
 * is smaller. Providers that share the response ceiling with a thinking budget clamp that budget
 * down to this answer floor, so the check is the same with or without thinking enabled.
 */
export function contextOutputBudgetFailure(
	model: Model<Api>,
	context: TranscriptContext,
	options?: { maxTokens?: number },
): string | undefined {
	const budget = resolveContextOutputBudget(model, context);
	if (!Number.isFinite(budget.availableResponseTokens)) return undefined;
	const desiredMaxTokens = options?.maxTokens ?? model.maxTokens;
	const required = Math.min(Math.max(desiredMaxTokens, 1), MIN_ANSWER_TOKENS);
	if (budget.availableResponseTokens >= required) return undefined;
	const room =
		budget.availableResponseTokens > 0
			? `only ${budget.availableResponseTokens} output tokens remain`
			: `the estimated input exceeds the ${model.contextWindow}-token window by ${-budget.availableResponseTokens} tokens`;
	return `Context length exceeded for ${model.id}: ${budget.estimatedContextTokens} estimated input tokens, ${room}; at least ${required} output tokens are required.`;
}

/**
 * A pre-failed assistant stream for an unusable context budget. The message is a normal assistant
 * error so `message_end` and the compaction recovery path still run; no provider request is made.
 */
export function contextOutputBudgetFailureStream(
	model: Model<Api>,
	context: TranscriptContext,
	options?: { maxTokens?: number },
): AssistantMessageEventStream | undefined {
	const errorMessage = contextOutputBudgetFailure(model, context, options);
	if (!errorMessage) return undefined;
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
	const stream = new AssistantMessageEventStreamImpl();
	stream.push({ type: "error", reason: "error", error: message });
	stream.end(message);
	return stream;
}

export function resolveSamplingParams(
	model: Model<Api>,
	thinkingLevel: ModelThinkingLevel,
	requestParams?: SamplingParams,
): SamplingParams | undefined {
	const effectiveThinkingLevel = clampThinkingLevel(model, thinkingLevel);
	const thinkingLevelParams = model.samplingParamsByThinkingLevel?.[effectiveThinkingLevel];
	return model.samplingParams || thinkingLevelParams || requestParams
		? { ...model.samplingParams, ...thinkingLevelParams, ...requestParams }
		: undefined;
}

export function buildBaseOptions(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
	apiKey?: string,
): StreamOptions {
	const samplingParams = resolveSamplingParams(model, options?.reasoning ?? "off", options?.samplingParams);
	return {
		temperature: options?.temperature,
		samplingParams,
		maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
		signal: options?.signal,
		telemetryContext: options?.telemetryContext,
		apiKey: apiKey || options?.apiKey,
		fetch: options?.fetch,
		transport: options?.transport,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		onProviderStreamEvent: options?.onProviderStreamEvent,
		timeoutMs: options?.timeoutMs,
		websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		env: options?.env,
	};
}

/** Tokens always left for the answer when a thinking budget shares the response ceiling. */
export const MIN_ANSWER_TOKENS = 1024;

export const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
};

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh" | "max"> | undefined {
	return effort === "xhigh" || effort === "max" ? "high" : effort;
}

export function thinkingBudgetForLevel(reasoningLevel: ThinkingLevel, customBudgets?: ThinkingBudgets): number {
	const budgets = { ...DEFAULT_THINKING_BUDGETS, ...customBudgets };
	const level = clampReasoning(reasoningLevel)!;
	return budgets[level]!;
}

/** Cap a thinking budget so at least MIN_ANSWER_TOKENS remain under a shared response ceiling. */
export function clampThinkingBudgetToAnswerRoom(thinkingBudget: number, ceiling: number): number {
	return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}

export function adjustMaxTokensForThinking(
	// Undefined means no explicit caller cap. Use the model cap and fit thinking inside it.
	baseMaxTokens: number | undefined,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);
	const maxTokens =
		baseMaxTokens === undefined ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
	}

	return { maxTokens, thinkingBudget };
}
