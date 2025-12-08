/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AppMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */

import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

// ============================================================================
// Custom Message Types
// ============================================================================

/**
 * Message type for bash executions via the ! command.
 */
export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | null;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
}

// Extend CustomMessages via declaration merging
declare module "@mariozechner/pi-agent-core" {
	interface CustomMessages {
		bashExecution: BashExecutionMessage;
	}
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for BashExecutionMessage.
 */
export function isBashExecutionMessage(msg: AppMessage | Message): msg is BashExecutionMessage {
	return (msg as BashExecutionMessage).role === "bashExecution";
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
	let text = `Ran \`${msg.command}\`\n`;
	if (msg.output) {
		text += "```\n" + msg.output + "\n```";
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(command cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== 0) {
		text += `\n\nCommand exited with code ${msg.exitCode}`;
	}
	if (msg.truncated && msg.fullOutputPath) {
		text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
	}
	return text;
}

// ============================================================================
// Message Transformer
// ============================================================================

/**
 * Transform AppMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's messageTransformer option (for prompt calls)
 * - Compaction's generateSummary (for summarization)
 */
export function messageTransformer(messages: AppMessage[]): Message[] {
	return messages
		.map((m): Message | null => {
			if (isBashExecutionMessage(m)) {
				// Convert bash execution to user message
				return {
					role: "user",
					content: [{ type: "text", text: bashExecutionToText(m) }],
					timestamp: m.timestamp,
				};
			}
			// Pass through standard LLM roles
			if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
				return m as Message;
			}
			// Filter out unknown message types
			return null;
		})
		.filter((m): m is Message => m !== null);
}
