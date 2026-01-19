/**
 * AcpSession: Wraps AgentSession with ACP event translation.
 *
 * Handles the translation between pi's AgentSession events and
 * ACP session/update notifications, including slash commands support.
 */

import * as crypto from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { acpDebug } from "./acp-mode.js";

/**
 * AcpSession wraps an AgentSession and translates events to ACP notifications.
 *
 * Each AcpSession corresponds to a unique sessionId in the ACP protocol
 * and manages the event subscription and translation for that session.
 */
export class AcpSession {
	readonly id: string;
	private readonly _agentSession: AgentSession;
	private readonly _connection: acp.AgentSideConnection;

	/** AbortController for the current pending prompt, if any */
	private _pendingPrompt: AbortController | null = null;

	/** Map of pi tool call IDs to ACP tool call IDs */
	private _toolCallIds: Map<string, string> = new Map();

	constructor(id: string, agentSession: AgentSession, connection: acp.AgentSideConnection) {
		this.id = id;
		this._agentSession = agentSession;
		this._connection = connection;
	}

	/**
	 * Send the available commands update to the client.
	 * Called after session creation to advertise available slash commands.
	 */
	sendAvailableCommands(): void {
		const commands = this._buildAvailableCommands();
		acpDebug(`sendAvailableCommands: ${commands.length} commands`);
		this._sendUpdate({
			sessionUpdate: "available_commands_update",
			availableCommands: commands,
		});
	}

	/**
	 * Build the list of available slash commands.
	 */
	private _buildAvailableCommands(): acp.AvailableCommand[] {
		const commands: acp.AvailableCommand[] = [
			{
				name: "compact",
				description: "Manually compact the session context to free up tokens",
			},
			{
				name: "new",
				description: "Start a new session",
			},
			{
				name: "thinking",
				description: "Set thinking level (off, low, medium, high)",
				input: { hint: "level (off, low, medium, high)" },
			},
		];

		// Add prompt template commands
		for (const template of this._agentSession.promptTemplates) {
			commands.push({
				name: template.name,
				description: template.description,
				input: { hint: "additional context" },
			});
		}

		// Add skill commands if enabled
		const skillsSettings = this._agentSession.skillsSettings;
		if (skillsSettings?.enableSkillCommands) {
			for (const skill of this._agentSession.skills) {
				commands.push({
					name: `skill:${skill.name}`,
					description: skill.description,
					input: { hint: "task description" },
				});
			}
		}

		// Add extension commands
		const extensionCommands = this._agentSession.extensionRunner?.getRegisteredCommands() ?? [];
		for (const cmd of extensionCommands) {
			commands.push({
				name: cmd.name,
				description: cmd.description ?? "(extension command)",
				input: { hint: "command arguments" },
			});
		}

		return commands;
	}

	/**
	 * Check if text is a slash command and handle it.
	 * @returns true if the text was handled as a command, false otherwise
	 */
	private async _handleSlashCommand(text: string): Promise<{ handled: boolean; stopReason?: acp.StopReason }> {
		if (!text.startsWith("/")) {
			return { handled: false };
		}

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const commandArg = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		acpDebug(`slash command: /${commandName} arg="${commandArg}"`);

		switch (commandName) {
			case "compact": {
				await this._handleCompactCommand();
				return { handled: true, stopReason: "end_turn" };
			}

			case "new": {
				await this._handleNewCommand();
				return { handled: true, stopReason: "end_turn" };
			}

			case "thinking": {
				this._handleThinkingCommand(commandArg);
				return { handled: true, stopReason: "end_turn" };
			}

			default: {
				// Check if it's a prompt template command
				const template = this._agentSession.promptTemplates.find((t) => t.name === commandName);
				if (template) {
					// Return false to let the prompt be processed normally with template expansion
					return { handled: false };
				}

				// Check if it's a skill command
				const skillsSettings = this._agentSession.skillsSettings;
				if (skillsSettings?.enableSkillCommands && commandName.startsWith("skill:")) {
					const skillName = commandName.slice(6);
					const skill = this._agentSession.skills.find((s) => s.name === skillName);
					if (skill) {
						// Return false to let the prompt be processed normally
						return { handled: false };
					}
				}

				// Check if it's an extension command
				const extensionCommand = this._agentSession.extensionRunner?.getCommand(commandName);
				if (extensionCommand) {
					// Return false to let AgentSession handle the extension command
					return { handled: false };
				}

				// Unknown command - send as agent message
				this._sendUpdate({
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: `Unknown command: /${commandName}`,
					},
				});
				return { handled: true, stopReason: "end_turn" };
			}
		}
	}

	/**
	 * Handle /compact command.
	 */
	private async _handleCompactCommand(): Promise<void> {
		try {
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: "Compacting session context...\n",
				},
			});

			const result = await this._agentSession.compact();

			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `Compaction complete. Context had ${result.tokensBefore} tokens before compaction.`,
				},
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `Compaction failed: ${errorMessage}`,
				},
			});
		}
	}

	/**
	 * Handle /new command.
	 */
	private async _handleNewCommand(): Promise<void> {
		const success = await this._agentSession.newSession();

		if (success) {
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: "New session started.",
				},
			});
		} else {
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: "Failed to start new session.",
				},
			});
		}
	}

	/**
	 * Handle /thinking command.
	 */
	private _handleThinkingCommand(level: string): void {
		const validLevels: ThinkingLevel[] = ["off", "low", "medium", "high"];
		const normalizedLevel = level.toLowerCase() as ThinkingLevel;

		if (!validLevels.includes(normalizedLevel)) {
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `Invalid thinking level: "${level}". Valid levels: ${validLevels.join(", ")}`,
				},
			});
			return;
		}

		this._agentSession.setThinkingLevel(normalizedLevel);
		this._sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Thinking level set to: ${normalizedLevel}`,
			},
		});
	}

	/**
	 * Process a user prompt and stream events as ACP notifications.
	 *
	 * Extracts text from ContentBlocks, sends to AgentSession, subscribes
	 * to events and translates them to session/update notifications.
	 * Also handles slash commands.
	 *
	 * @returns PromptResponse with stop reason
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		// Create abort controller for this prompt
		this._pendingPrompt = new AbortController();
		this._toolCallIds.clear();

		// Extract text content from ContentBlocks
		const textParts: string[] = [];
		const images: ImageContent[] = [];

		for (const block of params.prompt) {
			if (block.type === "text") {
				textParts.push(block.text);
			} else if (block.type === "image") {
				images.push({
					type: "image",
					mimeType: block.mimeType,
					data: block.data,
				});
			}
			// TODO: Handle resource and resource_link types if needed
		}

		const text = textParts.join("\n");

		// Check for slash commands (only for text-only prompts)
		if (images.length === 0 && text.startsWith("/")) {
			const result = await this._handleSlashCommand(text);
			if (result.handled) {
				this._pendingPrompt = null;
				return { stopReason: result.stopReason ?? "end_turn" };
			}
		}

		// Track whether we were cancelled
		let cancelled = false;

		// Subscribe to events and translate to ACP notifications
		const unsubscribe = this._agentSession.subscribe((event) => {
			// Check if cancelled
			if (this._pendingPrompt?.signal.aborted) {
				cancelled = true;
				return;
			}

			this._translateEvent(event);
		});

		try {
			// Send the prompt to AgentSession
			await this._agentSession.prompt(text, {
				images: images.length > 0 ? images : undefined,
				expandPromptTemplates: true,
				source: "rpc", // Use rpc source since we're in a headless mode
			});

			// Wait for agent to become idle
			await this._agentSession.agent.waitForIdle();

			return {
				stopReason: cancelled ? "cancelled" : "end_turn",
			};
		} catch (error) {
			// If aborted, return cancelled
			if (this._pendingPrompt?.signal.aborted) {
				return { stopReason: "cancelled" };
			}

			// Send error message to client
			const errorMessage = error instanceof Error ? error.message : String(error);
			acpDebug(`prompt error: ${errorMessage}`);
			this._sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `Error: ${errorMessage}`,
				},
			});

			return { stopReason: "end_turn" };
		} finally {
			unsubscribe();
			this._pendingPrompt = null;
		}
	}

	/**
	 * Cancel the current prompt.
	 *
	 * Aborts the pending prompt and triggers agent abort.
	 */
	cancel(): void {
		if (this._pendingPrompt) {
			this._pendingPrompt.abort();
			void this._agentSession.abort();
		}
	}

	/**
	 * Translate an AgentSessionEvent to ACP session/update notifications.
	 */
	private _translateEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_update": {
				const assistantEvent = event.assistantMessageEvent;

				// Handle text delta
				if (assistantEvent.type === "text_delta") {
					this._sendUpdate({
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: assistantEvent.delta,
						},
					});
				}

				// Handle thinking delta
				if (assistantEvent.type === "thinking_delta") {
					this._sendUpdate({
						sessionUpdate: "agent_thought_chunk",
						content: {
							type: "text",
							text: assistantEvent.delta,
						},
					});
				}
				break;
			}

			case "tool_execution_start": {
				// Generate a unique ACP tool call ID and map it
				const acpToolCallId = crypto.randomUUID();
				this._toolCallIds.set(event.toolCallId, acpToolCallId);

				acpDebug(`tool_execution_start: ${event.toolName} (${acpToolCallId})`);
				this._sendUpdate({
					sessionUpdate: "tool_call",
					toolCallId: acpToolCallId,
					title: this._formatToolTitle(event.toolName, event.args),
					status: "in_progress",
					kind: this._mapToolKind(event.toolName),
					rawInput: event.args,
				});
				break;
			}

			case "tool_execution_update": {
				// Stream partial results for long-running tools
				const updateToolCallId = this._toolCallIds.get(event.toolCallId);
				if (!updateToolCallId) break;

				this._sendUpdate({
					sessionUpdate: "tool_call_update",
					toolCallId: updateToolCallId,
					rawOutput: event.partialResult,
				});
				break;
			}

			case "tool_execution_end": {
				const acpToolCallId = this._toolCallIds.get(event.toolCallId);
				if (!acpToolCallId) break;

				acpDebug(`tool_execution_end: ${event.toolName} (${acpToolCallId}) isError=${event.isError}`);
				// Use the isError field from the event
				this._sendUpdate({
					sessionUpdate: "tool_call_update",
					toolCallId: acpToolCallId,
					status: event.isError ? "failed" : "completed",
					rawOutput: event.result,
					content: this._formatToolResultContent(event.result),
				});
				break;
			}

			// Ignore other event types for now
			default:
				break;
		}
	}

	/**
	 * Send a session/update notification to the client.
	 */
	private _sendUpdate(update: acp.SessionUpdate): void {
		void this._connection.sessionUpdate({
			sessionId: this.id,
			update,
		});
	}

	/**
	 * Format a descriptive title for tool calls.
	 */
	private _formatToolTitle(toolName: string, args: Record<string, unknown>): string {
		switch (toolName) {
			case "bash": {
				const command = args.command as string | undefined;
				if (command) {
					// Truncate long commands
					const truncated = command.length > 80 ? `${command.slice(0, 77)}...` : command;
					return `Run \`${truncated}\``;
				}
				return "bash";
			}
			case "read": {
				const path = args.path as string | undefined;
				return path ? `Read ${path}` : "read";
			}
			case "write": {
				const path = args.path as string | undefined;
				return path ? `Write ${path}` : "write";
			}
			case "edit": {
				const path = args.path as string | undefined;
				return path ? `Edit ${path}` : "edit";
			}
			case "glob": {
				const pattern = args.pattern as string | undefined;
				return pattern ? `Glob ${pattern}` : "glob";
			}
			case "grep": {
				const pattern = args.pattern as string | undefined;
				return pattern ? `Grep "${pattern}"` : "grep";
			}
			default:
				return toolName;
		}
	}

	/**
	 * Map pi tool names to ACP ToolKind.
	 */
	private _mapToolKind(toolName: string): acp.ToolKind {
		switch (toolName) {
			case "read":
				return "read";
			case "write":
			case "edit":
				return "edit";
			case "bash":
				return "execute";
			case "grep":
			case "glob":
				return "search";
			default:
				return "other";
		}
	}

	/**
	 * Format tool result as ACP ToolCallContent.
	 */
	private _formatToolResultContent(result: unknown): acp.ToolCallContent[] | undefined {
		if (result === undefined || result === null) {
			return undefined;
		}

		// Convert result to string representation
		let text: string;
		if (typeof result === "string") {
			text = result;
		} else if (typeof result === "object" && "content" in result) {
			// MCP-style result with content field
			const content = (result as { content: unknown }).content;
			if (Array.isArray(content)) {
				// Extract text from content array
				text = content
					.map((item) => {
						if (typeof item === "object" && item && "text" in item) {
							return (item as { text: string }).text;
						}
						return JSON.stringify(item);
					})
					.join("\n");
			} else {
				text = JSON.stringify(content);
			}
		} else {
			text = JSON.stringify(result, null, 2);
		}

		return [
			{
				type: "content",
				content: {
					type: "text",
					text,
				},
			},
		];
	}
}
