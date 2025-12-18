import {
	type AgentContext,
	type AgentLoopConfig,
	agentLoop,
	agentLoopContinue,
	type Message,
	type UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentRunConfig, AgentTransport } from "./types.js";

export interface ProviderTransportOptions {
	/**
	 * Function to retrieve API key for a given provider.
	 * If not provided, transport will try to use environment variables.
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

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

	private getModel(cfg: AgentRunConfig) {
		let model = cfg.model;
		if (this.options.corsProxyUrl && cfg.model.baseUrl) {
			model = {
				...cfg.model,
				baseUrl: `${this.options.corsProxyUrl}/?url=${encodeURIComponent(cfg.model.baseUrl)}`,
			};
		}
		return model;
	}

	private buildContext(messages: Message[], cfg: AgentRunConfig): AgentContext {
		return {
			systemPrompt: cfg.systemPrompt,
			messages,
			tools: cfg.tools,
		};
	}

	private buildLoopConfig(model: AgentRunConfig["model"], cfg: AgentRunConfig): AgentLoopConfig {
		return {
			model,
			reasoning: cfg.reasoning,
			// Resolve API key per assistant response (important for expiring OAuth tokens)
			getApiKey: this.options.getApiKey ? (provider) => this.options.getApiKey?.(provider) : undefined,
			getQueuedMessages: cfg.getQueuedMessages,
		};
	}

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		const model = this.getModel(cfg);
		const context = this.buildContext(messages, cfg);
		const pc = this.buildLoopConfig(model, cfg);

		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}

	async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
		const model = this.getModel(cfg);
		const context = this.buildContext(messages, cfg);
		const pc = this.buildLoopConfig(model, cfg);

		for await (const ev of agentLoopContinue(context, pc, signal)) {
			yield ev;
		}
	}
}
