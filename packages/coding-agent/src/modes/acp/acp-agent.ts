/**
 * ACP Agent - Implements the Agent interface from @agentclientprotocol/sdk.
 *
 * This bridges between the ACP protocol and pi's AgentSession.
 */

import {
	type Agent as AcpAgentInterface,
	type AgentSideConnection,
	type AuthenticateRequest,
	type CancelNotification,
	type InitializeRequest,
	type InitializeResponse,
	type LoadSessionRequest,
	type LoadSessionResponse,
	type NewSessionRequest,
	type NewSessionResponse,
	type PromptRequest,
	type PromptResponse,
	RequestError,
	type SetSessionModelRequest,
	type SetSessionModelResponse,
	type SetSessionModeRequest,
	type SetSessionModeResponse,
	type ToolCallContent,
	type ToolKind,
} from "@agentclientprotocol/sdk";
import { Agent, type Attachment, ProviderTransport, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import { VERSION } from "../../config.js";
import { AgentSession, type AgentSessionEvent } from "../../core/agent-session.js";
import { messageTransformer } from "../../core/messages.js";
import { getApiKeyForModel, getAvailableModels } from "../../core/model-config.js";
import { SessionManager } from "../../core/session-manager.js";
import { SettingsManager } from "../../core/settings-manager.js";
import { buildSystemPrompt } from "../../core/system-prompt.js";
import { codingTools } from "../../core/tools/index.js";
import { acpLog } from "./acp-mode.js";
import { AcpSessionManager, type AcpSessionState } from "./acp-session-manager.js";

export interface AcpAgentConfig {
	/** The working directory for sessions */
	cwd: string;
}

/**
 * ACP Agent implementation backed by pi's AgentSession.
 */
export class AcpAgent implements AcpAgentInterface {
	private connection: AgentSideConnection;
	private config: AcpAgentConfig;
	private sessionManager = new AcpSessionManager();
	private eventUnsubscribers = new Map<string, () => void>();
	private cwdLock: Promise<void> = Promise.resolve();

	/** Tracks whether we emitted any agent_message_chunk text deltas for the current assistant message. */
	private assistantTextDeltaEmittedBySession = new Map<string, boolean>();

	/** Stores tool args by toolCallId for use in tool_execution_end (which doesn't include args). */
	private toolArgsByCallId = new Map<string, unknown>();

	constructor(connection: AgentSideConnection, config: AcpAgentConfig) {
		this.connection = connection;
		this.config = config;
	}

	async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
		acpLog("info", "initialize called");
		return {
			protocolVersion: 1,
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: {
					embeddedContext: true,
					image: true,
				},
			},
			// Provide agent info via _meta extension point
			_meta: {
				agentInfo: {
					name: "pi",
					version: VERSION,
				},
			},
		};
	}

	async authenticate(_params: AuthenticateRequest): Promise<void> {
		throw new Error("Authentication not implemented");
	}

	/**
	 * Get the list of available slash commands for ACP.
	 */
	private getAvailableCommands(): Array<{ name: string; description: string; input?: { hint: string } | null }> {
		return [
			{
				name: "thinking",
				description: "Set reasoning level (off, minimal, low, medium, high, xhigh)",
				input: { hint: "level" },
			},
			{
				name: "compact",
				description: "Manually compact the session context",
				input: { hint: "optional instructions" },
			},
			{ name: "clear", description: "Clear context and start a fresh session" },
			{ name: "test-error", description: "Trigger a test error to verify error handling" },
		];
	}

	/**
	 * Send available commands to the client.
	 */
	private sendAvailableCommands(sessionId: string): void {
		const commands = this.getAvailableCommands();
		acpLog("info", "Sending available commands", { sessionId, commands: commands.map((c) => c.name) });
		this.connection
			.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "available_commands_update",
					availableCommands: commands,
				},
			})
			.catch((err) => {
				acpLog("error", "Failed to send available commands", err);
			});
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		acpLog("info", "newSession called", { cwd: params.cwd });
		const sessionId = crypto.randomUUID();
		const cwd = params.cwd || this.config.cwd;

		// Create AgentSession similar to main.ts
		const agentSession = await this.createAgentSession(cwd);

		// Store session state
		const state = this.sessionManager.create(sessionId, cwd, agentSession);

		// Set up event subscriptions
		this.setupEventSubscriptions(state);

		// Get available models - only include models if we have a current model
		const currentModel = agentSession.model;
		const models = await agentSession.getAvailableModels();

		const response: NewSessionResponse = {
			sessionId,
			modes: {
				availableModes: [{ id: "default", name: "Default", description: "Default coding mode" }],
				currentModeId: "default",
			},
		};

		// Only include models if we have a current model selected
		if (currentModel) {
			response.models = {
				currentModelId: `${currentModel.provider}/${currentModel.id}`,
				availableModels: models.map((m: Model<Api>) => ({
					modelId: `${m.provider}/${m.id}`,
					name: `${m.provider}/${m.name}`,
				})),
			};
		}

		// Send available slash commands to client after returning the response
		// Use setImmediate to ensure the response is sent first
		setImmediate(() => {
			this.sendAvailableCommands(sessionId);
		});

		return response;
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		const sessionId = params.sessionId;

		if (!this.sessionManager.has(sessionId)) {
			throw RequestError.invalidParams({ error: `Session not found: ${sessionId}` });
		}

		const state = this.sessionManager.get(sessionId);
		const currentModel = state.agentSession.model;
		const models = await state.agentSession.getAvailableModels();

		const response: LoadSessionResponse = {
			modes: {
				availableModes: [{ id: "default", name: "Default", description: "Default coding mode" }],
				currentModeId: "default",
			},
		};

		// Only include models if we have a current model selected
		if (currentModel) {
			response.models = {
				currentModelId: `${currentModel.provider}/${currentModel.id}`,
				availableModels: models.map((m: Model<Api>) => ({
					modelId: `${m.provider}/${m.id}`,
					name: `${m.provider}/${m.name}`,
				})),
			};
		}

		return response;
	}

	async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
		acpLog("info", "setSessionModel called", { sessionId: params.sessionId, modelId: params.modelId });
		const state = this.sessionManager.get(params.sessionId);
		const agentSession = state.agentSession;

		// Parse modelId as "provider/model"
		const [provider, ...modelParts] = params.modelId.split("/");
		const modelId = modelParts.join("/");

		if (!provider || !modelId) {
			throw RequestError.invalidParams({
				error: `Invalid modelId format: ${params.modelId}. Expected "provider/model"`,
			});
		}

		const models = await agentSession.getAvailableModels();
		const model = models.find((m: Model<Api>) => m.provider === provider && m.id === modelId);

		if (!model) {
			throw RequestError.invalidParams({ error: `Model not found: ${params.modelId}` });
		}

		await agentSession.setModel(model);

		return { _meta: {} };
	}

	async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse | undefined> {
		// pi doesn't have modes yet, just return undefined
		return undefined;
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		acpLog("info", "prompt called", { sessionId: params.sessionId, promptParts: params.prompt.length });
		const state = this.sessionManager.get(params.sessionId);
		const agentSession = state.agentSession;

		// Convert ACP prompt parts to text and attachments
		const { text, attachments } = this.convertPromptParts(params.prompt);

		// Check for slash commands
		const commandResult = await this.handleSlashCommand(params.sessionId, state, text.trim());
		if (commandResult.handled) {
			return {
				stopReason: "end_turn" as const,
			};
		}

		// Send prompt (don't await - events will stream)
		void this.runWithCwd(state.cwd, async () => {
			await agentSession.prompt(text, { attachments });
		}).catch((error: unknown) => {
			const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
			acpLog("error", "Prompt error:", errorMessage);
		});

		return {
			stopReason: "end_turn" as const,
		};
	}

	private parseThinkingLevel(value: string): ThinkingLevel | null {
		switch (value) {
			case "off":
			case "minimal":
			case "low":
			case "medium":
			case "high":
			case "xhigh":
				return value;
			default:
				return null;
		}
	}

	/**
	 * Handle slash commands. Returns { handled: true } if command was processed.
	 */
	private async handleSlashCommand(
		sessionId: string,
		state: AcpSessionState,
		text: string,
	): Promise<{ handled: boolean }> {
		if (!text.startsWith("/")) {
			return { handled: false };
		}

		const spaceIndex = text.indexOf(" ");
		const command = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		acpLog("info", "Handling slash command", { command, args });

		switch (command) {
			case "thinking": {
				const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
				const level = args.toLowerCase();
				const parsed = this.parseThinkingLevel(level);
				if (!parsed) {
					this.sendAgentMessage(
						sessionId,
						`Invalid thinking level: ${args}. Valid levels: ${validLevels.join(", ")}`,
					);
					return { handled: true };
				}
				state.agentSession.setThinkingLevel(parsed);
				this.sendAgentMessage(sessionId, `Thinking level set to: ${parsed}`);
				return { handled: true };
			}

			case "compact": {
				this.sendAgentMessage(sessionId, "Compacting session context...");
				try {
					await this.runWithCwd(state.cwd, async () => {
						await state.agentSession.compact(args || undefined);
					});
					this.sendAgentMessage(sessionId, "Context compacted successfully.");
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.sendAgentMessage(sessionId, `Error compacting: ${msg}`);
				}
				return { handled: true };
			}

			case "clear": {
				await state.agentSession.reset();
				this.sendAgentMessage(sessionId, "Session context cleared.");
				return { handled: true };
			}

			case "test-error": {
				// Simulate an error for testing error relay
				this.sendAgentMessage(sessionId, "Error: This is a test error to verify error handling works correctly.");
				return { handled: true };
			}

			default:
				// Unknown command - let it pass through to the model
				return { handled: false };
		}
	}

	/**
	 * Send an agent message chunk to the client.
	 */
	private sendAgentMessage(sessionId: string, text: string): void {
		this.connection
			.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text,
					},
				},
			})
			.catch(() => {});
	}

	async cancel(params: CancelNotification): Promise<void> {
		const state = this.sessionManager.get(params.sessionId);
		await this.runWithCwd(state.cwd, async () => state.agentSession.abort());
	}

	// =========================================================================
	// Private helpers
	// =========================================================================

	private async runWithCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
		const runner = async () => {
			const previousCwd = process.cwd();
			process.chdir(cwd);
			try {
				return await fn();
			} finally {
				process.chdir(previousCwd);
			}
		};

		const resultPromise = this.cwdLock.then(runner, runner);
		this.cwdLock = resultPromise.then(
			() => {
				// Ensure lock chain never rejects
			},
			() => {
				// Swallow errors to keep lock usable for future operations
			},
		);

		return resultPromise;
	}

	private async createAgentSession(cwd: string): Promise<AgentSession> {
		return this.runWithCwd(cwd, async () => {
			const settingsManager = new SettingsManager();
			// ACP mode sessions are in-memory only. We still use SessionManager to
			// keep AgentSession behavior consistent, but we disable all disk I/O.
			const sessionFileManager = new SessionManager(false);
			sessionFileManager.disable();

			// Build system prompt
			const systemPrompt = buildSystemPrompt({
				selectedTools: undefined,
				skillsEnabled: settingsManager.getSkillsEnabled(),
			});

			// Get initial model
			const { models: availableModels } = await getAvailableModels();
			const initialModel = availableModels.length > 0 ? availableModels[0] : null;
			acpLog("info", "Initial model selected", {
				model: initialModel ? `${initialModel.provider}/${initialModel.id}` : null,
				availableCount: availableModels.length,
			});

			if (!initialModel) {
				throw new Error("No models available. Please configure API keys.");
			}

			// Create agent
			const agent = new Agent({
				initialState: {
					systemPrompt,
					model: initialModel,
					thinkingLevel: settingsManager.getDefaultThinkingLevel() || ("off" as ThinkingLevel),
					tools: codingTools,
				},
				messageTransformer,
				queueMode: settingsManager.getQueueMode(),
				transport: new ProviderTransport({
					getApiKey: async () => {
						const currentModel = agent.state.model;
						if (!currentModel) {
							throw new Error("No model selected");
						}
						const key = await getApiKeyForModel(currentModel);
						if (!key) {
							throw new Error(`No API key found for provider "${currentModel.provider}"`);
						}
						return key;
					},
				}),
			});

			return new AgentSession({
				agent,
				sessionManager: sessionFileManager,
				settingsManager,
			});
		});
	}

	private setupEventSubscriptions(state: AcpSessionState) {
		const sessionId = state.id;
		const agentSession = state.agentSession;

		const unsubscribe = agentSession.subscribe((event: AgentSessionEvent) => {
			this.handleAgentEvent(sessionId, event);
		});

		this.eventUnsubscribers.set(sessionId, unsubscribe);
	}

	private handleAgentEvent(sessionId: string, event: AgentSessionEvent) {
		switch (event.type) {
			case "message_start": {
				const message = event.message as { role?: string };
				if (message.role === "assistant") {
					this.assistantTextDeltaEmittedBySession.set(sessionId, false);
				}
				break;
			}

			case "message_update": {
				const assistantEvent = event.assistantMessageEvent as AssistantMessageEvent;
				if (assistantEvent.type === "text_delta") {
					this.assistantTextDeltaEmittedBySession.set(sessionId, true);
					this.connection
						.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: {
									type: "text",
									text: assistantEvent.delta,
								},
							},
						})
						.catch(() => {});
				} else if (assistantEvent.type === "thinking_delta") {
					this.connection
						.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_thought_chunk",
								content: {
									type: "text",
									text: assistantEvent.delta,
								},
							},
						})
						.catch(() => {});
				}
				break;
			}

			case "message_end": {
				const message = event.message as {
					role?: string;
					content?: unknown;
					errorMessage?: string;
					stopReason?: string;
				};
				if (message.role === "assistant") {
					const hadTextDeltas = this.assistantTextDeltaEmittedBySession.get(sessionId) ?? false;

					// If there's an error, send it as an agent message so the user sees it
					if (message.errorMessage) {
						acpLog("error", "Model error", { error: message.errorMessage });
						this.connection
							.sessionUpdate({
								sessionId,
								update: {
									sessionUpdate: "agent_message_chunk",
									content: {
										type: "text",
										text: `Error: ${message.errorMessage}`,
									},
								},
							})
							.catch(() => {});
					} else if (!hadTextDeltas) {
						const text = this.extractTextFromAssistantMessage(event.message);
						if (text.trim().length > 0) {
							this.connection
								.sessionUpdate({
									sessionId,
									update: {
										sessionUpdate: "agent_message_chunk",
										content: {
											type: "text",
											text,
										},
									},
								})
								.catch(() => {});
						}
					}
					this.assistantTextDeltaEmittedBySession.delete(sessionId);
				}
				break;
			}

			case "tool_execution_start": {
				const args = this.asRecord(event.args);
				// Store args for later use in tool_execution_end (which doesn't include args)
				this.toolArgsByCallId.set(event.toolCallId, event.args);
				this.connection
					.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call",
							toolCallId: event.toolCallId,
							title: this.getToolTitle(event.toolName, args),
							kind: this.toToolKind(event.toolName),
							status: "pending",
							locations: this.toLocations(event.toolName, args),
							rawInput: event.args,
						},
					})
					.catch(() => {});
				break;
			}

			case "tool_execution_update": {
				const args = this.asRecord(event.args);
				const content = this.toToolCallContents(event.toolName, args, event.partialResult, {
					includeDiff: false,
				});

				this.connection
					.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: event.toolCallId,
							status: "in_progress",
							locations: this.toLocations(event.toolName, args),
							content: content.length > 0 ? content : undefined,
							rawInput: event.args,
						},
					})
					.catch(() => {});
				break;
			}

			case "tool_execution_end": {
				// Retrieve stored args from tool_execution_start (tool_execution_end doesn't include args)
				const storedArgs = this.toolArgsByCallId.get(event.toolCallId);
				const args = this.asRecord(storedArgs);
				const content = this.toToolCallContents(event.toolName, args, event.result, { includeDiff: true });

				this.connection
					.sessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: event.toolCallId,
							status: event.isError ? "failed" : "completed",
							kind: this.toToolKind(event.toolName),
							locations: this.toLocations(event.toolName, args),
							content: content.length > 0 ? content : undefined,
							rawInput: args,
							rawOutput: event.result,
						},
					})
					.catch(() => {});

				// Clean up stored args
				this.toolArgsByCallId.delete(event.toolCallId);
				break;
			}

			// turn_end and agent_end are handled implicitly - no action needed
		}
	}

	private extractTextFromAssistantMessage(message: unknown): string {
		const m = message as { role?: string; content?: unknown };
		if (m.role !== "assistant") return "";

		const content = m.content;
		if (typeof content === "string") return content;

		if (Array.isArray(content)) {
			return content
				.filter(
					(c): c is { type: "text"; text: string } =>
						Boolean(c) &&
						typeof c === "object" &&
						(c as { type?: unknown }).type === "text" &&
						typeof (c as { text?: unknown }).text === "string",
				)
				.map((c) => c.text)
				.join("");
		}

		return "";
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null;
	}

	private asRecord(value: unknown): Record<string, unknown> {
		return this.isRecord(value) ? value : {};
	}

	private getStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
		for (const key of keys) {
			const value = args[key];
			if (typeof value === "string" && value.length > 0) return value;
		}
		return undefined;
	}

	private toToolCallContents(
		toolName: string,
		args: Record<string, unknown>,
		result: unknown,
		options: { includeDiff: boolean },
	): ToolCallContent[] {
		const contents: ToolCallContent[] = [];

		const resultRecord = this.asRecord(result);
		const rawContent = "content" in resultRecord ? resultRecord.content : result;

		// Preserve structured tool output content blocks (text/image/etc.) if present.
		if (Array.isArray(rawContent)) {
			for (const block of rawContent) {
				const mapped = this.mapToolContentBlock(block);
				contents.push({ type: "content", content: mapped });
			}
		} else if (typeof rawContent === "string") {
			contents.push({ type: "content", content: { type: "text", text: rawContent } });
		} else if (rawContent !== undefined) {
			// Fallback: keep something human-readable.
			contents.push({
				type: "content",
				content: { type: "text", text: JSON.stringify(rawContent) },
			});
		}

		if (options.includeDiff) {
			const diff = this.toDiffContent(toolName, args, resultRecord);
			if (diff) contents.push(diff);
		}

		return contents;
	}

	private mapToolContentBlock(block: unknown): Extract<ToolCallContent, { type: "content" }>["content"] {
		if (this.isRecord(block)) {
			const type = block.type;

			if (type === "text" && typeof block.text === "string") {
				return { type: "text", text: block.text };
			}

			if (type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
				const uri = typeof block.uri === "string" ? block.uri : undefined;
				return uri
					? { type: "image", data: block.data, mimeType: block.mimeType, uri }
					: { type: "image", data: block.data, mimeType: block.mimeType };
			}
		}

		return { type: "text", text: JSON.stringify(block ?? "") };
	}

	private toDiffContent(
		toolName: string,
		args: Record<string, unknown>,
		result: Record<string, unknown>,
	): ToolCallContent | undefined {
		const tool = toolName.toLowerCase();
		if (tool !== "edit" && tool !== "write") return undefined;

		const path = this.getStringArg(args, ["path", "file_path"]);
		if (!path) return undefined;

		if (tool === "edit") {
			const oldText = this.getStringArg(args, ["oldText", "old_text"]);
			const newText = this.getStringArg(args, ["newText", "new_text"]);
			if (!newText) return undefined;

			const details = this.asRecord(result.details);
			const unifiedDiff = typeof details.diff === "string" ? details.diff : undefined;

			return {
				type: "diff",
				path,
				oldText,
				newText,
				_meta: unifiedDiff ? { unifiedDiff } : undefined,
			};
		}

		// write: represent as a diff for a new/overwritten file
		const newText = this.getStringArg(args, ["content"]);
		if (!newText) return undefined;

		return {
			type: "diff",
			path,
			oldText: null,
			newText,
		};
	}

	/**
	 * Generate a descriptive title for a tool call.
	 */
	private getToolTitle(toolName: string, args: Record<string, unknown>): string {
		const tool = toolName.toLowerCase();

		switch (tool) {
			case "bash": {
				const command = this.getStringArg(args, ["command"]);
				if (command) {
					// Truncate long commands
					const maxLen = 80;
					const truncated = command.length > maxLen ? command.slice(0, maxLen) + "..." : command;
					return `bash: ${truncated}`;
				}
				return "bash";
			}
			case "read": {
				const path = this.getStringArg(args, ["path"]);
				return path ? `read: ${path}` : "read";
			}
			case "write": {
				const path = this.getStringArg(args, ["path"]);
				return path ? `write: ${path}` : "write";
			}
			case "edit": {
				const path = this.getStringArg(args, ["path"]);
				return path ? `edit: ${path}` : "edit";
			}
			case "grep": {
				const pattern = this.getStringArg(args, ["pattern"]);
				return pattern ? `grep: ${pattern}` : "grep";
			}
			case "find": {
				const pattern = this.getStringArg(args, ["pattern", "glob"]);
				return pattern ? `find: ${pattern}` : "find";
			}
			case "ls": {
				const path = this.getStringArg(args, ["path"]);
				return path ? `ls: ${path}` : "ls";
			}
			default:
				return toolName;
		}
	}

	private toToolKind(toolName: string): ToolKind {
		const tool = toolName.toLowerCase();
		switch (tool) {
			case "bash":
				return "execute";
			case "edit":
			case "write":
				return "edit";
			case "grep":
			case "find":
				return "search";
			case "read":
			case "ls":
				return "read";
			default:
				return "other";
		}
	}

	private toLocations(toolName: string, args: Record<string, unknown>): { path: string }[] {
		const tool = toolName.toLowerCase();

		// pi tools generally use `path`. Some external/custom tools may use `file_path`.
		const path = this.getStringArg(args, ["path", "file_path"]);

		switch (tool) {
			case "read":
			case "edit":
			case "write":
				return path ? [{ path }] : [];
			case "grep":
			case "find":
			case "ls":
				return path ? [{ path }] : [];
			default:
				return [];
		}
	}

	private convertPromptParts(parts: PromptRequest["prompt"]): {
		text: string;
		attachments: Attachment[] | undefined;
	} {
		const textParts: string[] = [];
		const attachments: Attachment[] = [];

		for (const part of parts) {
			switch (part.type) {
				case "text":
					textParts.push(part.text);
					break;

				case "image":
					if (part.data) {
						// Detect actual image format from base64 data and correct mimeType if needed
						let detectedMimeType = part.mimeType;
						if (part.data.startsWith("iVBORw0KGgo")) {
							detectedMimeType = "image/png";
						} else if (part.data.startsWith("/9j/")) {
							detectedMimeType = "image/jpeg";
						} else if (part.data.startsWith("R0lGOD")) {
							detectedMimeType = "image/gif";
						} else if (part.data.startsWith("UklGR")) {
							detectedMimeType = "image/webp";
						}

						if (detectedMimeType !== part.mimeType) {
							acpLog("debug", "Correcting image mimeType", {
								original: part.mimeType,
								detected: detectedMimeType,
							});
						}

						attachments.push({
							id: crypto.randomUUID(),
							type: "image",
							fileName: "image",
							mimeType: detectedMimeType,
							size: part.data.length,
							content: part.data,
						});
					}
					break;

				case "resource":
					if ("text" in part.resource) {
						textParts.push(part.resource.text);
					}
					break;

				case "resource_link":
					// Include resource link URI as text context
					textParts.push(`[Resource: ${part.uri}]`);
					break;
			}
		}

		return {
			text: textParts.join("\n"),
			attachments: attachments.length > 0 ? attachments : undefined,
		};
	}
}
