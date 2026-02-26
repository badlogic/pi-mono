import { getModel } from "@mariozechner/pi-ai";
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
	createExtensionRuntime,
	type ResourceLoader,
	type AgentSession,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { createGitCloneTool, createGitHubZipTool } from "./git-tool.js";

export interface AgentConfig {
	repoPath: string;
	apiKey?: string;
	provider?: string;
	modelId?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	systemPrompt?: string;
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
		} = this.config;

		const authStorage = AuthStorage.create();
		if (apiKey) {
			authStorage.setRuntimeApiKey(provider, apiKey);
		}

		const modelRegistry = new ModelRegistry(authStorage);
		const model = getModel(provider, modelId);
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

		const resourceLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => systemPrompt || this.buildDefaultSystemPrompt(),
			getAppendSystemPrompt: () => [],
			getPathMetadata: () => new Map(),
			extendResources: () => {},
			reload: async () => {},
		};

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

	private buildDefaultSystemPrompt(): string {
		return `You are a code analysis assistant. Analyze code in the repository.

Available tools:
- read: Read file contents (supports offset/limit for large files)
- grep: Search file contents for patterns (supports regex)
- find: Find files by glob pattern
- ls: List directory contents
- bash: Execute shell commands
- git_clone: Clone a Git repository to the local filesystem
- github_zip: Download GitHub repository as ZIP using PAT (faster for large repos)

Guidelines:
1. If no code is available, use git_clone or github_zip to get the repository first
2. For GitHub repos, prefer github_zip (requires GITHUB_PAT env var) as it's faster
3. Start by exploring the directory structure with ls or find
4. Use grep to find relevant code patterns
5. Read specific files to understand implementation details
6. Be concise and focus on the user's specific questions
7. Provide actionable insights and code examples when helpful`;
	}

	async analyze(prompt: string, onEvent?: (event: AgentSessionEvent) => void): Promise<AnalysisResult> {
		if (!this.session) {
			await this.initialize();
		}

		const toolCalls: ToolCallRecord[] = [];
		let response = "";
		let tokens = { input: 0, output: 0, total: 0 };

		const unsubscribe = this.session!.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				response += event.assistantMessageEvent.delta;
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
					args: event.args as Record<string, unknown>,
					result: resultText,
					isError: event.isError,
				});
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

	async dispose(): Promise<void> {
		if (this.session) {
			this.session.dispose();
			this.session = null;
		}
	}
}
