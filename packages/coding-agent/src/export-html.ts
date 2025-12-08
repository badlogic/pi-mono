import type { AgentState } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename } from "path";
import { APP_NAME, VERSION } from "./config.js";
import { type BashExecutionMessage, isBashExecutionMessage } from "./messages.js";
import type { SessionManager } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

interface MessageEvent {
	type: "message";
	message: Message;
	timestamp?: number;
}

interface ModelChangeEvent {
	type: "model_change";
	provider: string;
	modelId: string;
	timestamp?: number;
}

interface CompactionEvent {
	type: "compaction";
	timestamp: string;
	summary: string;
	tokensBefore: number;
}

type SessionEvent = MessageEvent | ModelChangeEvent | CompactionEvent;

interface ParsedSessionData {
	sessionId: string;
	timestamp: string;
	systemPrompt?: string;
	modelsUsed: Set<string>;
	messages: Message[];
	toolResultsMap: Map<string, ToolResultMessage>;
	sessionEvents: SessionEvent[];
	tokenStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	costStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	tools?: { name: string; description: string }[];
	contextWindow?: number;
	isStreamingFormat?: boolean;
}

// ============================================================================
// Color scheme (matching TUI)
// ============================================================================

const COLORS = {
	userMessageBg: "rgb(52, 53, 65)",
	toolPendingBg: "rgb(40, 40, 50)",
	toolSuccessBg: "rgb(40, 50, 40)",
	toolErrorBg: "rgb(60, 40, 40)",
	userBashBg: "rgb(50, 48, 35)", // Faint yellow/brown for user-executed bash
	userBashErrorBg: "rgb(60, 45, 35)", // Slightly more orange for errors
	bodyBg: "rgb(24, 24, 30)",
	containerBg: "rgb(30, 30, 36)",
	text: "rgb(229, 229, 231)",
	textDim: "rgb(161, 161, 170)",
	cyan: "rgb(103, 232, 249)",
	green: "rgb(34, 197, 94)",
	red: "rgb(239, 68, 68)",
	yellow: "rgb(234, 179, 8)",
};

// ============================================================================
// Utility functions
// ============================================================================

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function formatTimestamp(timestamp: number | string | undefined): string {
	if (!timestamp) return "";
	const date = new Date(typeof timestamp === "string" ? timestamp : timestamp);
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatExpandableOutput(lines: string[], maxLines: number): string {
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;

	if (remaining > 0) {
		let out = '<div class="tool-output expandable" onclick="this.classList.toggle(\'expanded\')">';
		out += '<div class="output-preview">';
		for (const line of displayLines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += `<div class="expand-hint">... (${remaining} more lines) - click to expand</div>`;
		out += "</div>";
		out += '<div class="output-full">';
		for (const line of lines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += "</div></div>";
		return out;
	}

	let out = '<div class="tool-output">';
	for (const line of displayLines) {
		out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
	}
	out += "</div>";
	return out;
}

// ============================================================================
// Parsing functions
// ============================================================================

function parseSessionManagerFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	for (const line of lines) {
		let entry: { type: string; [key: string]: unknown };
		try {
			entry = JSON.parse(line) as { type: string; [key: string]: unknown };
		} catch {
			continue;
		}

		switch (entry.type) {
			case "session":
				data.sessionId = (entry.id as string) || "unknown";
				data.timestamp = (entry.timestamp as string) || data.timestamp;
				data.systemPrompt = entry.systemPrompt as string | undefined;
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

			case "message": {
				const message = entry.message as Message;
				data.messages.push(message);
				data.sessionEvents.push({
					type: "message",
					message,
					timestamp: entry.timestamp as number | undefined,
				});

				if (message.role === "toolResult") {
					const toolResult = message as ToolResultMessage;
					data.toolResultsMap.set(toolResult.toolCallId, toolResult);
				} else if (message.role === "assistant") {
					const assistantMsg = message as AssistantMessage;
					if (assistantMsg.usage) {
						data.tokenStats.input += assistantMsg.usage.input || 0;
						data.tokenStats.output += assistantMsg.usage.output || 0;
						data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
						data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
						if (assistantMsg.usage.cost) {
							data.costStats.input += assistantMsg.usage.cost.input || 0;
							data.costStats.output += assistantMsg.usage.cost.output || 0;
							data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
							data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
						}
					}
				}
				break;
			}

			case "model_change":
				data.sessionEvents.push({
					type: "model_change",
					provider: entry.provider as string,
					modelId: entry.modelId as string,
					timestamp: entry.timestamp as number | undefined,
				});
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

			case "compaction":
				data.sessionEvents.push({
					type: "compaction",
					timestamp: entry.timestamp as string,
					summary: entry.summary as string,
					tokensBefore: entry.tokensBefore as number,
				});
				break;
		}
	}

	return data;
}

function parseStreamingEventFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		isStreamingFormat: true,
	};

	let timestampSet = false;

	for (const line of lines) {
		let entry: { type: string; message?: Message };
		try {
			entry = JSON.parse(line) as { type: string; message?: Message };
		} catch {
			continue;
		}

		if (entry.type === "message_end" && entry.message) {
			const msg = entry.message;
			data.messages.push(msg);
			data.sessionEvents.push({
				type: "message",
				message: msg,
				timestamp: (msg as { timestamp?: number }).timestamp,
			});

			if (msg.role === "toolResult") {
				const toolResult = msg as ToolResultMessage;
				data.toolResultsMap.set(toolResult.toolCallId, toolResult);
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				if (assistantMsg.model) {
					const modelInfo = assistantMsg.provider
						? `${assistantMsg.provider}/${assistantMsg.model}`
						: assistantMsg.model;
					data.modelsUsed.add(modelInfo);
				}
				if (assistantMsg.usage) {
					data.tokenStats.input += assistantMsg.usage.input || 0;
					data.tokenStats.output += assistantMsg.usage.output || 0;
					data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
					data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
					if (assistantMsg.usage.cost) {
						data.costStats.input += assistantMsg.usage.cost.input || 0;
						data.costStats.output += assistantMsg.usage.cost.output || 0;
						data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
						data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
					}
				}
			}

			if (!timestampSet && (msg as { timestamp?: number }).timestamp) {
				data.timestamp = new Date((msg as { timestamp: number }).timestamp).toISOString();
				timestampSet = true;
			}
		}
	}

	data.sessionId = `stream-${data.timestamp.replace(/[:.]/g, "-")}`;
	return data;
}

function detectFormat(lines: string[]): "session-manager" | "streaming-events" | "unknown" {
	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as { type: string };
			if (entry.type === "session") return "session-manager";
			if (entry.type === "agent_start" || entry.type === "message_start" || entry.type === "turn_start") {
				return "streaming-events";
			}
		} catch {}
	}
	return "unknown";
}

function parseSessionFile(content: string): ParsedSessionData {
	const lines = content
		.trim()
		.split("\n")
		.filter((l) => l.trim());

	if (lines.length === 0) {
		throw new Error("Empty session file");
	}

	const format = detectFormat(lines);
	if (format === "unknown") {
		throw new Error("Unknown session file format");
	}

	return format === "session-manager" ? parseSessionManagerFormat(lines) : parseStreamingEventFormat(lines);
}

// ============================================================================
// HTML formatting functions
// ============================================================================

function formatToolExecution(
	toolName: string,
	args: Record<string, unknown>,
	result?: ToolResultMessage,
): { html: string; bgColor: string } {
	let html = "";
	const isError = result?.isError || false;
	const bgColor = result ? (isError ? COLORS.toolErrorBg : COLORS.toolSuccessBg) : COLORS.toolPendingBg;

	const getTextOutput = (): string => {
		if (!result) return "";
		const textBlocks = result.content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as { type: "text"; text: string }).text).join("\n");
	};

	switch (toolName) {
		case "bash": {
			const command = (args?.command as string) || "";
			html = `<div class="tool-command">$ ${escapeHtml(command || "...")}</div>`;
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 5);
				}
			}
			break;
		}

		case "read": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			html = `<div class="tool-header"><span class="tool-name">read</span> <span class="tool-path">${escapeHtml(path || "...")}</span></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 10);
				}
			}
			break;
		}

		case "write": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			const fileContent = (args?.content as string) || "";
			const lines = fileContent ? fileContent.split("\n") : [];

			html = `<div class="tool-header"><span class="tool-name">write</span> <span class="tool-path">${escapeHtml(path || "...")}</span>`;
			if (lines.length > 10) {
				html += ` <span class="line-count">(${lines.length} lines)</span>`;
			}
			html += "</div>";

			if (fileContent) {
				html += formatExpandableOutput(lines, 10);
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		case "edit": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			html = `<div class="tool-header"><span class="tool-name">edit</span> <span class="tool-path">${escapeHtml(path || "...")}</span></div>`;

			if (result?.details?.diff) {
				const diffLines = result.details.diff.split("\n");
				html += '<div class="tool-diff">';
				for (const line of diffLines) {
					if (line.startsWith("+")) {
						html += `<div class="diff-line-new">${escapeHtml(line)}</div>`;
					} else if (line.startsWith("-")) {
						html += `<div class="diff-line-old">${escapeHtml(line)}</div>`;
					} else {
						html += `<div class="diff-line-context">${escapeHtml(line)}</div>`;
					}
				}
				html += "</div>";
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		default: {
			html = `<div class="tool-header"><span class="tool-name">${escapeHtml(toolName)}</span></div>`;
			html += `<div class="tool-output"><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
		}
	}

	return { html, bgColor };
}

function formatMessage(message: Message, toolResultsMap: Map<string, ToolResultMessage>): string {
	let html = "";
	const timestamp = (message as { timestamp?: number }).timestamp;
	const timestampHtml = timestamp ? `<div class="message-timestamp">${formatTimestamp(timestamp)}</div>` : "";

	// Handle bash execution messages (user-executed via ! command)
	if (isBashExecutionMessage(message)) {
		const bashMsg = message as unknown as BashExecutionMessage;
		const isError = bashMsg.cancelled || (bashMsg.exitCode !== 0 && bashMsg.exitCode !== null);
		const bgColor = isError ? COLORS.userBashErrorBg : COLORS.userBashBg;

		html += `<div class="tool-execution" style="background-color: ${bgColor}">`;
		html += timestampHtml;
		html += `<div class="tool-command">$ ${escapeHtml(bashMsg.command)}</div>`;

		if (bashMsg.output) {
			const lines = bashMsg.output.split("\n");
			html += formatExpandableOutput(lines, 10);
		}

		if (bashMsg.cancelled) {
			html += `<div class="bash-status" style="color: ${COLORS.yellow}">(cancelled)</div>`;
		} else if (bashMsg.exitCode !== 0 && bashMsg.exitCode !== null) {
			html += `<div class="bash-status" style="color: ${COLORS.red}">(exit ${bashMsg.exitCode})</div>`;
		}

		if (bashMsg.truncated && bashMsg.fullOutputPath) {
			html += `<div class="bash-truncation" style="color: ${COLORS.yellow}">Output truncated. Full output: ${escapeHtml(bashMsg.fullOutputPath)}</div>`;
		}

		html += `</div>`;
		return html;
	}

	if (message.role === "user") {
		const userMsg = message as UserMessage;
		let textContent = "";

		if (typeof userMsg.content === "string") {
			textContent = userMsg.content;
		} else {
			const textBlocks = userMsg.content.filter((c) => c.type === "text");
			textContent = textBlocks.map((c) => (c as { type: "text"; text: string }).text).join("");
		}

		if (textContent.trim()) {
			html += `<div class="user-message">${timestampHtml}${escapeHtml(textContent).replace(/\n/g, "<br>")}</div>`;
		}
	} else if (message.role === "assistant") {
		const assistantMsg = message as AssistantMessage;
		html += timestampHtml ? `<div class="assistant-message">${timestampHtml}` : "";

		for (const content of assistantMsg.content) {
			if (content.type === "text" && content.text.trim()) {
				html += `<div class="assistant-text">${escapeHtml(content.text.trim()).replace(/\n/g, "<br>")}</div>`;
			} else if (content.type === "thinking" && content.thinking.trim()) {
				html += `<div class="thinking-text">${escapeHtml(content.thinking.trim()).replace(/\n/g, "<br>")}</div>`;
			}
		}

		for (const content of assistantMsg.content) {
			if (content.type === "toolCall") {
				const toolResult = toolResultsMap.get(content.id);
				const { html: toolHtml, bgColor } = formatToolExecution(
					content.name,
					content.arguments as Record<string, unknown>,
					toolResult,
				);
				html += `<div class="tool-execution" style="background-color: ${bgColor}">${toolHtml}</div>`;
			}
		}

		const hasToolCalls = assistantMsg.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (assistantMsg.stopReason === "aborted") {
				html += '<div class="error-text">Aborted</div>';
			} else if (assistantMsg.stopReason === "error") {
				html += `<div class="error-text">Error: ${escapeHtml(assistantMsg.errorMessage || "Unknown error")}</div>`;
			}
		}

		if (timestampHtml) {
			html += "</div>";
		}
	}

	return html;
}

function formatModelChange(event: ModelChangeEvent): string {
	const timestamp = formatTimestamp(event.timestamp);
	const timestampHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
	const modelInfo = `${event.provider}/${event.modelId}`;
	return `<div class="model-change">${timestampHtml}<div class="model-change-text">Switched to model: <span class="model-name">${escapeHtml(modelInfo)}</span></div></div>`;
}

function formatCompaction(event: CompactionEvent): string {
	const timestamp = formatTimestamp(event.timestamp);
	const timestampHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
	const summaryHtml = escapeHtml(event.summary).replace(/\n/g, "<br>");

	return `<div class="compaction-container">
		<div class="compaction-header" onclick="this.parentElement.classList.toggle('expanded')">
			${timestampHtml}
			<div class="compaction-header-row">
				<span class="compaction-toggle">▶</span>
				<span class="compaction-title">Context compacted from ${event.tokensBefore.toLocaleString()} tokens</span>
				<span class="compaction-hint">(click to expand summary)</span>
			</div>
		</div>
		<div class="compaction-content">
			<div class="compaction-summary">
				<div class="compaction-summary-header">Summary sent to model</div>
				<div class="compaction-summary-content">${summaryHtml}</div>
			</div>
		</div>
	</div>`;
}

// ============================================================================
// HTML generation
// ============================================================================

function generateHtml(data: ParsedSessionData, filename: string): string {
	const userMessages = data.messages.filter((m) => m.role === "user").length;
	const assistantMessages = data.messages.filter((m) => m.role === "assistant").length;

	let toolCallsCount = 0;
	for (const message of data.messages) {
		if (message.role === "assistant") {
			toolCallsCount += (message as AssistantMessage).content.filter((c) => c.type === "toolCall").length;
		}
	}

	const lastAssistantMessage = data.messages
		.slice()
		.reverse()
		.find((m) => m.role === "assistant" && (m as AssistantMessage).stopReason !== "aborted") as
		| AssistantMessage
		| undefined;

	const contextTokens = lastAssistantMessage
		? lastAssistantMessage.usage.input +
			lastAssistantMessage.usage.output +
			lastAssistantMessage.usage.cacheRead +
			lastAssistantMessage.usage.cacheWrite
		: 0;

	const lastModel = lastAssistantMessage?.model || "unknown";
	const lastProvider = lastAssistantMessage?.provider || "";
	const lastModelInfo = lastProvider ? `${lastProvider}/${lastModel}` : lastModel;

	const contextWindow = data.contextWindow || 0;
	const contextPercent = contextWindow > 0 ? ((contextTokens / contextWindow) * 100).toFixed(1) : null;

	let messagesHtml = "";
	for (const event of data.sessionEvents) {
		switch (event.type) {
			case "message":
				if (event.message.role !== "toolResult") {
					messagesHtml += formatMessage(event.message, data.toolResultsMap);
				}
				break;
			case "model_change":
				messagesHtml += formatModelChange(event);
				break;
			case "compaction":
				messagesHtml += formatCompaction(event);
				break;
		}
	}

	const systemPromptHtml = data.systemPrompt
		? `<div class="system-prompt">
            <div class="system-prompt-header">System Prompt</div>
            <div class="system-prompt-content">${escapeHtml(data.systemPrompt)}</div>
        </div>`
		: "";

	const toolsHtml = data.tools
		? `<div class="tools-list">
            <div class="tools-header">Available Tools</div>
            <div class="tools-content">
                ${data.tools.map((tool) => `<div class="tool-item"><span class="tool-item-name">${escapeHtml(tool.name)}</span> - ${escapeHtml(tool.description)}</div>`).join("")}
            </div>
        </div>`
		: "";

	const streamingNotice = data.isStreamingFormat
		? `<div class="streaming-notice">
            <em>Note: This session was reconstructed from raw agent event logs, which do not contain system prompt or tool definitions.</em>
        </div>`
		: "";

	const contextUsageText = contextPercent
		? `${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPercent}%) - ${escapeHtml(lastModelInfo)}`
		: `${contextTokens.toLocaleString()} tokens (last turn) - ${escapeHtml(lastModelInfo)}`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Session Export - ${escapeHtml(filename)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            color: ${COLORS.text};
            background: ${COLORS.bodyBg};
            padding: 24px;
        }
        .container { max-width: 700px; margin: 0 auto; }
        .header {
            margin-bottom: 24px;
            padding: 16px;
            background: ${COLORS.containerBg};
            border-radius: 4px;
        }
        .header h1 {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 12px;
            color: ${COLORS.cyan};
        }
        .header-info { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
        .info-item { color: ${COLORS.textDim}; display: flex; align-items: baseline; }
        .info-label { font-weight: 600; margin-right: 8px; min-width: 100px; }
        .info-value { color: ${COLORS.text}; flex: 1; }
        .info-value.cost { font-family: 'SF Mono', monospace; }
        .messages { display: flex; flex-direction: column; gap: 16px; }
        .message-timestamp { font-size: 10px; color: ${COLORS.textDim}; margin-bottom: 4px; opacity: 0.8; }
        .user-message {
            background: ${COLORS.userMessageBg};
            padding: 12px 16px;
            border-radius: 4px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
        }
        .assistant-message { padding: 0; }
        .assistant-text, .thinking-text {
            padding: 12px 16px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
        }
        .thinking-text { color: ${COLORS.textDim}; font-style: italic; }
        .model-change { padding: 8px 16px; background: rgb(40, 40, 50); border-radius: 4px; }
        .model-change-text { color: ${COLORS.textDim}; font-size: 11px; }
        .model-name { color: ${COLORS.cyan}; font-weight: bold; }
        .compaction-container { background: rgb(60, 55, 35); border-radius: 4px; overflow: hidden; }
        .compaction-header { padding: 12px 16px; cursor: pointer; }
        .compaction-header:hover { background: rgba(255, 255, 255, 0.05); }
        .compaction-header-row { display: flex; align-items: center; gap: 8px; }
        .compaction-toggle { color: ${COLORS.cyan}; font-size: 10px; transition: transform 0.2s; }
        .compaction-container.expanded .compaction-toggle { transform: rotate(90deg); }
        .compaction-title { color: ${COLORS.text}; font-weight: bold; }
        .compaction-hint { color: ${COLORS.textDim}; font-size: 11px; }
        .compaction-content { display: none; padding: 0 16px 16px 16px; }
        .compaction-container.expanded .compaction-content { display: block; }
        .compaction-summary { background: rgba(0, 0, 0, 0.2); border-radius: 4px; padding: 12px; }
        .compaction-summary-header { font-weight: bold; color: ${COLORS.cyan}; margin-bottom: 8px; font-size: 11px; }
        .compaction-summary-content { color: ${COLORS.text}; white-space: pre-wrap; word-wrap: break-word; }
        .tool-execution { padding: 12px 16px; border-radius: 4px; margin-top: 8px; }
        .tool-header, .tool-name { font-weight: bold; }
        .tool-path { color: ${COLORS.cyan}; word-break: break-all; }
        .line-count { color: ${COLORS.textDim}; }
        .tool-command { font-weight: bold; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
        .tool-output {
            margin-top: 12px;
            color: ${COLORS.textDim};
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
            font-family: inherit;
            overflow-x: auto;
        }
        .tool-output > div { line-height: 1.4; }
        .tool-output pre { margin: 0; font-family: inherit; color: inherit; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .tool-output.expandable { cursor: pointer; }
        .tool-output.expandable:hover { opacity: 0.9; }
        .tool-output.expandable .output-full { display: none; }
        .tool-output.expandable.expanded .output-preview { display: none; }
        .tool-output.expandable.expanded .output-full { display: block; }
        .expand-hint { color: ${COLORS.cyan}; font-style: italic; margin-top: 4px; }
        .system-prompt, .tools-list { background: rgb(60, 55, 40); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
        .system-prompt-header, .tools-header { font-weight: bold; color: ${COLORS.yellow}; margin-bottom: 8px; }
        .system-prompt-content, .tools-content { color: ${COLORS.textDim}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; font-size: 11px; }
        .tool-item { margin: 4px 0; }
        .tool-item-name { font-weight: bold; color: ${COLORS.text}; }
        .tool-diff { margin-top: 12px; font-size: 11px; font-family: inherit; overflow-x: auto; max-width: 100%; }
        .diff-line-old { color: ${COLORS.red}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-new { color: ${COLORS.green}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-context { color: ${COLORS.textDim}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .error-text { color: ${COLORS.red}; padding: 12px 16px; }
        .footer { margin-top: 48px; padding: 20px; text-align: center; color: ${COLORS.textDim}; font-size: 10px; }
        .streaming-notice { background: rgb(50, 45, 35); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; color: ${COLORS.textDim}; font-size: 11px; }
        @media print { body { background: white; color: black; } .tool-execution { border: 1px solid #ddd; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${APP_NAME} v${VERSION}</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Session:</span><span class="info-value">${escapeHtml(data.sessionId)}</span></div>
                <div class="info-item"><span class="info-label">Date:</span><span class="info-value">${new Date(data.timestamp).toLocaleString()}</span></div>
                <div class="info-item"><span class="info-label">Models:</span><span class="info-value">${
							Array.from(data.modelsUsed)
								.map((m) => escapeHtml(m))
								.join(", ") || "unknown"
						}</span></div>
            </div>
        </div>

        <div class="header">
            <h1>Messages</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">User:</span><span class="info-value">${userMessages}</span></div>
                <div class="info-item"><span class="info-label">Assistant:</span><span class="info-value">${assistantMessages}</span></div>
                <div class="info-item"><span class="info-label">Tool Calls:</span><span class="info-value">${toolCallsCount}</span></div>
            </div>
        </div>

        <div class="header">
            <h1>Tokens & Cost</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Input:</span><span class="info-value">${data.tokenStats.input.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Output:</span><span class="info-value">${data.tokenStats.output.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Read:</span><span class="info-value">${data.tokenStats.cacheRead.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Write:</span><span class="info-value">${data.tokenStats.cacheWrite.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Total:</span><span class="info-value">${(data.tokenStats.input + data.tokenStats.output + data.tokenStats.cacheRead + data.tokenStats.cacheWrite).toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Input Cost:</span><span class="info-value cost">$${data.costStats.input.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Output Cost:</span><span class="info-value cost">$${data.costStats.output.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Read Cost:</span><span class="info-value cost">$${data.costStats.cacheRead.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Write Cost:</span><span class="info-value cost">$${data.costStats.cacheWrite.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Total Cost:</span><span class="info-value cost"><strong>$${(data.costStats.input + data.costStats.output + data.costStats.cacheRead + data.costStats.cacheWrite).toFixed(4)}</strong></span></div>
                <div class="info-item"><span class="info-label">Context Usage:</span><span class="info-value">${contextUsageText}</span></div>
            </div>
        </div>

        ${systemPromptHtml}
        ${toolsHtml}
        ${streamingNotice}

        <div class="messages">
            ${messagesHtml}
        </div>

        <div class="footer">
            Generated by ${APP_NAME} coding-agent on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Export session to HTML using SessionManager and AgentState.
 * Used by TUI's /export command.
 */
export function exportSessionToHtml(sessionManager: SessionManager, state: AgentState, outputPath?: string): string {
	const sessionFile = sessionManager.getSessionFile();
	const content = readFileSync(sessionFile, "utf8");
	const data = parseSessionFile(content);

	// Enrich with data from AgentState (tools, context window)
	data.tools = state.tools.map((t) => ({ name: t.name, description: t.description }));
	data.contextWindow = state.model?.contextWindow;
	if (!data.systemPrompt) {
		data.systemPrompt = state.systemPrompt;
	}

	if (!outputPath) {
		const sessionBasename = basename(sessionFile, ".jsonl");
		outputPath = `${APP_NAME}-session-${sessionBasename}.html`;
	}

	const html = generateHtml(data, basename(sessionFile));
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Export session file to HTML (standalone, without AgentState).
 * Auto-detects format: session manager format or streaming event format.
 * Used by CLI for exporting arbitrary session files.
 */
export function exportFromFile(inputPath: string, outputPath?: string): string {
	if (!existsSync(inputPath)) {
		throw new Error(`File not found: ${inputPath}`);
	}

	const content = readFileSync(inputPath, "utf8");
	const data = parseSessionFile(content);

	if (!outputPath) {
		const inputBasename = basename(inputPath, ".jsonl");
		outputPath = `${APP_NAME}-session-${inputBasename}.html`;
	}

	const html = generateHtml(data, basename(inputPath));
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}
