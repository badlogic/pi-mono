import { type AnthropicOptions, streamAnthropic } from "./providers/anthropic.js";
import { type GoogleOptions, streamGoogle } from "./providers/google.js";
import { type OpenAICompletionsOptions, streamOpenAICompletions } from "./providers/openai-completions.js";
import { type OpenAIResponsesOptions, streamOpenAIResponses } from "./providers/openai-responses.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	GenerateStream,
	KnownProvider,
	Model,
	OptionsForApi,
	ReasoningEffort,
	SimpleGenerateOptions,
} from "./types.js";

export class QueuedGenerateStream implements GenerateStream {
	private queue: AssistantMessageEvent[] = [];
	private waiting: ((value: IteratorResult<AssistantMessageEvent>) => void)[] = [];
	private done = false;
	private finalMessagePromise: Promise<AssistantMessage>;
	private resolveFinalMessage!: (message: AssistantMessage) => void;

	constructor() {
		this.finalMessagePromise = new Promise((resolve) => {
			this.resolveFinalMessage = resolve;
		});
	}

	push(event: AssistantMessageEvent): void {
		if (this.done) return;

		if (event.type === "done") {
			this.done = true;
			this.resolveFinalMessage(event.message);
		}
		if (event.type === "error") {
			this.done = true;
			this.resolveFinalMessage(event.partial);
		}

		// Deliver to waiting consumer or queue it
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(): void {
		this.done = true;
		// Notify all waiting consumers that we're done
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as any, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		while (true) {
			// If we have queued events, yield them
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				// No more events and we're done
				return;
			} else {
				// Wait for next event
				const result = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) =>
					this.waiting.push(resolve),
				);
				if (result.done) return;
				yield result.value;
			}
		}
	}

	finalMessage(): Promise<AssistantMessage> {
		return this.finalMessagePromise;
	}
}

const apiKeys: Map<string, string> = new Map();

export function setApiKey(provider: KnownProvider, key: string): void;
export function setApiKey(provider: string, key: string): void;
export function setApiKey(provider: any, key: string): void {
	apiKeys.set(provider, key);
}

export function getApiKey(provider: KnownProvider): string | undefined;
export function getApiKey(provider: string): string | undefined;
export function getApiKey(provider: any): string | undefined {
	// Check explicit keys first
	const key = apiKeys.get(provider);
	if (key) return key;

	// Fall back to environment variables
	const envMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		google: "GEMINI_API_KEY",
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		xai: "XAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
	};

	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): GenerateStream {
	const apiKey = options?.apiKey || getApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}
	const providerOptions = { ...options, apiKey };

	const api: Api = model.api;
	switch (api) {
		case "anthropic-messages":
			return streamAnthropic(model as Model<"anthropic-messages">, context, providerOptions);

		case "openai-completions":
			return streamOpenAICompletions(model as Model<"openai-completions">, context, providerOptions as any);

		case "openai-responses":
			return streamOpenAIResponses(model as Model<"openai-responses">, context, providerOptions as any);

		case "google-generative-ai":
			return streamGoogle(model as Model<"google-generative-ai">, context, providerOptions);

		default: {
			// This should never be reached if all Api cases are handled
			const _exhaustive: never = api;
			throw new Error(`Unhandled API: ${_exhaustive}`);
		}
	}
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.finalMessage();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleGenerateOptions,
): GenerateStream {
	const apiKey = options?.apiKey || getApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const providerOptions = mapOptionsForApi(model, options, apiKey);
	return stream(model, context, providerOptions);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleGenerateOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.finalMessage();
}

function mapOptionsForApi<TApi extends Api>(
	model: Model<TApi>,
	options?: SimpleGenerateOptions,
	apiKey?: string,
): OptionsForApi<TApi> {
	const base = {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
	};

	switch (model.api) {
		case "anthropic-messages": {
			if (!options?.reasoning) return base satisfies AnthropicOptions;

			const anthropicBudgets = {
				minimal: 1024,
				low: 2048,
				medium: 8192,
				high: Math.min(25000, model.maxTokens - 1000),
			};

			return {
				...base,
				thinkingEnabled: true,
				thinkingBudgetTokens: anthropicBudgets[options.reasoning],
			} satisfies AnthropicOptions;
		}

		case "openai-completions":
			return {
				...base,
				reasoningEffort: options?.reasoning,
			} satisfies OpenAICompletionsOptions;

		case "openai-responses":
			return {
				...base,
				reasoningEffort: options?.reasoning,
			} satisfies OpenAIResponsesOptions;

		case "google-generative-ai": {
			if (!options?.reasoning) return base as any;

			const googleBudget = getGoogleBudget(model as Model<"google-generative-ai">, options.reasoning);
			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: googleBudget,
				},
			} satisfies GoogleOptions;
		}

		default: {
			// Exhaustiveness check
			const _exhaustive: never = model.api;
			throw new Error(`Unhandled API in mapOptionsForApi: ${_exhaustive}`);
		}
	}
}

function getGoogleBudget(model: Model<"google-generative-ai">, effort: ReasoningEffort): number {
	// See https://ai.google.dev/gemini-api/docs/thinking#set-budget
	if (model.id.includes("2.5-pro")) {
		const budgets = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 32768,
		};
		return budgets[effort];
	}

	if (model.id.includes("2.5-flash")) {
		// Covers 2.5-flash-lite as well
		const budgets = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	// Unknown model - use dynamic
	return -1;
}
