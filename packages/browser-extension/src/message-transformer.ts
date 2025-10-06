import type { Message } from "@mariozechner/pi-ai";
import type { AppMessage } from "@mariozechner/pi-web-ui";
import type { NavigationMessage } from "./messages/NavigationMessage.js";

// Custom message transformer for browser extension
// Handles navigation messages and app-specific message types
export function browserMessageTransformer(messages: AppMessage[]): Message[] {
	return messages
		.filter((m) => {
			// Keep LLM-compatible messages + navigation messages
			return m.role === "user" || m.role === "assistant" || m.role === "toolResult" || m.role === "navigation";
		})
		.map((m) => {
			// Transform navigation messages to user messages with <system> tags
			if (m.role === "navigation") {
				const nav = m as NavigationMessage;
				const tabInfo = nav.tabIndex !== undefined ? ` (tab ${nav.tabIndex})` : "";
				return {
					role: "user",
					content: `<system>Navigated to ${nav.title}${tabInfo}: ${nav.url}</system>`,
				} as Message;
			}

			// Strip attachments from user messages
			if (m.role === "user") {
				const { attachments, ...rest } = m as any;
				return rest as Message;
			}

			return m as Message;
		});
}
