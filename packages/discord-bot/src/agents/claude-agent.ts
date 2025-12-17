/**
 * AI Agent Spawner
 * Uses OpenRouter API for fast, intelligent responses
 * Default model: GLM-4.5 Flash for speed + intelligence
 */

import { EventEmitter } from "events";

// Default to GLM-4.6 for best coding performance
export const DEFAULT_AGENT_MODEL = "GLM-4.6";

// Alternative models
export const AGENT_MODELS = {
	"glm-4.6": "GLM-4.6",
	"glm-4.5": "GLM-4.5",
	"glm-4.5-air": "GLM-4.5-Air",
	haiku: "anthropic/claude-3.5-haiku",
	sonnet: "anthropic/claude-3.5-sonnet",
	"gpt-4o-mini": "openai/gpt-4o-mini",
	deepseek: "deepseek/deepseek-chat",
};

export interface AgentOptions {
	prompt: string;
	workingDir?: string;
	model?: string; // defaults to glm-4.5
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

export class ClaudeAgent extends EventEmitter {
	private openRouterApiKey: string;
	private zaiApiKey: string;

	constructor() {
		super();
		this.openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
		this.zaiApiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ZAI_API_KEY || "";
	}

	/**
	 * Run an agent with a prompt via OpenRouter or Z.ai
	 */
	async run(options: AgentOptions): Promise<AgentResult> {
		const {
			prompt,
			model = DEFAULT_AGENT_MODEL,
			maxTokens = 8000, // GLM-4.5 uses reasoning tokens, needs more
			timeout = 60000,
			systemPrompt,
		} = options;

		const startTime = Date.now();

		// Check if it's a Z.ai GLM model
		const isZaiModel = model.startsWith("z-ai/") || model.startsWith("GLM-");

		let apiKey: string;
		let endpoint: string;
		let headers: Record<string, string>;
		let body: any;

		if (isZaiModel) {
			// Use Z.ai Anthropic endpoint
			apiKey = this.zaiApiKey;
			endpoint = "https://api.z.ai/api/anthropic/v1/messages";

			if (!apiKey) {
				return {
					success: false,
					output: "",
					error: "Z.ai API key not configured (set ANTHROPIC_AUTH_TOKEN)",
					duration: Date.now() - startTime,
					model,
				};
			}

			headers = {
				"x-api-key": apiKey,
				"content-type": "application/json",
				"anthropic-version": "2023-06-01",
			};

			// Convert model name for Z.ai
			const zaiModel = model.replace("z-ai/", "GLM-");

			// Anthropic format
			body = {
				model: zaiModel,
				max_tokens: maxTokens,
				messages: [],
			};

			if (systemPrompt) {
				body.system = systemPrompt;
			}
			body.messages.push({ role: "user", content: prompt });
		} else {
			// Use OpenRouter
			apiKey = this.openRouterApiKey;
			endpoint = "https://openrouter.ai/api/v1/chat/completions";

			if (!apiKey) {
				return {
					success: false,
					output: "",
					error: "OPENROUTER_API_KEY not configured",
					duration: Date.now() - startTime,
					model,
				};
			}

			headers = {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			};

			// OpenAI format
			const messages: { role: string; content: string }[] = [];
			if (systemPrompt) {
				messages.push({ role: "system", content: systemPrompt });
			}
			messages.push({ role: "user", content: prompt });

			body = {
				model,
				messages,
				max_tokens: maxTokens,
			};
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			const response = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			const data = await response.json();

			if (data.error) {
				return {
					success: false,
					output: "",
					error: data.error.message || JSON.stringify(data.error),
					duration: Date.now() - startTime,
					model,
				};
			}

			// Extract content based on response format
			let content = "";
			if (isZaiModel) {
				// Anthropic format
				content = data.content?.[0]?.text || "";
			} else {
				// OpenAI format
				content = data.choices?.[0]?.message?.content || "";
			}

			const usage = data.usage;

			return {
				success: true,
				output: content,
				duration: Date.now() - startTime,
				model,
				tokens: usage
					? {
							prompt: usage.prompt_tokens || usage.input_tokens,
							completion: usage.completion_tokens || usage.output_tokens,
							total: usage.total_tokens || usage.input_tokens + usage.output_tokens,
						}
					: undefined,
				cost: usage?.cost,
			};
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				output: "",
				error: errMsg.includes("aborted") ? "Request timed out" : errMsg,
				duration: Date.now() - startTime,
				model,
			};
		}
	}

	/**
	 * Check if OpenRouter is configured
	 */
	static async isAvailable(): Promise<boolean> {
		return !!process.env.OPENROUTER_API_KEY;
	}

	/**
	 * Get available models
	 */
	static getModels(): Record<string, string> {
		return AGENT_MODELS;
	}
}

/**
 * Pre-configured agent types for common tasks
 * All use GLM-4.5 Flash by default for speed + intelligence
 */
export const AgentPresets = {
	/** Code review agent - fast analysis */
	codeReview: (code: string, context?: string): AgentOptions => ({
		prompt: `Review this code for bugs, security issues, and improvements:\n\n${code}${context ? `\n\nContext: ${context}` : ""}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 30000,
	}),

	/** Research agent - comprehensive but quick */
	research: (topic: string): AgentOptions => ({
		prompt: `Research the following topic and provide a comprehensive summary with key findings:\n\n${topic}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 8000,
		timeout: 60000,
	}),

	/** Trading analysis agent - quick market insights */
	tradingAnalysis: (symbol: string, data: string): AgentOptions => ({
		prompt: `Analyze the following trading data for ${symbol} and provide actionable insights:\n\n${data}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 45000,
		systemPrompt:
			"You are a professional quantitative trading analyst. Provide data-driven analysis with specific entry/exit recommendations.",
	}),

	/** Code generation agent - fast coding */
	codeGen: (task: string, language: string = "typescript"): AgentOptions => ({
		prompt: `Generate ${language} code for the following task:\n\n${task}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 8000,
		timeout: 60000,
	}),

	/** Debug agent - quick diagnostics */
	debug: (error: string, context: string): AgentOptions => ({
		prompt: `Debug this error and suggest a fix:\n\nError: ${error}\n\nContext:\n${context}`,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000,
		timeout: 30000,
	}),

	/** Quick question - fastest response */
	quick: (question: string): AgentOptions => ({
		prompt: question,
		model: DEFAULT_AGENT_MODEL,
		maxTokens: 4000, // GLM-4.5 uses reasoning tokens
		timeout: 30000,
	}),
};

// Singleton instance
let agentInstance: ClaudeAgent | null = null;

export function getClaudeAgent(): ClaudeAgent {
	if (!agentInstance) {
		agentInstance = new ClaudeAgent();
	}
	return agentInstance;
}

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
	const agent = new ClaudeAgent();
	return agent.run(options);
}
