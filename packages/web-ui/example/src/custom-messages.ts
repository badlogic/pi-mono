import { Alert } from "@mariozechner/mini-lit/dist/Alert.js";
import type { Message } from "@mariozechner/pi-ai";
import type { AppMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
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

// Extend CustomMessages interface via declaration merging
declare module "@mariozechner/pi-web-ui" {
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

// Transform custom messages to user messages with <system> tags so LLM can see them
export function customMessageTransformer(messages: AppMessage[]): Message[] {
	return messages
		.filter((m) => {
			// Filter out artifact messages - they're for session reconstruction only
			if (m.role === "artifact") {
				return false;
			}

			// Keep LLM-compatible messages + custom messages
			return (
				m.role === "user" || m.role === "assistant" || m.role === "toolResult" || m.role === "system-notification"
			);
		})
		.map((m) => {
			// Transform system notifications to user messages
			if (m.role === "system-notification") {
				const notification = m as SystemNotificationMessage;
				return {
					role: "user",
					content: `<system>${notification.message}</system>`,
				} as Message;
			}

			// Strip attachments from user messages
			if (m.role === "user-with-attachment") {
				const { attachments: _, ...rest } = m;
				return rest as Message;
			}

			return m as Message;
		});
}
