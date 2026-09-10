import type { Api, Context, Message, Model, SystemMessage } from "../types.ts";

export function getSystemMessageText(message: SystemMessage): string {
	return typeof message.content === "string" ? message.content : message.content.map((block) => block.text).join("\n");
}

/**
 * Render a system message as user text for transports without mid-conversation
 * system messages. The tag tells the model the text is operator context rather
 * than end-user input. Appending it keeps the cached prefix intact.
 */
export function renderSystemMessageAsUserText(message: SystemMessage): string {
	const text = getSystemMessageText(message);
	return text.length > 0 ? `<system_update>\n${text}\n</system_update>` : "";
}

/** Extract only leading instruction text. Keep tool changes at their original message position. */
export function extractInitialSystemPrompt(context: Context): Context {
	const first = context.messages[0];
	if (first?.role !== "system") return context;
	const text = getSystemMessageText(first);
	if (!text) return context;
	return {
		...context,
		systemPrompt: [context.systemPrompt, text].filter((part) => part !== undefined && part !== "").join("\n\n"),
		messages: [{ ...first, content: "" }, ...context.messages.slice(1)],
	};
}

export interface TranscriptCapabilities {
	midConversationSystemMessages: boolean;
	midConversationToolAdditions: boolean;
	midConversationToolRemovals: boolean;
}

/** Native transcript support, not lossy user-text or top-level-tool fallbacks. */
export function getTranscriptCapabilities(model: Model<Api>): TranscriptCapabilities {
	const compat = model.compat;
	const toolChanges = supportsMidConversationToolChanges(model);
	const kimi =
		model.api === "openai-completions" &&
		compat !== undefined &&
		"deferredToolsMode" in compat &&
		compat.deferredToolsMode === "kimi";
	const systemMessages =
		toolChanges ||
		RESPONSES_APIS.has(model.api) ||
		(model.api === "anthropic-messages" &&
			compat !== undefined &&
			"supportsMidConvoSystemMessages" in compat &&
			compat.supportsMidConvoSystemMessages === true) ||
		(model.api === "openai-completions" && (model.provider === "openai" || kimi)) ||
		model.api === "mistral-conversations";
	return {
		midConversationSystemMessages: systemMessages,
		midConversationToolAdditions:
			toolChanges ||
			kimi ||
			(RESPONSES_APIS.has(model.api) &&
				compat !== undefined &&
				"supportsToolSearch" in compat &&
				compat.supportsToolSearch === true),
		midConversationToolRemovals: toolChanges,
	};
}

/** Responses transports, where `supportsAdditionalTools` provides transcript-anchored tool loads. */
const RESPONSES_APIS: ReadonlySet<string> = new Set<Api>([
	"openai-responses",
	"azure-openai-responses",
	"openai-codex-responses",
]);

/**
 * Whether the model supports transcript-anchored tool additions and removals: either both
 * Anthropic mid-conversation flags (any transport, so custom providers can opt in) or
 * `supportsAdditionalTools` on a Responses transport.
 *
 * Harness prompt updates use the same capability: a standalone system message is otherwise
 * not enough to keep prompt and tool state coherent. Tool-search-only models can load a tool,
 * but cannot apply a complete tool-state transition, so they remain baseline replacements.
 */
export function supportsMidConversationToolChanges(model: Model<Api>): boolean {
	const compat = model.compat as
		| {
				supportsAdditionalTools?: boolean;
				supportsMidConvoSystemMessages?: boolean;
				supportsMidConvoToolChanges?: boolean;
		  }
		| undefined;
	if (compat?.supportsMidConvoSystemMessages && compat.supportsMidConvoToolChanges) return true;
	return RESPONSES_APIS.has(model.api) && compat?.supportsAdditionalTools === true;
}

/** Names of tools that become available at this message, from either a system update or a tool-result marker. */
export function addedToolNames(message: Message): string[] {
	if (message.role === "system") return (message.toolsAdded ?? []).map((tool) => tool.name);
	if (message.role === "toolResult") return [...new Set(message.addedToolNames ?? [])];
	return [];
}
