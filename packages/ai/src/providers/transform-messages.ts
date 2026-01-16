import type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../types.js";

/**
 * Normalize tool call ID for cross-provider compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 */
function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

export function transformMessages<TApi extends Api>(messages: Message[], model: Model<TApi>): Message[] {
	// Build a map of original tool call IDs to normalized IDs for github-copilot cross-API switches
	const toolCallIdMap = new Map<string, string>();

	// First pass: transform messages (thinking blocks, tool call ID normalization)
	const transformed = messages.map((msg) => {
		// User messages pass through unchanged
		if (msg.role === "user") {
			return msg;
		}

		// Handle toolResult messages - normalize toolCallId if we have a mapping
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return { ...msg, toolCallId: normalizedId };
			}
			return msg;
		}

		// Assistant messages need transformation check
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;

			// If message is from the same provider and API, keep as is
			if (assistantMsg.provider === model.provider && assistantMsg.api === model.api) {
				return msg;
			}

			// Check if we need to normalize tool call IDs
			// Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars)
			// OpenAI Responses API generates IDs with `|` and 450+ chars
			// GitHub Copilot routes to Anthropic for Claude models
			const targetRequiresStrictIds = model.api === "anthropic-messages" || model.provider === "github-copilot";
			const crossProviderSwitch = assistantMsg.provider !== model.provider;
			const copilotCrossApiSwitch =
				assistantMsg.provider === "github-copilot" &&
				model.provider === "github-copilot" &&
				assistantMsg.api !== model.api;
			const needsToolCallIdNormalization = targetRequiresStrictIds && (crossProviderSwitch || copilotCrossApiSwitch);

			// Transform message from different provider/model
			const transformedContent = assistantMsg.content.flatMap((block) => {
				if (block.type === "thinking") {
					// Skip empty thinking blocks, convert others to plain text
					if (!block.thinking || block.thinking.trim() === "") return [];
					return {
						type: "text" as const,
						text: block.thinking,
					};
				}
				// Normalize tool call IDs when target API requires strict format
				if (block.type === "toolCall" && needsToolCallIdNormalization) {
					const toolCall = block as ToolCall;
					const normalizedId = normalizeToolCallId(toolCall.id);
					if (normalizedId !== toolCall.id) {
						toolCallIdMap.set(toolCall.id, normalizedId);
						return { ...toolCall, id: normalizedId };
					}
				}
				// All other blocks pass through unchanged
				return block;
			});

			// Return transformed assistant message
			return {
				...assistantMsg,
				content: transformedContent,
			};
		}
		return msg;
	});

	// Second pass: insert synthetic empty tool results for orphaned tool calls
	// This preserves thinking signatures and satisfies API requirements
	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();

	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];

		if (msg.role === "assistant") {
			// If we have pending orphaned tool calls from a previous assistant, insert synthetic results now
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}

			// Track tool calls from this assistant message
			const assistantMsg = msg as AssistantMessage;
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}

			// Skip empty assistant messages (no content and no tool calls)
			// This handles error responses (e.g., 429/500) that produced no content
			// All providers already filter these in convertMessages, but we do it here
			// centrally to prevent issues with the tool_use -> tool_result chain
			if (assistantMsg.content.length === 0 && toolCalls.length === 0) {
				continue;
			}

			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "user") {
			// User message interrupts tool flow - insert synthetic results for orphaned calls
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else {
			result.push(msg);
		}
	}

	return result;
}
