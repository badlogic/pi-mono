/**
 * Progress renderer for print mode (non-interactive).
 *
 * Shows two updating lines:
 * Line 1: Spinner + current activity (tool call, thinking, text generation)
 * Line 2: Token stats, cost, model, elapsed time (styled like interactive footer)
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, ThinkingContent, ToolCall } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "../core/agent-session.js";
import { theme } from "./interactive/theme/theme.js";

/** Strip ANSI escape codes from a string */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Calculate visible width of a string (excluding ANSI codes) */
function visibleWidth(str: string): number {
	return stripAnsi(str).length;
}

/** Truncate a string with ANSI codes to a maximum visible width */
function truncateToWidth(text: string, maxWidth: number, ellipsis = "..."): string {
	const textWidth = visibleWidth(text);
	if (textWidth <= maxWidth) {
		return text;
	}

	const ellipsisWidth = ellipsis.length;
	const targetWidth = maxWidth - ellipsisWidth;
	if (targetWidth <= 0) {
		return ellipsis.slice(0, maxWidth);
	}

	// Walk through the string, tracking visible characters
	let visibleCount = 0;
	const ansiRegex = /\x1b\[[0-9;]*m/g;
	let result = "";
	let lastIndex = 0;

	// Find all ANSI sequences and their positions
	for (const match of text.matchAll(ansiRegex)) {
		// Add visible characters before this ANSI sequence
		const beforeAnsi = text.slice(lastIndex, match.index);
		for (const char of beforeAnsi) {
			if (visibleCount >= targetWidth) break;
			result += char;
			visibleCount++;
		}
		if (visibleCount >= targetWidth) break;
		// Add the ANSI sequence (doesn't count toward visible width)
		result += match[0];
		lastIndex = (match.index ?? 0) + match[0].length;
	}

	// Add remaining visible characters after last ANSI sequence
	if (visibleCount < targetWidth) {
		const remaining = text.slice(lastIndex);
		for (const char of remaining) {
			if (visibleCount >= targetWidth) break;
			result += char;
			visibleCount++;
		}
	}

	// Reset any open ANSI sequences and add ellipsis
	return `${result}\x1b[0m${ellipsis}`;
}

/** Spinner frames (braille pattern, same as TUI Loader) */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/** Cumulative usage stats */
interface CumulativeUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/** Context usage from last message (for percentage calculation) */
interface ContextUsage {
	tokens: number;
	window: number;
}

/** Progress renderer state */
export class PrintModeProgress {
	private spinnerFrame = 0;
	private spinnerInterval: NodeJS.Timeout | null = null;
	private startTime: number;
	private currentActivity = "";
	private currentActivityType: "tool" | "thinking" | "text" | "system" = "system";
	private currentToolName = "";
	private usage: CumulativeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	private context: ContextUsage = { tokens: 0, window: 0 };
	private hasReceivedStats = false;
	private model: Model<any> | undefined;
	private thinkingLevel: ThinkingLevel = "off";
	private isActive = false;
	private hasRenderedOnce = false;

	constructor() {
		this.startTime = Date.now();
	}

	/**
	 * Start the progress display.
	 * Should be called before processing begins.
	 */
	start(model: Model<any> | undefined, thinkingLevel: ThinkingLevel): void {
		this.model = model;
		this.thinkingLevel = thinkingLevel;
		this.startTime = Date.now();
		this.isActive = true;
		this.hasReceivedStats = false;
		this.currentActivity = "Starting...";
		this.currentActivityType = "system";
		this.context = { tokens: 0, window: model?.contextWindow || 0 };
		this.hasRenderedOnce = false;

		// Start spinner animation
		this.spinnerInterval = setInterval(() => {
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
			this.render();
		}, SPINNER_INTERVAL_MS);

		this.render();
	}

	/**
	 * Stop the progress display and clear the lines.
	 */
	stop(): void {
		this.isActive = false;

		if (this.spinnerInterval) {
			clearInterval(this.spinnerInterval);
			this.spinnerInterval = null;
		}

		// Clear all lines
		this.clearLines();
	}

	/**
	 * Handle an agent session event to update progress display.
	 */
	handleEvent(event: AgentSessionEvent): void {
		if (!this.isActive) return;

		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") {
					this.currentActivity = "Working...";
					this.currentActivityType = "system";
				}
				break;

			case "message_update":
				if (event.message.role === "assistant") {
					this.updateFromAssistantMessage(event.message as AssistantMessage);
				}
				break;

			case "message_end":
				if (event.message.role === "assistant") {
					const msg = event.message as AssistantMessage;
					// Update cumulative usage
					this.usage.input += msg.usage.input;
					this.usage.output += msg.usage.output;
					this.usage.cacheRead += msg.usage.cacheRead;
					this.usage.cacheWrite += msg.usage.cacheWrite;
					this.usage.cost += msg.usage.cost.total;
					// Update context usage from last message (for percentage calculation)
					this.context.tokens = msg.usage.input + msg.usage.output + msg.usage.cacheRead + msg.usage.cacheWrite;
					this.hasReceivedStats = true;
				}
				break;

			case "auto_compaction_start":
				this.currentActivity = "Compacting context...";
				this.currentActivityType = "system";
				break;

			case "auto_retry_start":
				this.currentActivity = `Retrying (${event.attempt}/${event.maxAttempts})...`;
				this.currentActivityType = "system";
				break;
		}

		this.render();
	}

	/**
	 * Update activity from streaming assistant message content.
	 */
	private updateFromAssistantMessage(msg: AssistantMessage): void {
		// Check for tool calls first
		const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
		if (toolCalls.length > 0) {
			const lastToolCall = toolCalls[toolCalls.length - 1];
			this.currentToolName = lastToolCall.name;
			this.currentActivity = this.formatToolCall(lastToolCall);
			this.currentActivityType = "tool";
			return;
		}

		// Check for thinking content
		const thinkingBlocks = msg.content.filter((c): c is ThinkingContent => c.type === "thinking");
		if (thinkingBlocks.length > 0) {
			const lastThinking = thinkingBlocks[thinkingBlocks.length - 1];
			if (lastThinking.thinking?.trim()) {
				this.currentActivity = this.normalizeText(lastThinking.thinking);
			} else {
				this.currentActivity = "";
			}
			this.currentActivityType = "thinking";
			return;
		}

		// Check for text content
		const textBlocks = msg.content.filter((c) => c.type === "text");
		if (textBlocks.length > 0) {
			const lastText = textBlocks[textBlocks.length - 1];
			if ("text" in lastText && lastText.text) {
				this.currentActivity = this.normalizeText(lastText.text);
				this.currentActivityType = "text";
				return;
			}
		}
	}

	/**
	 * Format a tool call for display (returns just the details, not the label).
	 */
	private formatToolCall(toolCall: ToolCall): string {
		const name = toolCall.name;
		const args = toolCall.arguments as Record<string, unknown>;

		switch (name) {
			case "read": {
				const path = this.shortenPath(String(args.path || args.file_path || ""));
				return path;
			}
			case "write": {
				const path = this.shortenPath(String(args.path || args.file_path || ""));
				return path;
			}
			case "edit": {
				const path = this.shortenPath(String(args.path || args.file_path || ""));
				return path;
			}
			case "bash": {
				return this.normalizeText(String(args.command || ""));
			}
			case "grep": {
				const pattern = String(args.pattern || "");
				const path = this.shortenPath(String(args.path || "."));
				return `/${pattern}/ in ${path}`;
			}
			case "find": {
				const pattern = String(args.pattern || "");
				const path = this.shortenPath(String(args.path || "."));
				return `${pattern} in ${path}`;
			}
			case "ls": {
				return this.shortenPath(String(args.path || "."));
			}
			default: {
				// For custom tools, show truncated JSON args
				const argsStr = JSON.stringify(args);
				return argsStr.length > 40 ? `${argsStr.slice(0, 37)}...` : argsStr;
			}
		}
	}

	/**
	 * Shorten a path by replacing home directory with ~.
	 */
	private shortenPath(path: string): string {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		if (home && path.startsWith(home)) {
			return `~${path.slice(home.length)}`;
		}
		return path;
	}

	/**
	 * Normalize text for single-line display (collapse whitespace).
	 * Truncation is handled at render time based on terminal width.
	 */
	private normalizeText(text: string): string {
		// Normalize whitespace (replace newlines, tabs with space, collapse multiple spaces)
		return text
			.replace(/[\r\n\t]/g, " ")
			.replace(/ +/g, " ")
			.trim();
	}

	/**
	 * Format token count for display.
	 */
	private formatTokens(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		if (count < 1000000) return `${Math.round(count / 1000)}k`;
		if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
		return `${Math.round(count / 1000000)}M`;
	}

	/**
	 * Format elapsed time for display.
	 */
	private formatElapsedTime(): string {
		const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
		if (elapsed < 60) {
			return `${elapsed}s`;
		}
		const minutes = Math.floor(elapsed / 60);
		const seconds = elapsed % 60;
		return `${minutes}m ${seconds}s`;
	}

	/**
	 * Build the activity line (line 1).
	 */
	private buildActivityLine(): string {
		const spinner = theme.fg("accent", SPINNER_FRAMES[this.spinnerFrame]);

		switch (this.currentActivityType) {
			case "tool":
				// Tool label in accent color, details plain
				return `${spinner} ${theme.fg("accent", `[${this.currentToolName}]`)} ${this.currentActivity}`;
			case "thinking":
				// Thinking label in accent color, content plain (like tools)
				if (this.currentActivity) {
					return `${spinner} ${theme.fg("accent", "[thinking]")} ${this.currentActivity}`;
				}
				return `${spinner} ${theme.fg("accent", "[thinking]")}`;
			case "text":
				return `${spinner} ${this.currentActivity}`;
			default:
				// System messages like "Starting...", "Compacting...", "Retrying..."
				if (this.currentActivity.startsWith("Retrying")) {
					return `${theme.fg("warning", SPINNER_FRAMES[this.spinnerFrame])} ${theme.fg("warning", this.currentActivity)}`;
				}
				return `${spinner} ${this.currentActivity}`;
		}
	}

	/**
	 * Build the stats line (line 2).
	 */
	private buildStatsLine(): string {
		const parts: string[] = [];
		const placeholder = "---";

		// Token stats (show placeholders before first stats received)
		if (this.hasReceivedStats) {
			parts.push(`↑${this.formatTokens(this.usage.input)}`);
			parts.push(`↓${this.formatTokens(this.usage.output)}`);
			parts.push(`R${this.formatTokens(this.usage.cacheRead)}`);
			parts.push(`W${this.formatTokens(this.usage.cacheWrite)}`);
			parts.push(`$${this.usage.cost.toFixed(3)}`);
		} else {
			parts.push(`↑${placeholder}`);
			parts.push(`↓${placeholder}`);
			parts.push(`R${placeholder}`);
			parts.push(`W${placeholder}`);
			parts.push(`$${placeholder}`);
		}

		// Context percentage (like interactive mode footer)
		if (this.context.window > 0) {
			if (this.hasReceivedStats) {
				const contextPercent = (this.context.tokens / this.context.window) * 100;
				const contextDisplay = `${contextPercent.toFixed(1)}%/${this.formatTokens(this.context.window)}`;
				// Colorize based on usage
				if (contextPercent > 90) {
					parts.push(theme.fg("error", contextDisplay));
				} else if (contextPercent > 70) {
					parts.push(theme.fg("warning", contextDisplay));
				} else {
					parts.push(contextDisplay);
				}
			} else {
				parts.push(`${placeholder}/${this.formatTokens(this.context.window)}`);
			}
		}

		// Model and thinking level
		if (this.model) {
			let modelPart = this.model.id;
			if (this.model.reasoning && this.thinkingLevel !== "off") {
				modelPart += `:${this.thinkingLevel}`;
			}
			parts.push(modelPart);
		}

		// Elapsed time
		parts.push(this.formatElapsedTime());

		return theme.fg("dim", parts.join(" | "));
	}

	/**
	 * Render the progress lines to stderr.
	 * Layout: empty line, activity line, stats line, empty line (4 lines total)
	 */
	private render(): void {
		if (!this.isActive) return;

		const activityLine = this.buildActivityLine();
		const statsLine = this.buildStatsLine();

		// Get terminal width, default to 80 if not available
		const termWidth = process.stderr.columns || 80;

		// Truncate lines to terminal width using proper ANSI-aware truncation
		const displayActivity =
			visibleWidth(activityLine) > termWidth ? truncateToWidth(activityLine, termWidth) : activityLine;
		const displayStats = visibleWidth(statsLine) > termWidth ? truncateToWidth(statsLine, termWidth) : statsLine;

		// On first render, just write the lines
		// On subsequent renders, move up first to overwrite previous content
		// Cursor always ends at the bottom (end of line 4)
		const moveUp = this.hasRenderedOnce ? `\x1b[3A\r` : ""; // Move up 3 lines (from line 4 to line 1)
		this.hasRenderedOnce = true;

		process.stderr.write(
			`${moveUp}\x1b[K\n` + // Line 1: empty
				`\x1b[K${displayActivity}\n` + // Line 2: activity
				`\x1b[K${displayStats}\n` + // Line 3: stats
				`\x1b[K`, // Line 4: empty, cursor stays here
		);
	}

	/**
	 * Clear all progress lines (4 lines total).
	 */
	private clearLines(): void {
		// Move up 3 lines (to line 1) and clear all 4 lines, cursor ends at line 1
		process.stderr.write(`\x1b[3A\r\x1b[K\n\x1b[K\n\x1b[K\n\x1b[K\x1b[3A\r`);
	}
}
