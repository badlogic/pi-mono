import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { buildBaseOptions } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";

const KIRO_BASE_URL = "https://q.{{region}}.amazonaws.com/generateAssistantResponse";
const KIRO_USER_AGENT = "KiroIDE";
const HISTORY_LIMIT = 850000;
const TOOL_RESULT_LIMIT = 250000;

// Kiro API type definitions
interface KiroImage {
	format: string;
	source: {
		bytes: string;
	};
}

interface KiroToolUse {
	name: string;
	toolUseId: string;
	input: Record<string, unknown>;
}

interface KiroToolResult {
	content: Array<{ text: string }>;
	status: "success" | "error";
	toolUseId: string;
}

interface KiroToolSpec {
	toolSpecification: {
		name: string;
		description: string;
		inputSchema: {
			json: Record<string, unknown>;
		};
	};
}

interface KiroUserInputMessageContext {
	toolResults?: KiroToolResult[];
	tools?: KiroToolSpec[];
}

interface KiroUserInputMessage {
	content: string;
	modelId: string;
	origin: "AI_EDITOR";
	images?: KiroImage[];
	userInputMessageContext?: KiroUserInputMessageContext;
}

interface KiroAssistantResponseMessage {
	content: string;
	toolUses?: KiroToolUse[];
}

interface KiroHistoryEntry {
	userInputMessage?: KiroUserInputMessage;
	assistantResponseMessage?: KiroAssistantResponseMessage;
}

interface KiroConversationState {
	chatTriggerType: "MANUAL";
	conversationId: string;
	currentMessage: {
		userInputMessage: KiroUserInputMessage;
	};
	history?: KiroHistoryEntry[];
}

interface KiroRequest {
	conversationState: KiroConversationState;
}

interface KiroContentEvent {
	type: "content";
	data: string;
}

interface KiroToolUseEvent {
	type: "toolUse";
	data: {
		name: string;
		toolUseId: string;
		input: string;
		stop?: boolean;
	};
}

interface KiroToolUseInputEvent {
	type: "toolUseInput";
	data: {
		input: string;
	};
}

interface KiroToolUseStopEvent {
	type: "toolUseStop";
	data: {
		stop: boolean;
	};
}

interface KiroContextUsageEvent {
	type: "contextUsage";
	data: {
		contextUsagePercentage: number;
	};
}

type KiroStreamEvent =
	| KiroContentEvent
	| KiroToolUseEvent
	| KiroToolUseInputEvent
	| KiroToolUseStopEvent
	| KiroContextUsageEvent;

interface KiroToolCall {
	toolUseId: string;
	name: string;
	input: string;
}

// Model ID mapping to Kiro internal model IDs
const MODEL_MAPPING: Record<string, string> = {
	"claude-haiku-4-5": "CLAUDE_HAIKU_4_5_20251001_V1_0",
	"claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
	"claude-sonnet-4-5-1m": "CLAUDE_SONNET_4_5_20250929_LONG_V1_0",
	"claude-opus-4-5": "CLAUDE_OPUS_4_5_20251101_V1_0",
	"claude-opus-4-6": "CLAUDE_OPUS_4_6_20251201_V1_0",
};

export interface KiroOptions extends StreamOptions {
	region?: "us-east-1" | "us-west-2";
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
}

interface KiroCredentials {
	refresh: string;
	access: string;
	expires: number;
	clientId: string;
	clientSecret: string;
	region: string;
	[key: string]: unknown;
}

let credentials: KiroCredentials | null = null;

export function setKiroCredentials(creds: KiroCredentials): void {
	credentials = creds;
}

export function getKiroCredentials(): KiroCredentials | null {
	return credentials;
}

const THINKING_START_TAG = "<thinking>";
const THINKING_END_TAG = "</thinking>";

/**
 * Parses streaming text content and extracts <thinking>...</thinking> blocks.
 * Emits separate events for text and thinking content.
 */
class ThinkingTagParser {
	private textBuffer = "";
	private inThinking = false;
	private thinkingExtracted = false;
	private thinkingBlockIndex: number | null = null;
	private textBlockIndex: number | null = null;

	constructor(
		private output: AssistantMessage,
		private stream: AssistantMessageEventStream,
	) {}

	/**
	 * Process a chunk of text content.
	 * Emits text_start, text_delta, thinking_start, thinking_delta, thinking_end events.
	 */
	processChunk(chunk: string): void {
		this.textBuffer += chunk;

		while (this.textBuffer.length > 0) {
			const prevLength = this.textBuffer.length;

			if (!this.inThinking && !this.thinkingExtracted) {
				this.processBeforeThinking();
				if (this.textBuffer.length === 0) break;
			}

			if (this.inThinking) {
				this.processInsideThinking();
				if (this.textBuffer.length === 0) break;
			}

			if (this.thinkingExtracted) {
				this.processAfterThinking();
				break;
			}

			// No progress — buffer too short to determine tag boundary, wait for more data
			if (this.textBuffer.length >= prevLength) break;
		}
	}

	/**
	 * Finalize any remaining buffered content.
	 * Call this when the stream ends.
	 */
	finalize(): void {
		if (this.textBuffer.length === 0) return;

		if (this.inThinking && this.thinkingBlockIndex !== null) {
			// Unclosed thinking tag - emit remaining as thinking
			const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
			block.thinking += this.textBuffer;
			this.stream.push({
				type: "thinking_delta",
				contentIndex: this.thinkingBlockIndex,
				delta: this.textBuffer,
				partial: this.output,
			});
			this.stream.push({
				type: "thinking_end",
				contentIndex: this.thinkingBlockIndex,
				content: block.thinking,
				partial: this.output,
			});
		} else if (this.textBlockIndex !== null) {
			// Remaining text
			const block = this.output.content[this.textBlockIndex] as TextContent;
			block.text += this.textBuffer;
			this.stream.push({
				type: "text_delta",
				contentIndex: this.textBlockIndex,
				delta: this.textBuffer,
				partial: this.output,
			});
		}

		this.textBuffer = "";
	}

	getTextBlockIndex(): number | null {
		return this.textBlockIndex;
	}

	private processBeforeThinking(): void {
		const startPos = this.textBuffer.indexOf(THINKING_START_TAG);
		if (startPos !== -1) {
			// Found thinking start tag
			const before = this.textBuffer.slice(0, startPos);
			if (before) {
				this.emitText(before);
			}
			this.textBuffer = this.textBuffer.slice(startPos + THINKING_START_TAG.length);
			this.inThinking = true;
			return;
		}

		// No thinking tag found - emit safe portion (keep buffer for potential tag)
		const safeLen = Math.max(0, this.textBuffer.length - THINKING_START_TAG.length);
		if (safeLen > 0) {
			const safeText = this.textBuffer.slice(0, safeLen);
			this.emitText(safeText);
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processInsideThinking(): void {
		const endPos = this.textBuffer.indexOf(THINKING_END_TAG);
		if (endPos !== -1) {
			// Found thinking end tag
			const thinkingPart = this.textBuffer.slice(0, endPos);
			if (thinkingPart) {
				this.emitThinking(thinkingPart);
			}

			// End thinking block
			if (this.thinkingBlockIndex !== null) {
				const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
				this.stream.push({
					type: "thinking_end",
					contentIndex: this.thinkingBlockIndex,
					content: block.thinking,
					partial: this.output,
				});
			}

			this.textBuffer = this.textBuffer.slice(endPos + THINKING_END_TAG.length);
			this.inThinking = false;
			this.thinkingExtracted = true;

			// Skip leading newlines after thinking
			if (this.textBuffer.startsWith("\n\n")) {
				this.textBuffer = this.textBuffer.slice(2);
			}
			return;
		}

		// No end tag found - emit safe portion (keep buffer for potential tag)
		const safeLen = Math.max(0, this.textBuffer.length - THINKING_END_TAG.length);
		if (safeLen > 0) {
			const safeThinking = this.textBuffer.slice(0, safeLen);
			this.emitThinking(safeThinking);
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processAfterThinking(): void {
		// After thinking extracted, all remaining content is text
		this.emitText(this.textBuffer);
		this.textBuffer = "";
	}

	private emitText(text: string): void {
		if (this.textBlockIndex === null) {
			this.textBlockIndex = this.output.content.length;
			this.output.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
		}
		const block = this.output.content[this.textBlockIndex] as TextContent;
		block.text += text;
		this.stream.push({
			type: "text_delta",
			contentIndex: this.textBlockIndex,
			delta: text,
			partial: this.output,
		});
	}

	private emitThinking(thinking: string): void {
		if (this.thinkingBlockIndex === null) {
			this.thinkingBlockIndex = this.output.content.length;
			this.output.content.push({ type: "thinking", thinking: "" });
			this.stream.push({
				type: "thinking_start",
				contentIndex: this.thinkingBlockIndex,
				partial: this.output,
			});
		}
		const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
		block.thinking += thinking;
		this.stream.push({
			type: "thinking_delta",
			contentIndex: this.thinkingBlockIndex,
			delta: thinking,
			partial: this.output,
		});
	}
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.substring(0, half)}\n... [TRUNCATED] ...\n${text.substring(text.length - half)}`;
}

function extractImages(msg: Message): ImageContent[] {
	if (msg.role === "toolResult" || typeof msg.content === "string") return [];
	if (!Array.isArray(msg.content)) return [];
	return msg.content.filter((c): c is ImageContent => c.type === "image");
}

function convertImagesToKiro(images: ImageContent[]): KiroImage[] {
	return images.map((img) => {
		const format = img.mimeType.split("/")[1] || "png";
		return {
			format,
			source: {
				bytes: img.data,
			},
		};
	});
}

function sanitizeHistory(history: KiroHistoryEntry[]): KiroHistoryEntry[] {
	const result: KiroHistoryEntry[] = [];
	for (let i = 0; i < history.length; i++) {
		const m = history[i];
		if (!m) continue;
		if (m.assistantResponseMessage?.toolUses) {
			const next = history[i + 1];
			if (next?.userInputMessage?.userInputMessageContext?.toolResults) {
				result.push(m);
			}
		} else if (m.userInputMessage?.userInputMessageContext?.toolResults) {
			const prev = result[result.length - 1];
			if (prev?.assistantResponseMessage?.toolUses) {
				result.push(m);
			}
		} else {
			result.push(m);
		}
	}

	if (result.length > 0) {
		const first = result[0];
		if (!first || !first.userInputMessage || first.userInputMessage.userInputMessageContext?.toolResults) {
			return [];
		}
	}

	return result;
}

function extractToolUseIdsFromHistory(history: KiroHistoryEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of history) {
		const toolUses = entry.assistantResponseMessage?.toolUses;
		if (toolUses) {
			for (const toolUse of toolUses) {
				if (toolUse.toolUseId) ids.add(toolUse.toolUseId);
			}
		}
	}
	return ids;
}

function injectSyntheticToolCalls(history: KiroHistoryEntry[]): KiroHistoryEntry[] {
	const validToolUseIds = extractToolUseIdsFromHistory(history);
	const result: KiroHistoryEntry[] = [];

	for (let i = 0; i < history.length; i++) {
		const entry = history[i];
		const toolResults = entry.userInputMessage?.userInputMessageContext?.toolResults;

		if (toolResults) {
			const orphanedResults = toolResults.filter((tr: KiroToolResult) => !validToolUseIds.has(tr.toolUseId));
			if (orphanedResults.length > 0) {
				const syntheticToolUses = orphanedResults.map((tr: KiroToolResult) => ({
					name: "unknown_tool",
					toolUseId: tr.toolUseId,
					input: {},
				}));
				result.push({
					assistantResponseMessage: {
						content: "Tool calls were made.",
						toolUses: syntheticToolUses,
					},
				});
				for (const tr of orphanedResults) {
					validToolUseIds.add(tr.toolUseId);
				}
			}
		}

		result.push(entry);
	}

	return result;
}

function truncateHistory(history: KiroHistoryEntry[], limit: number): KiroHistoryEntry[] {
	let sanitized = sanitizeHistory(history);
	let historySize = JSON.stringify(sanitized).length;
	while (historySize > limit && sanitized.length > 2) {
		sanitized.shift();
		while (sanitized.length > 0) {
			const first = sanitized[0];
			if (first?.userInputMessage) break;
			sanitized.shift();
		}
		sanitized = sanitizeHistory(sanitized);
		historySize = JSON.stringify(sanitized).length;
	}
	return injectSyntheticToolCalls(sanitized);
}

function resolveKiroModel(modelId: string): string {
	// Strip -thinking suffix for model resolution
	const baseModel = modelId.replace(/-thinking$/, "");
	return MODEL_MAPPING[baseModel] || MODEL_MAPPING["claude-sonnet-4-5"];
}

function buildKiroUrl(region: string): string {
	return KIRO_BASE_URL.replace("{{region}}", region);
}

function convertToolsToKiro(tools: Tool[]): KiroToolSpec[] {
	return tools.map((tool) => ({
		toolSpecification: {
			name: tool.name,
			description: tool.description,
			inputSchema: {
				json: tool.parameters,
			},
		},
	}));
}

function getContentText(msg: Message): string {
	if (msg.role === "toolResult") {
		return msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	}
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.map((c) => {
				if (c.type === "text") return c.text;
				if (c.type === "thinking") return c.thinking;
				return "";
			})
			.join("");
	}
	return "";
}

function buildHistory(
	messages: Message[],
	modelId: string,
	systemPrompt?: string,
	reductionFactor: number = 1.0,
): { history: KiroHistoryEntry[]; systemPrepended: boolean; currentMsgStartIdx: number } {
	const history: KiroHistoryEntry[] = [];
	let systemPrepended = false;
	const toolResultLimit = Math.floor(TOOL_RESULT_LIMIT * reductionFactor);

	// Find where "current" messages start - exclude trailing tool results AND their assistant
	let currentMsgStartIdx = messages.length - 1;
	// Walk back through all consecutive tool results
	while (currentMsgStartIdx > 0 && messages[currentMsgStartIdx].role === "toolResult") {
		currentMsgStartIdx--;
	}
	// If we landed on an assistant with tool calls, include it in "current" too
	if (currentMsgStartIdx >= 0 && messages[currentMsgStartIdx].role === "assistant") {
		const assistantMsg = messages[currentMsgStartIdx];
		if (Array.isArray(assistantMsg.content) && assistantMsg.content.some((b) => b.type === "toolCall")) {
			// This assistant made the tool calls - it's part of "current"
		} else {
			currentMsgStartIdx++; // Regular assistant, keep in history
		}
	}

	const historyMessages = messages.slice(0, currentMsgStartIdx);

	for (let i = 0; i < historyMessages.length; i++) {
		const msg = historyMessages[i];

		if (msg.role === "user") {
			let content = typeof msg.content === "string" ? msg.content : getContentText(msg);
			if (systemPrompt && !systemPrepended) {
				content = `${systemPrompt}\n\n${content}`;
				systemPrepended = true;
			}
			const images = extractImages(msg);
			const uim: KiroUserInputMessage = {
				content: sanitizeSurrogates(content),
				modelId,
				origin: "AI_EDITOR",
				...(images.length > 0 ? { images: convertImagesToKiro(images) } : {}),
			};
			// Ensure we don't have two consecutive userInputMessages
			const prev = history[history.length - 1];
			if (prev?.userInputMessage) {
				history.push({ assistantResponseMessage: { content: "Continue" } });
			}
			history.push({ userInputMessage: uim });
		} else if (msg.role === "assistant") {
			let armContent = "";
			const armToolUses: KiroToolUse[] = [];
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text") {
						armContent += block.text;
					} else if (block.type === "thinking") {
						armContent = `<thinking>${block.thinking}</thinking>\n\n${armContent}`;
					} else if (block.type === "toolCall") {
						armToolUses.push({
							name: block.name,
							toolUseId: block.id,
							input: typeof block.arguments === "string" ? JSON.parse(block.arguments) : block.arguments,
						});
					}
				}
			}
			// Skip empty assistant messages
			if (!armContent && armToolUses.length === 0) continue;
			const arm: KiroAssistantResponseMessage = {
				content: armContent,
				...(armToolUses.length > 0 ? { toolUses: armToolUses } : {}),
			};
			history.push({ assistantResponseMessage: arm });
		} else if (msg.role === "toolResult") {
			const toolResults: KiroToolResult[] = [
				{
					content: [{ text: truncate(getContentText(msg), toolResultLimit) }],
					status: msg.isError ? "error" : "success",
					toolUseId: msg.toolCallId,
				},
			];

			// Collect consecutive tool results
			let j = i + 1;
			while (j < historyMessages.length && historyMessages[j].role === "toolResult") {
				const nextMsg = historyMessages[j] as ToolResultMessage;
				toolResults.push({
					content: [{ text: truncate(getContentText(nextMsg), toolResultLimit) }],
					status: nextMsg.isError ? "error" : "success",
					toolUseId: nextMsg.toolCallId,
				});
				j++;
			}
			i = j - 1;

			const prev = history[history.length - 1];
			if (prev?.userInputMessage) {
				history.push({ assistantResponseMessage: { content: "Continue" } });
			}
			history.push({
				userInputMessage: {
					content: "Tool results provided.",
					modelId,
					origin: "AI_EDITOR",
					userInputMessageContext: { toolResults },
				},
			});
		}
	}

	return { history, systemPrepended, currentMsgStartIdx };
}

function extractToolNamesFromHistory(history: KiroHistoryEntry[]): Set<string> {
	const toolNames = new Set<string>();
	for (const entry of history) {
		const toolUses = entry.assistantResponseMessage?.toolUses;
		if (toolUses) {
			for (const toolUse of toolUses) {
				if (toolUse.name) toolNames.add(toolUse.name);
			}
		}
	}
	return toolNames;
}

function addPlaceholderTools(tools: KiroToolSpec[], history: KiroHistoryEntry[]): KiroToolSpec[] {
	const toolNamesInHistory = extractToolNamesFromHistory(history);
	if (toolNamesInHistory.size === 0) return tools;

	const existingToolNames = new Set(tools.map((t) => t.toolSpecification?.name).filter(Boolean));
	const missingToolNames = Array.from(toolNamesInHistory).filter((name) => !existingToolNames.has(name));

	if (missingToolNames.length === 0) return tools;

	const placeholderTools = missingToolNames.map((name) => ({
		toolSpecification: {
			name,
			description: "Tool",
			inputSchema: { json: { type: "object", properties: {} } },
		},
	}));

	return [...tools, ...placeholderTools];
}

function findJsonEnd(text: string, start: number): number {
	let braceCount = 0;
	let inString = false;
	let escapeNext = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];

		if (escapeNext) {
			escapeNext = false;
			continue;
		}

		if (char === "\\") {
			escapeNext = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		if (!inString) {
			if (char === "{") {
				braceCount++;
			} else if (char === "}") {
				braceCount--;
				if (braceCount === 0) {
					return i;
				}
			}
		}
	}

	return -1;
}

function parseKiroEvent(parsed: any): KiroStreamEvent | null {
	if (parsed.content !== undefined) {
		return { type: "content", data: parsed.content };
	}

	if (parsed.name && parsed.toolUseId) {
		const inputStr =
			typeof parsed.input === "string" ? parsed.input : parsed.input ? JSON.stringify(parsed.input) : "";
		return {
			type: "toolUse",
			data: { name: parsed.name, toolUseId: parsed.toolUseId, input: inputStr, stop: parsed.stop },
		};
	}

	if (parsed.input !== undefined && !parsed.name) {
		const inputStr = typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input);
		return { type: "toolUseInput", data: { input: inputStr } };
	}

	if (parsed.stop !== undefined && parsed.contextUsagePercentage === undefined) {
		return { type: "toolUseStop", data: { stop: parsed.stop } };
	}

	if (parsed.contextUsagePercentage !== undefined) {
		return { type: "contextUsage", data: { contextUsagePercentage: parsed.contextUsagePercentage } };
	}

	return null;
}

function parseKiroEvents(buffer: string): { events: KiroStreamEvent[]; remaining: string } {
	const events: KiroStreamEvent[] = [];
	let remaining = buffer;
	let searchStart = 0;

	const jsonStartPatterns = ['{"content":', '{"name":', '{"input":', '{"stop":', '{"contextUsagePercentage":'];

	while (true) {
		// Find next JSON object start
		const candidates = jsonStartPatterns
			.map((pattern) => remaining.indexOf(pattern, searchStart))
			.filter((pos) => pos >= 0);

		if (candidates.length === 0) break;

		const jsonStart = Math.min(...candidates);
		const jsonEnd = findJsonEnd(remaining, jsonStart);

		if (jsonEnd < 0) {
			// Incomplete JSON - keep in buffer
			remaining = remaining.substring(jsonStart);
			break;
		}

		// Parse complete JSON object
		try {
			const parsed = JSON.parse(remaining.substring(jsonStart, jsonEnd + 1));
			const event = parseKiroEvent(parsed);
			if (event) {
				events.push(event);
			}
		} catch {
			// Skip invalid JSON
		}

		searchStart = jsonEnd + 1;
		if (searchStart >= remaining.length) {
			remaining = "";
			break;
		}
	}

	if (searchStart > 0 && remaining.length > 0) {
		remaining = remaining.substring(searchStart);
	}

	return { events, remaining };
}

export const streamKiro: StreamFunction<"kiro", KiroOptions> = (
	model: Model<"kiro">,
	context: Context,
	options?: KiroOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			// Refresh token if expired
			if (credentials?.expires && Date.now() >= credentials.expires) {
				const { refreshKiroToken } = await import("../utils/oauth/kiro.js");
				credentials = await refreshKiroToken(credentials);
				setKiroCredentials(credentials);
			}

			const accessToken = options?.apiKey ?? getEnvApiKey("kiro") ?? credentials?.access;
			if (!accessToken) {
				throw new Error("Kiro credentials not set. Set KIRO_ACCESS_TOKEN or call setKiroCredentials().");
			}

			const region = options?.region ?? credentials?.region ?? "us-east-1";
			const endpoint = buildKiroUrl(region);
			const kiroModelId = resolveKiroModel(model.id);
			const thinkingEnabled = options?.thinkingEnabled ?? model.reasoning;
			const thinkingBudget = options?.thinkingBudgetTokens ?? 20000;

			// Build system prompt with thinking tags if enabled
			let systemPrompt = context.systemPrompt ?? "";
			if (thinkingEnabled) {
				const prefix = `<thinking_mode>enabled</thinking_mode><max_thinking_length>${thinkingBudget}</max_thinking_length>`;
				systemPrompt = systemPrompt ? `${prefix}\n${systemPrompt}` : prefix;
			}

			let retryCount = 0;
			const maxRetries = 3;
			let reductionFactor = 1.0;

			while (retryCount <= maxRetries) {
				// Normalize messages first (handles orphaned tool calls, thinking blocks, etc.)
				const normalizedMessages = transformMessages(context.messages, model);

				const {
					history: rawHistory,
					systemPrepended,
					currentMsgStartIdx,
				} = buildHistory(normalizedMessages, kiroModelId, systemPrompt, reductionFactor);

				// Apply history truncation
				const historyLimit = Math.floor(HISTORY_LIMIT * reductionFactor);
				const history = truncateHistory(rawHistory, historyLimit);
				const toolResultLimit = Math.floor(TOOL_RESULT_LIMIT * reductionFactor);

				// Current messages are from currentMsgStartIdx to end
				const currentMessages = normalizedMessages.slice(currentMsgStartIdx);
				const firstCurrentMsg = currentMessages[0];

				// Build current message
				let currentContent = "";
				const currentToolResults: KiroToolResult[] = [];

				if (firstCurrentMsg?.role === "assistant") {
					// Assistant with tool calls -> push to history, collect tool results
					let armContent = "";
					const armToolUses: KiroToolUse[] = [];
					if (Array.isArray(firstCurrentMsg.content)) {
						for (const block of firstCurrentMsg.content) {
							if (block.type === "text") armContent += block.text;
							else if (block.type === "thinking") {
								armContent = `<thinking>${block.thinking}</thinking>\n\n${armContent}`;
							} else if (block.type === "toolCall") {
								armToolUses.push({
									name: block.name,
									toolUseId: block.id,
									input: typeof block.arguments === "string" ? JSON.parse(block.arguments) : block.arguments,
								});
							}
						}
					}
					if (armContent || armToolUses.length > 0) {
						// Ensure history ends with userInputMessage
						const prev = history[history.length - 1];
						if (prev && !prev.userInputMessage) {
							history.push({
								userInputMessage: { content: "Continue", modelId: kiroModelId, origin: "AI_EDITOR" },
							});
						}
						const arm: KiroAssistantResponseMessage = {
							content: armContent,
							...(armToolUses.length > 0 ? { toolUses: armToolUses } : {}),
						};
						history.push({ assistantResponseMessage: arm });
					}

					// Collect all tool results after the assistant
					for (let i = 1; i < currentMessages.length; i++) {
						const msg = currentMessages[i];
						if (msg.role === "toolResult") {
							const tr = msg as ToolResultMessage;
							currentToolResults.push({
								content: [{ text: truncate(getContentText(tr), toolResultLimit) }],
								status: tr.isError ? "error" : "success",
								toolUseId: tr.toolCallId,
							});
						}
					}
					currentContent = currentToolResults.length > 0 ? "Tool results provided." : "Continue";
				} else if (firstCurrentMsg?.role === "toolResult") {
					// Orphaned tool results (shouldn't happen with new logic, but handle it)
					for (const msg of currentMessages) {
						if (msg.role === "toolResult") {
							const tr = msg as ToolResultMessage;
							currentToolResults.push({
								content: [{ text: truncate(getContentText(tr), toolResultLimit) }],
								status: tr.isError ? "error" : "success",
								toolUseId: tr.toolCallId,
							});
						}
					}
					currentContent = "Tool results provided.";
				} else if (firstCurrentMsg?.role === "user") {
					currentContent =
						typeof firstCurrentMsg.content === "string"
							? firstCurrentMsg.content
							: getContentText(firstCurrentMsg);
					if (systemPrompt && !systemPrepended) {
						currentContent = `${systemPrompt}\n\n${currentContent}`;
					}
				}

				const conversationId = crypto.randomUUID();

				// Build userInputMessageContext if needed
				let userInputMessageContext: KiroUserInputMessageContext | undefined;
				if (currentToolResults.length > 0 || (context.tools && context.tools.length > 0)) {
					userInputMessageContext = {};
					if (currentToolResults.length > 0) {
						userInputMessageContext.toolResults = currentToolResults;
					}
					if (context.tools && context.tools.length > 0) {
						let kiroTools = convertToolsToKiro(context.tools);
						if (history.length > 0) {
							kiroTools = addPlaceholderTools(kiroTools, history);
						}
						userInputMessageContext.tools = kiroTools;
					}
				}

				// Add images to current message if present
				let currentImages: KiroImage[] | undefined;
				if (firstCurrentMsg?.role === "user") {
					const images = extractImages(firstCurrentMsg);
					if (images.length > 0) {
						currentImages = convertImagesToKiro(images);
					}
				}

				// Ensure history ends with assistantResponseMessage before userInputMessage with tool results
				if (history.length > 0) {
					const lastHistoryItem = history[history.length - 1];
					if (lastHistoryItem.userInputMessage) {
						history.push({ assistantResponseMessage: { content: "Continue" } });
					}
				}

				const currentUserInputMessage: KiroUserInputMessage = {
					content: sanitizeSurrogates(currentContent),
					modelId: kiroModelId,
					origin: "AI_EDITOR",
					...(currentImages ? { images: currentImages } : {}),
					...(userInputMessageContext ? { userInputMessageContext } : {}),
				};

				const request: KiroRequest = {
					conversationState: {
						chatTriggerType: "MANUAL",
						conversationId,
						currentMessage: {
							userInputMessage: currentUserInputMessage,
						},
						...(history.length > 0 ? { history } : {}),
					},
				};

				const machineId = crypto.randomUUID().replace(/-/g, "");
				const ua = `aws-sdk-js/1.0.0 ua/2.1 os/nodejs lang/js api/codewhispererruntime#1.0.0 m/E ${KIRO_USER_AGENT}-${machineId}`;

				options?.onPayload?.(request);

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						Authorization: `Bearer ${accessToken}`,
						"amz-sdk-invocation-id": crypto.randomUUID(),
						"amz-sdk-request": "attempt=1; max=1",
						"x-amzn-kiro-agent-mode": "vibe",
						"x-amz-user-agent": ua,
						"user-agent": ua,
						Connection: "close",
					},
					body: JSON.stringify(request),
					signal: options?.signal,
				});

				if (!response.ok) {
					const errorText = await response.text().catch(() => "");
					const isContentTooLong =
						errorText.includes("CONTENT_LENGTH_EXCEEDS_THRESHOLD") ||
						errorText.includes("Input is too long") ||
						errorText.includes("Improperly formed");
					const isRetryable = response.status === 413 || (response.status === 400 && isContentTooLong);
					if (isRetryable && retryCount < maxRetries) {
						retryCount++;
						reductionFactor *= 0.7;
						continue;
					}
					throw new Error(`Kiro API error: ${response.status} ${response.statusText} ${errorText}`);
				}

				stream.push({ type: "start", partial: output });

				const reader = response.body?.getReader();
				if (!reader) throw new Error("No response body");

				const decoder = new TextDecoder();
				let buffer = "";
				let totalContent = "";
				let contextUsagePercentage: number | null = null;

				// Initialize thinking parser if enabled
				const thinkingParser = thinkingEnabled ? new ThinkingTagParser(output, stream) : null;
				let textBlockIndex: number | null = null;

				// Tool call state
				const toolCalls: KiroToolCall[] = [];
				let currentToolCall: KiroToolCall | null = null;

				// Idle timeout: cancel reader if no data arrives for 30s after first chunk.
				// Handles HTTP/2 connections that stay open after the API finishes streaming.
				const IDLE_TIMEOUT_MS = 30_000;
				let idleTimer: ReturnType<typeof setTimeout> | null = null;
				const resetIdleTimer = () => {
					if (idleTimer) clearTimeout(idleTimer);
					idleTimer = setTimeout(() => reader.cancel(), IDLE_TIMEOUT_MS);
				};

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					resetIdleTimer();

					buffer += decoder.decode(value, { stream: true });
					const { events, remaining } = parseKiroEvents(buffer);
					buffer = remaining;

					let streamComplete = false;
					for (const event of events) {
						if (event.type === "contextUsage") {
							contextUsagePercentage = event.data.contextUsagePercentage;
							streamComplete = true;
						} else if (event.type === "content") {
							totalContent += event.data;

							if (thinkingParser) {
								// Thinking mode - use parser
								thinkingParser.processChunk(event.data);
							} else {
								// No thinking mode - emit text directly
								if (textBlockIndex === null) {
									textBlockIndex = output.content.length;
									output.content.push({ type: "text", text: "" });
									stream.push({ type: "text_start", contentIndex: textBlockIndex, partial: output });
								}
								const block = output.content[textBlockIndex] as TextContent;
								block.text += event.data;
								stream.push({
									type: "text_delta",
									contentIndex: textBlockIndex,
									delta: event.data,
									partial: output,
								});
							}
						} else if (event.type === "toolUse") {
							const tc = event.data;
							if (tc.name && tc.toolUseId) {
								if (currentToolCall && currentToolCall.toolUseId === tc.toolUseId) {
									currentToolCall.input += tc.input || "";
								} else {
									if (currentToolCall) toolCalls.push(currentToolCall);
									currentToolCall = { toolUseId: tc.toolUseId, name: tc.name, input: tc.input || "" };
								}
								if (tc.stop && currentToolCall) {
									toolCalls.push(currentToolCall);
									currentToolCall = null;
								}
							}
						} else if (event.type === "toolUseInput") {
							if (currentToolCall) currentToolCall.input += event.data.input || "";
						} else if (event.type === "toolUseStop") {
							if (currentToolCall && event.data.stop) {
								toolCalls.push(currentToolCall);
								currentToolCall = null;
							}
						}
					}

					// contextUsage is always the last event from the API
					if (streamComplete) break;
				}

				if (idleTimer) clearTimeout(idleTimer);

				// Finalize any remaining content
				if (currentToolCall) {
					toolCalls.push(currentToolCall);
				}

				// Finalize thinking parser if used
				if (thinkingParser) {
					thinkingParser.finalize();
					textBlockIndex = thinkingParser.getTextBlockIndex();
				}

				// End text block if exists
				if (textBlockIndex !== null) {
					const block = output.content[textBlockIndex] as TextContent;
					stream.push({ type: "text_end", contentIndex: textBlockIndex, content: block.text, partial: output });
				}

				// Emit tool calls
				for (const tc of toolCalls) {
					const idx = output.content.length;
					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = JSON.parse(tc.input);
					} catch {
						parsedArgs = {};
					}
					const toolCall: ToolCall = {
						type: "toolCall",
						id: tc.toolUseId,
						name: tc.name,
						arguments: parsedArgs,
					};
					output.content.push(toolCall);
					stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex: idx, delta: tc.input, partial: output });
					stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
				}

				// Calculate usage
				const outputTokens = Math.ceil(totalContent.length / 4);
				if (contextUsagePercentage !== null && contextUsagePercentage > 0) {
					const totalTokens = Math.round((200000 * contextUsagePercentage) / 100);
					output.usage.input = Math.max(0, totalTokens - outputTokens);
				}
				output.usage.output = outputTokens;
				output.usage.totalTokens = output.usage.input + output.usage.output;
				calculateCost(model, output.usage);

				output.stopReason = toolCalls.length > 0 ? "toolUse" : "stop";
				stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
				stream.end();
				break;
			}
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleKiro: StreamFunction<"kiro", SimpleStreamOptions> = (
	model: Model<"kiro">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey("kiro");
	const base = buildBaseOptions(model, options, apiKey);

	const thinkingEnabled = !!options?.reasoning || model.reasoning;
	const thinkingBudget =
		options?.reasoning === "xhigh"
			? 50000
			: options?.reasoning === "high"
				? 30000
				: options?.reasoning === "medium"
					? 20000
					: 10000;

	return streamKiro(model, context, {
		...base,
		thinkingEnabled,
		thinkingBudgetTokens: thinkingBudget,
	} satisfies KiroOptions);
};
