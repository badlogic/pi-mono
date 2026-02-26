import { getModel, getModels, type KnownProvider, type Model, type Api } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	createBashTool,
	createReadTool,
	createGrepTool,
	createFindTool,
	createLsTool,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { createGitCloneTool, createGitHubZipTool } from "./git-tool.js";
import { summarizeConversation } from "./memory/index.js";
import { createPiResourceLoader } from "./resource-loader.js";

export type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface AgentConfig {
	repoPath: string;
	apiKey?: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	systemPrompt?: string;
	/** Custom base URL for OpenAI-compatible APIs (e.g., https://xxxx.yy/v1) */
	baseUrl?: string;
}

export interface ToolCallRecord {
	name: string;
	args: Record<string, unknown>;
	result: string;
	isError: boolean;
}

export interface AnalysisResult {
	success: boolean;
	response: string;
	toolCalls: ToolCallRecord[];
	tokens?: {
		input: number;
		output: number;
		total: number;
	};
}

export class AgentService {
	private session: AgentSession | null = null;
	private config: AgentConfig;

	constructor(config: AgentConfig) {
		this.config = config;
	}

	async initialize(): Promise<void> {
		const {
			repoPath,
			apiKey,
			provider = "anthropic",
			modelId = "claude-sonnet-4-20250514",
			thinkingLevel = "medium",
			systemPrompt,
			baseUrl,
		} = this.config;

		const authStorage = AuthStorage.create();
		if (apiKey) {
			authStorage.setRuntimeApiKey(provider, apiKey);
		}

		const modelRegistry = new ModelRegistry(authStorage);

		// Get model - either from registry or create custom one for OpenAI-compatible APIs
		let model: Model<Api> | undefined;

		if (baseUrl) {
			// Create custom model for OpenAI-compatible API
			model = this.createCustomOpenAIModel(modelId, baseUrl);
		} else {
			// Use model from registry
			const models = getModels(provider as KnownProvider);
			model = models.find((m) => m.id === modelId);
		}

		if (!model) {
			throw new Error(`Model not found: ${provider}/${modelId}`);
		}

		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
			retry: { enabled: true, maxRetries: 2 },
		});

		const tools = [
			createReadTool(repoPath),
			createBashTool(repoPath),
			createGrepTool(repoPath),
			createFindTool(repoPath),
			createLsTool(repoPath),
			createGitCloneTool(repoPath),
			createGitHubZipTool(repoPath),
		];

		// Load resources from .pi directory
		const resourceLoader = await createPiResourceLoader({
			repoPath,
		});

		const { session } = await createAgentSession({
			cwd: repoPath,
			model,
			thinkingLevel,
			authStorage,
			modelRegistry,
			resourceLoader,
			tools,
			sessionManager: SessionManager.inMemory(),
			settingsManager,
		});

		this.session = session;
	}

	async analyze(prompt: string, onEvent?: (event: AgentSessionEvent) => void): Promise<AnalysisResult> {
		if (!this.session) {
			await this.initialize();
		}

		const toolCalls: ToolCallRecord[] = [];
		const toolArgsMap = new Map<string, Record<string, unknown>>();
		let response = "";
		let tokens = { input: 0, output: 0, total: 0 };

		const unsubscribe = this.session!.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				response += event.assistantMessageEvent.delta;
				if (onEvent) {
					onEvent(event);
				}
			}

			if (event.type === "tool_execution_start") {
				toolArgsMap.set(event.toolCallId, event.args as Record<string, unknown>);
				if (onEvent) {
					onEvent(event);
				}
			}

			if (event.type === "tool_execution_end") {
				const resultText =
					event.result?.content?.[0]?.type === "text"
						? event.result.content[0].text
						: JSON.stringify(event.result?.content);
				toolCalls.push({
					name: event.toolName,
					args: toolArgsMap.get(event.toolCallId) || {},
					result: resultText,
					isError: event.isError,
				});
				toolArgsMap.delete(event.toolCallId);
				if (onEvent) {
					onEvent(event);
				}
			}

			if (event.type === "message_end" && event.message.role === "assistant") {
				const usage = (event.message as any).usage;
				if (usage) {
					tokens = {
						input: usage.input || 0,
						output: usage.output || 0,
						total: usage.totalTokens || usage.input + usage.output || 0,
					};
				}
			}
		});

		try {
			await this.session!.prompt(prompt);
		} finally {
			unsubscribe();
		}

		return {
			success: true,
			response,
			toolCalls,
			tokens,
		};
	}

	async chat(prompt: string): Promise<string> {
		if (!this.session) {
			await this.initialize();
		}

		let response = "";

		const unsubscribe = this.session!.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				response += event.assistantMessageEvent.delta;
			}
		});

		try {
			await this.session!.prompt(prompt);
		} finally {
			unsubscribe();
		}

		return response;
	}

	getMessages(): AgentSession["agent"]["state"]["messages"] {
		if (!this.session) {
			return [];
		}
		return this.session.agent.state.messages;
	}

	async summarize(): Promise<string> {
		const messages = this.getMessages();
		return summarizeConversation(messages as any, {
			provider: this.config.provider,
			modelId: this.config.modelId,
			apiKey: this.config.apiKey,
			baseUrl: this.config.baseUrl,
		});
	}

	async dispose(): Promise<void> {
		if (this.session) {
			this.session.dispose();
			this.session = null;
		}
	}

	/**
	 * Create a custom OpenAI-compatible model configuration
	 */
	private createCustomOpenAIModel(modelId: string, baseUrl: string): Model<"openai-completions"> {
		return {
			id: modelId,
			name: modelId,
			api: "openai-completions",
			provider: "openai",
			baseUrl: baseUrl,
			reasoning: false,
			input: ["text", "image"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 4096,
			compat: {
				maxTokensField: "max_completion_tokens",
				supportsReasoningEffort: false,
				supportsDeveloperRole: false,
			},
		};
	}
}
