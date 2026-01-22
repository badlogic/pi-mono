/**
 * AcpSession: Wraps AgentSession with ACP event translation.
 *
 * Handles the translation between pi's AgentSession events and
 * ACP session/update notifications, including slash commands support.
 */

import * as crypto from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { buildAvailableCommands, handleSlashCommand } from "./acp-commands.js";
import { acpDebug } from "./acp-mode.js";
import { formatToolResultContent, formatToolTitle, mapToolKind } from "./acp-tools.js";

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
		const commands = buildAvailableCommands(this._agentSession);
		acpDebug(`sendAvailableCommands: ${commands.length} commands`);
		this._sendUpdate({
			sessionUpdate: "available_commands_update",
			availableCommands: commands,
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
			const result = await handleSlashCommand(text, {
				agentSession: this._agentSession,
				sendUpdate: (update) => this._sendUpdate(update),
			});
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
					title: formatToolTitle(event.toolName, event.args),
					status: "in_progress",
					kind: mapToolKind(event.toolName),
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
					content: formatToolResultContent(event.result),
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
}
