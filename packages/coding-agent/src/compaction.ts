import type { Agent } from "@mariozechner/pi-agent-core";
import type { AgentLoopConfig, Message } from "@mariozechner/pi-ai";
import { type CompactionResult, ConversationCompactor } from "@mariozechner/pi-ai";

const autoEnabled = (process.env.PI_AUTO_COMPACT || "on").toLowerCase() !== "off";

export interface CompactionHandles {
	preprocessor: AgentLoopConfig["preprocessor"];
	compactNow: () => Promise<CompactionResult>;
	isEnabled: () => boolean;
}

export function setupCompaction(agent: Agent): CompactionHandles {
	const compactor = new ConversationCompactor();

	const buildContext = (signal?: AbortSignal) => {
		const model = agent.state.model;
		if (!model) return null;
		return { model, systemPrompt: agent.state.systemPrompt, signal };
	};

	const preprocessor: AgentLoopConfig["preprocessor"] = async (messages: Message[], signal?: AbortSignal) => {
		if (!autoEnabled) return messages;
		const ctx = buildContext(signal);
		if (!ctx) return messages;
		const res = await compactor.maybeCompact(messages, ctx);
		if (res.compacted) {
			// Persist into agent state so future turns start from the compacted transcript
			agent.replaceMessages(res.messages as any);
		}
		return res.messages;
	};

	const compactNow = async () => {
		const ctx = buildContext();
		if (!ctx) throw new Error("No model selected for compaction");
		const res = await compactor.maybeCompact(agent.state.messages as Message[], ctx, { force: true });
		if (res.compacted) {
			agent.replaceMessages(res.messages as any);
		}
		return res;
	};

	return {
		preprocessor,
		compactNow,
		isEnabled: () => autoEnabled,
	};
}
