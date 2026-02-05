import type { AgentMessage, AgentTool, StreamFn } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";
import { existsSync } from "fs";
import { join } from "path";
import { createDecisionRecorder, type DecisionRecorder } from "./decision-log.js";
import { buildGamePrompt, loadSoul, loadTaskLists } from "./soul.js";
import { createTickLoop, formatTickPrompt, type TickLoop } from "./tick-loop.js";
import { createGameTools } from "./tools.js";
import type { GameAgentConfig, WorldState } from "./types.js";

export interface GameAgentResult {
	agent: Agent;
	tools: AgentTool[];
	ticker: TickLoop;
	recorder: DecisionRecorder;
	dispose(): Promise<void>;
}

export interface CreateGameAgentOptions<TState extends WorldState = WorldState> extends GameAgentConfig<TState> {
	/** Custom stream function (for testing with mocks) */
	streamFn?: StreamFn;
}

export function createGameAgent<TState extends WorldState = WorldState>(
	options: CreateGameAgentOptions<TState>,
): GameAgentResult {
	const { adapter, dataDir, model, tickIntervalMs = 60_000, streamFn } = options;

	// Load soul and task lists
	const soulPath = join(dataDir, "soul.md");
	const soul = existsSync(soulPath) ? loadSoul(soulPath) : "You are an autonomous game agent.";

	const taskListDir = join(dataDir, "tasks");
	const taskLists = loadTaskLists(taskListDir);

	// Build prompt
	const { systemPrompt, appendSections } = buildGamePrompt({ soul, taskLists });
	const fullSystemPrompt = [systemPrompt, ...appendSections].join("\n\n");

	// Create tools
	const gameTools = createGameTools(adapter);
	const allTools = [...gameTools];

	// Create decision recorder
	const decisionLogDir = join(dataDir, "decisions");
	const recorder = createDecisionRecorder(decisionLogDir);

	// Default convertToLlm - filter to standard message types
	const convertToLlm = (messages: AgentMessage[]): Message[] => {
		return messages.filter(
			(m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
		);
	};

	// Create agent
	const agentOptions: ConstructorParameters<typeof Agent>[0] = {
		initialState: {
			systemPrompt: fullSystemPrompt,
			model: model as Model<any>,
			thinkingLevel: model?.reasoning ? "medium" : "off",
			tools: allTools,
			messages: [],
		},
		convertToLlm,
	};

	if (streamFn) {
		agentOptions.streamFn = streamFn;
	}

	const agent = new Agent(agentOptions);

	// Create tick loop
	const ticker = createTickLoop({
		intervalMs: tickIntervalMs,
		onTick: async () => {
			const state = await adapter.getWorldState();
			const prompt = formatTickPrompt(state);
			await agent.prompt(prompt);
		},
		onError: (err) => {
			console.error("Tick error:", err.message);
		},
	});

	return {
		agent,
		tools: allTools,
		ticker,
		recorder,
		async dispose() {
			ticker.stop();
			agent.abort();
		},
	};
}
