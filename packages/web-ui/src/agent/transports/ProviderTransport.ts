import {
	type AgentContext,
	type AgentLoopConfig,
	agentLoop,
	agentLoopContinue,
	type Message,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { getAppStorage } from "../../storage/app-storage.js";
import { applyProxyIfNeeded } from "../../utils/proxy-utils.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

/**
 * Transport that calls LLM providers directly.
 * Uses CORS proxy only for providers that require it (Anthropic OAuth, Z-AI).
 */
export class ProviderTransport implements AgentTransport {
	private async getModel(cfg: AgentRunConfig) {
		const apiKey = await getAppStorage().providerKeys.get(cfg.model.provider);
		if (!apiKey) {
			throw new Error("no-api-key");
		}

		const proxyEnabled = await getAppStorage().settings.get<boolean>("proxy.enabled");
		const proxyUrl = await getAppStorage().settings.get<string>("proxy.url");
		const model = applyProxyIfNeeded(cfg.model, apiKey, proxyEnabled ? proxyUrl || undefined : undefined);

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
			getApiKey: async (provider: string) => {
				const key = await getAppStorage().providerKeys.get(provider);
				return key ?? undefined; // Convert null to undefined for type compatibility
			},
			getQueuedMessages: cfg.getQueuedMessages,
		};
	}

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		const model = await this.getModel(cfg);
		const context = this.buildContext(messages, cfg);
		const pc = this.buildLoopConfig(model, cfg);

		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}

	async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
		const model = await this.getModel(cfg);
		const context = this.buildContext(messages, cfg);
		const pc = this.buildLoopConfig(model, cfg);

		for await (const ev of agentLoopContinue(context, pc, signal)) {
			yield ev;
		}
	}
}
