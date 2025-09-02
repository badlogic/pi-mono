import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	GenerateFunction,
	GenerateOptionsUnified,
	GenerateStream,
	KnownProvider,
	Model,
	ReasoningEffort,
} from "./types.js";

export class QueuedGenerateStream implements GenerateStream {
	private queue: AssistantMessageEvent[] = [];
	private waiting: ((value: IteratorResult<AssistantMessageEvent>) => void)[] = [];
	private done = false;
	private error?: Error;
	private finalMessagePromise: Promise<AssistantMessage>;
	private resolveFinalMessage!: (message: AssistantMessage) => void;
	private rejectFinalMessage!: (error: Error) => void;

	constructor() {
		this.finalMessagePromise = new Promise((resolve, reject) => {
			this.resolveFinalMessage = resolve;
			this.rejectFinalMessage = reject;
		});
	}

	push(event: AssistantMessageEvent): void {
		if (this.done) return;

		// If it's the done event, resolve the final message
		if (event.type === "done") {
			this.done = true;
			this.resolveFinalMessage(event.message);
		}

		// If it's an error event, reject the final message
		if (event.type === "error") {
			this.error = new Error(event.error);
			if (!this.done) {
				this.rejectFinalMessage(this.error);
			}
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

// API implementations registry
const apiImplementations: Map<Api | string, GenerateFunction> = new Map();

/**
 * Register a custom API implementation
 */
export function registerApi(api: string, impl: GenerateFunction): void {
	apiImplementations.set(api, impl);
}

// API key storage
const apiKeys: Map<string, string> = new Map();

/**
 * Set an API key for a provider
 */
export function setApiKey(provider: KnownProvider, key: string): void;
export function setApiKey(provider: string, key: string): void;
export function setApiKey(provider: any, key: string): void {
	apiKeys.set(provider, key);
}

/**
 * Get API key for a provider
 */
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

/**
 * Main generate function
 */
export function generate(model: Model, context: Context, options?: GenerateOptionsUnified): GenerateStream {
	// Get implementation
	const impl = apiImplementations.get(model.api);
	if (!impl) {
		throw new Error(`Unsupported API: ${model.api}`);
	}

	// Get API key from options or environment
	const apiKey = options?.apiKey || getApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	// Map generic options to provider-specific
	const providerOptions = mapOptionsForApi(model.api, model, options, apiKey);

	// Return the GenerateStream from implementation
	return impl(model, context, providerOptions);
}

/**
 * Helper to generate and get complete response (no streaming)
 */
export async function generateComplete(
	model: Model,
	context: Context,
	options?: GenerateOptionsUnified,
): Promise<AssistantMessage> {
	const stream = generate(model, context, options);
	return stream.finalMessage();
}

/**
 * Map generic options to provider-specific options
 */
function mapOptionsForApi(api: Api | string, model: Model, options?: GenerateOptionsUnified, apiKey?: string): any {
	const base = {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
	};

	switch (api) {
		case "openai-responses":
		case "openai-completions":
			return {
				...base,
				reasoning_effort: options?.reasoning,
			};

		case "anthropic-messages": {
			if (!options?.reasoning) return base;

			// Map effort to token budget
			const anthropicBudgets = {
				minimal: 1024,
				low: 2048,
				medium: 8192,
				high: Math.min(25000, model.maxTokens - 1000),
			};

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: anthropicBudgets[options.reasoning],
				},
			};
		}
		case "google-generative-ai": {
			if (!options?.reasoning) return { ...base, thinking_budget: -1 };

			// Model-specific mapping for Google
			const googleBudget = getGoogleBudget(model, options.reasoning);
			return {
				...base,
				thinking_budget: googleBudget,
			};
		}
		default:
			return base;
	}
}

/**
 * Get Google thinking budget based on model and effort
 */
function getGoogleBudget(model: Model, effort: ReasoningEffort): number {
	// Model-specific logic
	if (model.id.includes("flash-lite")) {
		const budgets = {
			minimal: 512,
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	if (model.id.includes("pro")) {
		const budgets = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: Math.min(25000, 32768),
		};
		return budgets[effort];
	}

	if (model.id.includes("flash")) {
		const budgets = {
			minimal: 0, // Disable thinking
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	// Unknown model - use dynamic
	return -1;
}

// Register built-in API implementations
// Import the new function-based implementations
import { generateAnthropic } from "./providers/anthropic-generate.js";

// Register Anthropic implementation
apiImplementations.set("anthropic-messages", generateAnthropic);
