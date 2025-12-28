import { Alert } from "@mariozechner/mini-lit/dist/Alert.js";
import type { ImageContent, Message, TextContent } from "@mariozechner/pi-ai";
import type { AgentMessage, Attachment, MessageRenderer, UserMessageWithAttachments } from "@mariozechner/pi-web-ui";
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

// ============================================================================
// 1. EXTEND AppMessage TYPE VIA DECLARATION MERGING
// ============================================================================

// Define custom message types
export interface SystemNotificationMessage {
	role: "system-notification";
	message: string;
	variant: "default" | "destructive";
	timestamp: string;
}

// Extend CustomAgentMessages interface via declaration merging
// This must target pi-agent-core where CustomAgentMessages is defined
declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		"system-notification": SystemNotificationMessage;
	}
}

// ============================================================================
// 2. CREATE CUSTOM RENDERER (TYPED TO SystemNotificationMessage)
// ============================================================================

const systemNotificationRenderer: MessageRenderer<SystemNotificationMessage> = {
	render: (notification) => {
		// notification is fully typed as SystemNotificationMessage!
		return html`
			<div class="px-4">
				${Alert({
					variant: notification.variant,
					children: html`
						<div class="flex flex-col gap-1">
							<div>${notification.message}</div>
							<div class="text-xs opacity-70">${new Date(notification.timestamp).toLocaleTimeString()}</div>
						</div>
					`,
				})}
			</div>
		`;
	},
};

// ============================================================================
// 3. REGISTER RENDERER
// ============================================================================

export function registerCustomMessageRenderers() {
	registerMessageRenderer("system-notification", systemNotificationRenderer);
}

// ============================================================================
// 4. HELPER TO CREATE CUSTOM MESSAGES
// ============================================================================

export function createSystemNotification(
	message: string,
	variant: "default" | "destructive" = "default",
): SystemNotificationMessage {
	return {
		role: "system-notification",
		message,
		variant,
		timestamp: new Date().toISOString(),
	};
}

// ============================================================================
// 5. CUSTOM MESSAGE TRANSFORMER
// ============================================================================

// Convert attachments to content blocks
function convertAttachments(attachments: Attachment[]): (TextContent | ImageContent)[] {
	const content: (TextContent | ImageContent)[] = [];
	for (const attachment of attachments) {
		if (attachment.type === "image") {
			content.push({
				type: "image",
				data: attachment.content,
				mimeType: attachment.mimeType,
			} as ImageContent);
		} else if (attachment.type === "document" && attachment.extractedText) {
			content.push({
				type: "text",
				text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}`,
			} as TextContent);
		}
	}
	return content;
}

// Transform custom messages to LLM-compatible messages
export function customMessageTransformer(messages: AgentMessage[]): Message[] {
	return messages
		.filter((m) => {
			// Filter out artifact messages - they're for session reconstruction only
			if (m.role === "artifact") {
				return false;
			}

			// Keep LLM-compatible messages + custom messages
			return (
				m.role === "user" ||
				m.role === "user-with-attachments" ||
				m.role === "assistant" ||
				m.role === "toolResult" ||
				m.role === "system-notification"
			);
		})
		.map((m) => {
			// Transform system notifications to user messages
			if (m.role === "system-notification") {
				const notification = m as SystemNotificationMessage;
				return {
					role: "user",
					content: `<system>${notification.message}</system>`,
					timestamp: Date.now(),
				} as Message;
			}

			// Convert user-with-attachments to user message with content blocks
			if (m.role === "user-with-attachments") {
				const msg = m as UserMessageWithAttachments;
				const textContent: (TextContent | ImageContent)[] =
					typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [...msg.content];

				if (msg.attachments) {
					textContent.push(...convertAttachments(msg.attachments));
				}

				return {
					role: "user",
					content: textContent,
					timestamp: msg.timestamp,
				} as Message;
			}

			return m as Message;
		});
}
