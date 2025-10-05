import { type AgentContext, agentLoop, type Message, type PromptConfig, type UserMessage } from "@mariozechner/pi-ai";
import { getAppStorage } from "../../storage/app-storage.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

/**
 * Transport that calls LLM providers directly.
 * Optionally routes calls through a CORS proxy if enabled in settings.
 */
export class ProviderTransport implements AgentTransport {
	constructor(private readonly getMessages: () => Promise<Message[]>) {}

	async *run(userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		// Get API key from storage
		const apiKey = await getAppStorage().providerKeys.getKey(cfg.model.provider);
		if (!apiKey) {
			throw new Error("no-api-key");
		}

		// Check if CORS proxy is enabled
		const proxyEnabled = await getAppStorage().settings.get<boolean>("proxy.enabled");
		const proxyUrl = await getAppStorage().settings.get<string>("proxy.url");

		// Clone model and modify baseUrl if proxy is enabled
		let model = cfg.model;
		if (proxyEnabled && proxyUrl && cfg.model.baseUrl) {
			model = {
				...cfg.model,
				baseUrl: `${proxyUrl}/?url=${encodeURIComponent(cfg.model.baseUrl)}`,
			};
		}

		const context: AgentContext = {
			systemPrompt: cfg.systemPrompt,
			messages: await this.getMessages(),
			tools: cfg.tools,
		};

		const pc: PromptConfig = {
			model,
			reasoning: cfg.reasoning,
			apiKey,
		};

		// Yield events from agentLoop
		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}
}
