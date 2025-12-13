/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AppMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 */

import type { AppMessage, Attachment, UserMessageWithAttachments } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message, TextContent, UserMessage } from "@mariozechner/pi-ai";

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
 *
 * Handles:
 * - BashExecutionMessage → user message with text
 * - User messages with attachments → content blocks with images/documents
 * - Standard LLM roles → pass through
 */
export function messageTransformer(messages: AppMessage[]): Message[] {
	const toDocumentText = (a: Attachment): string => `\n\n[Document: ${a.fileName}]\n${a.extractedText ?? ""}`;
	const hasBinaryBlock = (content: Array<TextContent | ImageContent>, a: Attachment): boolean =>
		content.some((c) => c.type === "image" && c.mimeType === a.mimeType && c.data === a.content);
	const hasDocumentTextBlock = (content: Array<TextContent | ImageContent>, a: Attachment): boolean => {
		if (!a.extractedText) return false;
		const marker = toDocumentText(a);
		return content.some((c) => c.type === "text" && c.text.includes(marker));
	};

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
			// Handle user messages with attachments
			if (m.role === "user") {
				const user = m as UserMessageWithAttachments;
				const attachments = user.attachments;

				if (!attachments || attachments.length === 0) {
					return { role: "user", content: user.content, timestamp: user.timestamp } satisfies UserMessage;
				}

				const content: Array<TextContent | ImageContent> =
					typeof user.content === "string" ? [{ type: "text", text: user.content }] : [...user.content];

				for (const attachment of attachments) {
					if (attachment.type === "image" || (attachment.type === "document" && !attachment.extractedText)) {
						if (!hasBinaryBlock(content, attachment)) {
							content.push({
								type: "image",
								data: attachment.content,
								mimeType: attachment.mimeType,
								fileName: attachment.fileName,
							});
						}
					} else if (attachment.type === "document" && attachment.extractedText) {
						if (!hasDocumentTextBlock(content, attachment)) {
							content.push({ type: "text", text: toDocumentText(attachment) });
						}
					}
				}

				return { role: "user", content, timestamp: user.timestamp } satisfies UserMessage;
			}
			// Pass through other standard LLM roles
			if (m.role === "assistant" || m.role === "toolResult") {
				return m as Message;
			}
			// Filter out unknown message types
			return null;
		})
		.filter((m): m is Message => m !== null);
}
