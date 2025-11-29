import {
	type AgentContext,
	type AgentEvent,
	type AgentLoopConfig,
	agentLoop,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentRunConfig, AgentTransport } from "./types.js";

/**
 * OAuth context for providers that require special endpoints/headers (e.g., ChatGPT backend for OpenAI OAuth)
 */
export interface OAuthContext {
	baseUrl: string;
	headers: Record<string, string>;
}

export interface ProviderTransportOptions {
	/**
	 * Function to retrieve API key for a given provider.
	 * If not provided, transport will try to use environment variables.
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/**
	 * Function to retrieve OAuth context for a model.
	 * Returns base URL and headers needed for OAuth flows (e.g., ChatGPT backend for OpenAI OAuth).
	 * If null is returned, standard API endpoint is used.
	 */
	getOAuthContext?: (model: Model<any>) => Promise<OAuthContext | null> | OAuthContext | null;

	/**
	 * Optional CORS proxy URL for browser environments.
	 * If provided, all requests will be routed through this proxy.
	 * Format: "https://proxy.example.com"
	 */
	corsProxyUrl?: string;
}

/**
 * Transport that calls LLM providers directly.
 * Optionally routes calls through a CORS proxy if configured.
 */
export class ProviderTransport implements AgentTransport {
	private options: ProviderTransportOptions;

	constructor(options: ProviderTransportOptions = {}) {
		this.options = options;
	}

	async *run(
		messages: Message[],
		userMessage: Message,
		cfg: AgentRunConfig,
		signal?: AbortSignal,
	): AsyncIterable<AgentEvent> {
		// Get API key
		let apiKey: string | undefined;
		if (this.options.getApiKey) {
			apiKey = await this.options.getApiKey(cfg.model.provider);
		}

		if (!apiKey) {
			throw new Error(`No API key found for provider: ${cfg.model.provider}`);
		}

		// Check for OAuth context (e.g., ChatGPT backend for OpenAI OAuth)
		let oauthContext: OAuthContext | null = null;
		if (this.options.getOAuthContext) {
			oauthContext = await this.options.getOAuthContext(cfg.model);
		}

		// Clone model and modify baseUrl if CORS proxy is enabled
		let model = cfg.model;
		if (this.options.corsProxyUrl && cfg.model.baseUrl) {
			model = {
				...cfg.model,
				baseUrl: `${this.options.corsProxyUrl}/?url=${encodeURIComponent(cfg.model.baseUrl)}`,
			};
		}

		// Messages are already LLM-compatible (filtered by Agent)
		const context: AgentContext = {
			systemPrompt: cfg.systemPrompt,
			messages,
			tools: cfg.tools,
		};

		const pc: AgentLoopConfig = {
			model,
			reasoning: cfg.reasoning,
			apiKey,
			getQueuedMessages: cfg.getQueuedMessages,
			// Pass OAuth context if available (for ChatGPT backend, etc.)
			baseUrlOverride: oauthContext?.baseUrl,
			headers: oauthContext?.headers,
		};

		// Yield events from agentLoop
		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}
}
