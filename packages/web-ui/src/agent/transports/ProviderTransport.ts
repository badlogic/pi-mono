import {
	type AgentContext,
	type AgentLoopConfig,
	agentLoop,
	type Message,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { getAppStorage } from "../../storage/app-storage.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

/**
 * Transport that calls LLM providers directly.
 * Optionally routes calls through a CORS proxy if enabled in settings.
 */
export class ProviderTransport implements AgentTransport {
	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		// Get API key from storage
		const apiKey = await getAppStorage().providerKeys.get(cfg.model.provider);
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
		};

		// Yield events from agentLoop
		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}
}
