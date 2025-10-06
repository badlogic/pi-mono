import type { TemplateResult } from "lit";
import type { AppMessage } from "./Messages.js";

// Extract role type from AppMessage union
export type MessageRole = AppMessage["role"];

// Generic message renderer typed to specific message type
export interface MessageRenderer<TMessage extends AppMessage = AppMessage> {
	render(message: TMessage): TemplateResult;
}

// Registry of custom message renderers by role
const messageRenderers = new Map<MessageRole, MessageRenderer<any>>();

export function registerMessageRenderer<TRole extends MessageRole>(
	role: TRole,
	renderer: MessageRenderer<Extract<AppMessage, { role: TRole }>>,
): void {
	messageRenderers.set(role, renderer);
}

export function getMessageRenderer(role: MessageRole): MessageRenderer | undefined {
	return messageRenderers.get(role);
}

export function renderMessage(message: AppMessage): TemplateResult | undefined {
	return messageRenderers.get(message.role)?.render(message);
}
