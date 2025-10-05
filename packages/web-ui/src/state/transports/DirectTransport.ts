import { type AgentContext, agentLoop, type Message, type PromptConfig, type UserMessage } from "@mariozechner/pi-ai";
import { keyStore } from "../KeyStore.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

export class DirectTransport implements AgentTransport {
	constructor(private readonly getMessages: () => Promise<Message[]>) {}

	async *run(userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		// Get API key from KeyStore
		const apiKey = await keyStore.getKey(cfg.model.provider);
		if (!apiKey) {
			throw new Error("no-api-key");
		}

		const context: AgentContext = {
			systemPrompt: cfg.systemPrompt,
			messages: await this.getMessages(),
			tools: cfg.tools,
		};

		const pc: PromptConfig = {
			model: cfg.model,
			reasoning: cfg.reasoning,
			apiKey,
		};

		// Yield events from agentLoop
		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
			yield ev;
		}
	}
}
