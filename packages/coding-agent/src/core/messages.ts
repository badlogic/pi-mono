/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@mariozechner/pi-ai";

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

/**
 * Message type for hook-injected messages via sendMessage().
 * These are custom messages that hooks can inject into the conversation.
 */
export interface HookMessage<T = unknown> {
	role: "hookMessage";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

// Extend CustomAgentMessages via declaration merging
declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		bashExecution: BashExecutionMessage;
		hookMessage: HookMessage;
	}
}

/**
 * Type guard for BashExecutionMessage.
 */
export function isBashExecutionMessage(msg: AgentMessage | Message): msg is BashExecutionMessage {
	return msg.role === "bashExecution";
}

/**
 * Type guard for HookMessage.
 */
export function isHookMessage(msg: AgentMessage | Message): msg is HookMessage {
	return msg.role === "hookMessage";
}

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
	let text = `Ran \`${msg.command}\`\n`;
	if (msg.output) {
		text += `\`\`\`\n${msg.output}\n\`\`\``;
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

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom hooks and tools
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
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
			if (isHookMessage(m)) {
				// Convert hook message to user message for LLM
				// Normalize string content to array format
				const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
				return {
					role: "user",
					content,
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
		.filter((m) => m !== null);
}
