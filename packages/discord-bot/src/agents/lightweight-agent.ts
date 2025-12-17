/**
 * Lightweight Agent - Pi-Mono Pattern
 * Uses pi-agent-core for fast, tool-less LLM queries
 * Follows the same patterns as packages/mom/src/agent.ts
 */

import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

// Default to GLM-4.6 for best coding performance
export const DEFAULT_AGENT_MODEL = "glm-4.6";

// Available models by provider
export const AGENT_MODELS: Record<string, { provider: string; model: string; name: string }> = {
	"glm-4.6": { provider: "zai", model: "glm-4.6", name: "GLM 4.6 (Top Coding)" },
	"glm-4.5": { provider: "zai", model: "glm-4.5", name: "GLM 4.5" },
	"glm-4.5-air": { provider: "zai", model: "glm-4.5-air", name: "GLM 4.5 Air (Fast)" },
	haiku: { provider: "anthropic", model: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
	sonnet: { provider: "anthropic", model: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
	"gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini", name: "GPT-4o Mini" },
	deepseek: { provider: "openrouter", model: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
};

export interface AgentOptions {
	prompt: string;
	workingDir?: string;
	model?: string;
	maxTokens?: number;
	timeout?: number;
	systemPrompt?: string;
}

export interface AgentResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	model: string;
	tokens?: { prompt: number; completion: number; total: number };
	cost?: number;
}

/**
 * Get API key for provider
 */
function getApiKey(provider: string): string {
	switch (provider) {
		case "zai":
			return process.env.ZAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN || "";
		case "openai":
			return process.env.OPENAI_API_KEY || "";
		case "openrouter":
			return process.env.OPENROUTER_API_KEY || "";
		default:
			return "";
	}
}

/**
 * Run a lightweight agent task using pi-agent-core
 * No tools - just fast LLM responses
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
	const {
		prompt,
		model: modelKey = DEFAULT_AGENT_MODEL,
		maxTokens = 8000,
		timeout = 60000,
		systemPrompt = "You are a helpful AI assistant. Be concise and accurate.",
	} = options;

	const startTime = Date.now();

	// Get model config
	const modelConfig = AGENT_MODELS[modelKey] || AGENT_MODELS[DEFAULT_AGENT_MODEL];
	const apiKey = getApiKey(modelConfig.provider);

	if (!apiKey) {
		return {
			success: false,
			output: "",
			error: `No API key configured for provider: ${modelConfig.provider}`,
			duration: Date.now() - startTime,
			model: modelKey,
		};
	}

	try {
		// Get model from pi-ai (follows pi-mono pattern)
		const model = getModel(modelConfig.provider as any, modelConfig.model);

		// Create agent with pi-agent-core (follows mom pattern)
		const agent = new Agent({
			initialState: {
				systemPrompt,
				model,
				thinkingLevel: "off",
				tools: [], // No tools = lightweight mode
			},
			transport: new ProviderTransport({
				getApiKey: async () => apiKey,
			}),
		});

		// Collect response
		let output = "";
		let tokens: { prompt: number; completion: number; total: number } | undefined;
		let cost: number | undefined;
		let errorMessage: string | undefined;

		// Subscribe to events
		agent.subscribe((event: AgentEvent) => {
			if (event.type === "message_end") {
				const msg = event.message as any;
				if (msg.role === "assistant") {
					// Extract text content
					const textParts = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text);
					output = textParts.join("\n");

					// Extract usage
					if (msg.usage) {
						tokens = {
							prompt: msg.usage.input || 0,
							completion: msg.usage.output || 0,
							total: (msg.usage.input || 0) + (msg.usage.output || 0),
						};
						cost = msg.usage.cost?.total;
					}

					// Check for errors
					if (msg.stopReason === "error") {
						errorMessage = msg.errorMessage;
					}
				}
			}
		});

		// Run with timeout
		const timeoutPromise = new Promise<void>((_, reject) => {
			setTimeout(() => reject(new Error("Request timed out")), timeout);
		});

		await Promise.race([agent.prompt(prompt), timeoutPromise]);

		return {
			success: !errorMessage,
			output,
			error: errorMessage,
			duration: Date.now() - startTime,
			model: modelKey,
			tokens,
			cost,
		};
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: "",
			error: errMsg,
			duration: Date.now() - startTime,
			model: modelKey,
		};
	}
}

/**
 * Check if any agent provider is available
 */
export function isAgentAvailable(): boolean {
	return !!(
		process.env.ZAI_API_KEY ||
		process.env.ANTHROPIC_AUTH_TOKEN ||
		process.env.OPENROUTER_API_KEY ||
		process.env.ANTHROPIC_API_KEY
	);
}

/**
 * Get available models
 */
export function getAgentModels(): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, config] of Object.entries(AGENT_MODELS)) {
		result[key] = config.name;
	}
	return result;
}

/**
 * Pre-configured agent types for common tasks
 */
export const AgentPresets = {
	/** Code review agent */
	codeReview: (code: string, context?: string): AgentOptions => ({
		prompt: `Review this code for bugs, security issues, and improvements:\n\n${code}${context ? `\n\nContext: ${context}` : ""}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 30000,
	}),

	/** Research agent */
	research: (topic: string): AgentOptions => ({
		prompt: `Research the following topic and provide a comprehensive summary with key findings:\n\n${topic}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 8000,
		timeout: 60000,
	}),

	/** Trading analysis agent */
	tradingAnalysis: (symbol: string, data: string): AgentOptions => ({
		prompt: `Analyze the following trading data for ${symbol} and provide actionable insights:\n\n${data}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 45000,
		systemPrompt:
			"You are a professional quantitative trading analyst. Provide data-driven analysis with specific entry/exit recommendations.",
	}),

	/** Code generation agent */
	codeGen: (task: string, language = "typescript"): AgentOptions => ({
		prompt: `Generate ${language} code for the following task:\n\n${task}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 8000,
		timeout: 60000,
	}),

	/** Debug agent */
	debug: (error: string, context: string): AgentOptions => ({
		prompt: `Debug this error and suggest a fix:\n\nError: ${error}\n\nContext:\n${context}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 30000,
	}),

	/** Quick question */
	quick: (question: string): AgentOptions => ({
		prompt: question,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 30000,
	}),
};

/**
 * Learning-enabled agent options
 */
export interface LearningAgentOptions extends AgentOptions {
	mode?: string; // Expertise mode (general, coding, research, trading)
	enableLearning?: boolean; // Enable Act-Learn-Reuse cycle
}

/**
 * Learning agent result with expertise info
 */
export interface LearningAgentResult extends AgentResult {
	learned?: {
		learned: boolean;
		insight: string;
		expertiseFile: string;
	};
	mode?: string;
}

/**
 * Run a learning-enabled agent task
 * Implements Act-Learn-Reuse pattern from TAC Lesson 13
 */
export async function runLearningAgent(options: LearningAgentOptions): Promise<LearningAgentResult> {
	const { mode = "general", enableLearning = true, ...agentOptions } = options;

	// Import expertise manager (dynamic to avoid circular deps)
	const { actLearnReuse } = await import("./expertise-manager.js");

	if (!enableLearning) {
		// Standard execution without learning
		const result = await runAgent(agentOptions);
		return { ...result, mode };
	}

	// ACT-LEARN-REUSE cycle
	const { success, output, learned, result } = await actLearnReuse(
		mode,
		agentOptions.prompt,
		async (enhancedPrompt) => {
			const agentResult = await runAgent({
				...agentOptions,
				prompt: enhancedPrompt,
			});
			return {
				success: agentResult.success,
				output: agentResult.output,
				result: agentResult,
			};
		},
	);

	return {
		...(result as AgentResult),
		success,
		output,
		learned,
		mode,
	};
}

/**
 * Learning-enabled presets
 */
export const LearningPresets = {
	/** Code review with learning */
	codeReview: (code: string, context?: string): LearningAgentOptions => ({
		...AgentPresets.codeReview(code, context),
		mode: "coding",
		enableLearning: true,
	}),

	/** Research with learning */
	research: (topic: string): LearningAgentOptions => ({
		...AgentPresets.research(topic),
		mode: "research",
		enableLearning: true,
	}),

	/** Trading analysis with learning */
	tradingAnalysis: (symbol: string, data: string): LearningAgentOptions => ({
		...AgentPresets.tradingAnalysis(symbol, data),
		mode: "trading",
		enableLearning: true,
	}),

	/** General task with learning */
	general: (task: string): LearningAgentOptions => ({
		prompt: task,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 8000,
		timeout: 60000,
		mode: "general",
		enableLearning: true,
	}),
};
