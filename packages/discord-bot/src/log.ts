/**
 * Structured logging system for Pi Discord Bot
 * Adapted from pi-mom's log.ts for Discord context
 */

import chalk from "chalk";

export interface LogContext {
	channelId: string;
	userName?: string;
	channelName?: string;
}

function timestamp(): string {
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[${hh}:${mm}:${ss}]`;
}

function formatContext(ctx: LogContext): string {
	// DMs: [DM:username]
	// Channels: [#channel-name:username]
	if (ctx.channelId.startsWith("DM")) {
		return `[DM:${ctx.userName || ctx.channelId}]`;
	}
	const channel = ctx.channelName || ctx.channelId;
	const user = ctx.userName || "unknown";
	return `[${channel.startsWith("#") ? channel : `#${channel}`}:${user}]`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen) + `\n(truncated at ${maxLen} chars)`;
}

function formatToolArgs(args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined && limit !== undefined) {
				lines.push(`${value}:${offset}-${offset + limit}`);
			} else {
				lines.push(value);
			}
			continue;
		}

		if (key === "offset" || key === "limit") continue;

		if (typeof value === "string") {
			if (value.includes("\n")) {
				lines.push(value);
			} else {
				lines.push(value);
			}
		} else {
			lines.push(JSON.stringify(value));
		}
	}

	return lines.join("\n");
}

// User messages
export function logUserMessage(ctx: LogContext, text: string): void {
	console.log(chalk.green(`${timestamp()} ${formatContext(ctx)} ${text}`));
}

// Tool execution
export function logToolStart(ctx: LogContext, toolName: string, label: string, args: Record<string, unknown>): void {
	const formattedArgs = formatToolArgs(args);
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} -> ${toolName}: ${label}`));
	if (formattedArgs) {
		const indented = formattedArgs
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(chalk.dim(indented));
	}
}

export function logToolSuccess(ctx: LogContext, toolName: string, durationMs: number, result: string): void {
	const duration = (durationMs / 1000).toFixed(1);
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} OK ${toolName} (${duration}s)`));

	const truncated = truncate(result, 1000);
	if (truncated) {
		const indented = truncated
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(chalk.dim(indented));
	}
}

export function logToolError(ctx: LogContext, toolName: string, durationMs: number, error: string): void {
	const duration = (durationMs / 1000).toFixed(1);
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} FAIL ${toolName} (${duration}s)`));

	const truncated = truncate(error, 1000);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(chalk.dim(indented));
}

// Response streaming
export function logResponseStart(ctx: LogContext): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} -> Streaming response...`));
}

export function logThinking(ctx: LogContext, thinking: string): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} Thinking`));
	const truncated = truncate(thinking, 1000);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(chalk.dim(indented));
}

export function logResponse(ctx: LogContext, text: string): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} Response`));
	const truncated = truncate(text, 1000);
	const indented = truncated
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(chalk.dim(indented));
}

// Attachments
export function logDownloadStart(ctx: LogContext, filename: string, localPath: string): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} Downloading attachment`));
	console.log(chalk.dim(`           ${filename} -> ${localPath}`));
}

export function logDownloadSuccess(ctx: LogContext, sizeKB: number): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} OK Downloaded (${sizeKB.toLocaleString()} KB)`));
}

export function logDownloadError(ctx: LogContext, filename: string, error: string): void {
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} FAIL Download failed`));
	console.log(chalk.dim(`           ${filename}: ${error}`));
}

// Control
export function logStopRequest(ctx: LogContext): void {
	console.log(chalk.green(`${timestamp()} ${formatContext(ctx)} stop`));
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} Stop requested - aborting`));
}

// System
export function logInfo(message: string): void {
	console.log(chalk.blue(`${timestamp()} [system] ${message}`));
}

export function logWarning(message: string, details?: string): void {
	console.log(chalk.yellow(`${timestamp()} [system] WARN ${message}`));
	if (details) {
		const indented = details
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(chalk.dim(indented));
	}
}

export function logError(message: string, details?: string): void {
	console.log(chalk.red(`${timestamp()} [system] ERROR ${message}`));
	if (details) {
		const indented = details
			.split("\n")
			.map((line) => `           ${line}`)
			.join("\n");
		console.log(chalk.dim(indented));
	}
}

export function logAgentError(ctx: LogContext | "system", error: string): void {
	const context = ctx === "system" ? "[system]" : formatContext(ctx);
	console.log(chalk.yellow(`${timestamp()} ${context} FAIL Agent error`));
	const indented = error
		.split("\n")
		.map((line) => `           ${line}`)
		.join("\n");
	console.log(chalk.dim(indented));
}

// Usage summary
export function logUsageSummary(
	ctx: LogContext,
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	},
	contextTokens?: number,
	contextWindow?: number,
): string {
	const formatTokens = (count: number): string => {
		if (count < 1000) return count.toString();
		if (count < 10000) return (count / 1000).toFixed(1) + "k";
		if (count < 1000000) return Math.round(count / 1000) + "k";
		return (count / 1000000).toFixed(1) + "M";
	};

	const lines: string[] = [];
	lines.push("**Usage Summary**");
	lines.push(`Tokens: ${usage.input.toLocaleString()} in, ${usage.output.toLocaleString()} out`);
	if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
		lines.push(`Cache: ${usage.cacheRead.toLocaleString()} read, ${usage.cacheWrite.toLocaleString()} write`);
	}
	if (contextTokens && contextWindow) {
		const contextPercent = ((contextTokens / contextWindow) * 100).toFixed(1);
		lines.push(`Context: ${formatTokens(contextTokens)} / ${formatTokens(contextWindow)} (${contextPercent}%)`);
	}
	lines.push(
		`Cost: $${usage.cost.input.toFixed(4)} in, $${usage.cost.output.toFixed(4)} out` +
			(usage.cacheRead > 0 || usage.cacheWrite > 0
				? `, $${usage.cost.cacheRead.toFixed(4)} cache read, $${usage.cost.cacheWrite.toFixed(4)} cache write`
				: ""),
	);
	lines.push(`**Total: $${usage.cost.total.toFixed(4)}**`);

	const summary = lines.join("\n");

	// Log to console
	console.log(chalk.yellow(`${timestamp()} ${formatContext(ctx)} Usage`));
	console.log(
		chalk.dim(
			`           ${usage.input.toLocaleString()} in + ${usage.output.toLocaleString()} out` +
				(usage.cacheRead > 0 || usage.cacheWrite > 0
					? ` (${usage.cacheRead.toLocaleString()} cache read, ${usage.cacheWrite.toLocaleString()} cache write)`
					: "") +
				` = $${usage.cost.total.toFixed(4)}`,
		),
	);

	return summary;
}

// Startup
export function logStartup(workingDir: string, model: string): void {
	console.log("Starting Pi Discord Bot...");
	console.log(`  Working directory: ${workingDir}`);
	console.log(`  Model: ${model}`);
}

export function logConnected(botTag: string): void {
	console.log(`Bot connected as ${botTag}`);
	console.log("");
}

export function logDisconnected(): void {
	console.log("Pi Discord Bot disconnected.");
}

// Events
export function logEventTriggered(eventType: string, filename: string): void {
	console.log(chalk.blue(`${timestamp()} [events] Triggered ${eventType}: ${filename}`));
}

export function logEventScheduled(eventType: string, filename: string, nextRun?: string): void {
	const next = nextRun ? ` (next: ${nextRun})` : "";
	console.log(chalk.blue(`${timestamp()} [events] Scheduled ${eventType}: ${filename}${next}`));
}
