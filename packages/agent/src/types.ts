import type { AgentTool, AssistantMessage, Message, Model, UserMessage } from "@mariozechner/pi-ai";

/**
 * Attachment type definition.
 * Processing is done by consumers (e.g., document extraction in web-ui).
 */
export interface Attachment {
	id: string;
	type: "image" | "document";
	fileName: string;
	mimeType: string;
	size: number;
	content: string; // base64 encoded (without data URL prefix)
	extractedText?: string; // For documents
	preview?: string; // base64 image preview
}

/**
 * Thinking/reasoning level for models that support it.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

/**
 * User message with optional attachments.
 */
export type UserMessageWithAttachments = UserMessage & { attachments?: Attachment[] };

/**
 * Extensible interface for custom app messages.
 * Apps can extend via declaration merging:
 *
 * @example
 * ```typescript
 * declare module "@mariozechner/agent" {
 *   interface CustomMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
export interface CustomMessages {
	// Empty by default - apps extend via declaration merging
}

/**
 * AppMessage: Union of LLM messages + attachments + custom messages.
 * This abstraction allows apps to add custom message types while maintaining
 * type safety and compatibility with the base LLM messages.
 */
export type AppMessage =
	| AssistantMessage
	| UserMessageWithAttachments
	| Message // Includes ToolResultMessage
	| CustomMessages[keyof CustomMessages];

/**
 * Agent state containing all configuration and conversation data.
 */
export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool<any>[];
	messages: AppMessage[]; // Can include attachments + custom message types
	isStreaming: boolean;
	streamMessage: Message | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

/**
 * Events emitted by the Agent for UI updates.
 */
export type AgentEvent = { type: "state-update"; state: AgentState } | { type: "started" } | { type: "completed" };
