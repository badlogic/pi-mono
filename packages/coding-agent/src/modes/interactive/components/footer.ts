import { type AssistantMessage, getSystemPromptEstimateParts } from "@mariozechner/pi-ai";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { estimateTextTokens, estimateTokens } from "../../../core/compaction/index.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import type { SessionEntry } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts (similar to web-ui)
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

type ToolEstimate = {
	name: string;
	description: string;
	parameters: unknown;
};

function estimateToolTokens(tools: ToolEstimate[]): number {
	if (tools.length === 0) return 0;
	const payload = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
	return estimateTextTokens(JSON.stringify(payload));
}

function calculateUsageContextTokens(usage: AssistantMessage["usage"]): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;

	constructor(
		private session: AgentSession,
		private footerData: ReadonlyFooterDataProvider,
	) {}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	private getRecentContextState(branchEntries: SessionEntry[]): {
		lastAssistantMessage?: AssistantMessage;
		hasRecentCompaction: boolean;
	} {
		let lastAssistantMessage: AssistantMessage | undefined;
		let lastAssistantIndex = -1;
		let lastCompactionIndex = -1;

		for (let i = branchEntries.length - 1; i >= 0; i--) {
			const entry = branchEntries[i];
			if (lastCompactionIndex === -1 && entry.type === "compaction") {
				lastCompactionIndex = i;
			}
			if (lastAssistantIndex === -1 && entry.type === "message" && entry.message.role === "assistant") {
				const assistant = entry.message as AssistantMessage;
				if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
					lastAssistantMessage = assistant;
					lastAssistantIndex = i;
				}
			}
			if (lastCompactionIndex !== -1 && lastAssistantIndex !== -1) {
				break;
			}
		}

		const hasRecentCompaction =
			lastCompactionIndex !== -1 && (lastAssistantIndex === -1 || lastCompactionIndex > lastAssistantIndex);

		return { lastAssistantMessage, hasRecentCompaction };
	}

	render(width: number): string[] {
		const state = this.session.state;

		const allEntries = this.session.sessionManager.getEntries();
		const branchEntries = this.session.sessionManager.getBranch();

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const entry of allEntries) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;

		// Get last assistant usage for context percentage calculation (skip aborted messages)
		const { lastAssistantMessage, hasRecentCompaction } = this.getRecentContextState(branchEntries);
		const lastAssistantUsage = lastAssistantMessage?.usage;
		const toolPayload = state.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

		// Calculate context percentage from last message usage, or estimate after compaction/start
		let contextTokens = 0;
		if (hasRecentCompaction || !lastAssistantMessage || !lastAssistantUsage) {
			const messageTokens = state.messages.reduce((total, message) => total + estimateTokens(message), 0);
			const systemPromptTokens = getSystemPromptEstimateParts({
				model: state.model,
				systemPrompt: state.systemPrompt,
				tools: state.tools,
				isAnthropicOAuth: usingSubscription,
			}).reduce((total, part) => total + estimateTextTokens(part), 0);
			const toolTokens = estimateToolTokens(toolPayload);
			contextTokens = messageTokens + systemPromptTokens + toolTokens;
		} else {
			contextTokens = calculateUsageContextTokens(lastAssistantUsage);
		}
		const contextWindow = state.model?.contextWindow || 0;
		const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
		const contextPercent = contextPercentValue.toFixed(1);

		// Replace home directory with ~
		let pwd = process.cwd();
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = `~${pwd.slice(home.length)}`;
		}

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Truncate path if too long to fit width
		if (pwd.length > width) {
			const half = Math.floor(width / 2) - 2;
			if (half > 0) {
				const start = pwd.slice(0, half);
				const end = pwd.slice(-(half - 1));
				pwd = `${start}...${end}`;
			} else {
				pwd = pwd.slice(0, Math.max(1, width));
			}
		}

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
		if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
		if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
		if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

		// Show cost with "(sub)" indicator if using OAuth subscription
		if (totalCost || usingSubscription) {
			const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay = `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		statsParts.push(contextPercentStr);

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		// Add thinking level hint if model supports reasoning and thinking is enabled
		let rightSide = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			if (thinkingLevel !== "off") {
				rightSide = `${modelName} • ${thinkingLevel}`;
			}
		}

		let statsLeftWidth = visibleWidth(statsLeft);
		const rightSideWidth = visibleWidth(rightSide);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			// Truncate statsLeft to fit width (no room for right side)
			const plainStatsLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
			statsLeft = `${plainStatsLeft.substring(0, width - 3)}...`;
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 3) {
				// Truncate to fit (strip ANSI codes for length calculation, then truncate raw string)
				const plainRightSide = rightSide.replace(/\x1b\[[0-9;]*m/g, "");
				const truncatedPlain = plainRightSide.substring(0, availableForRight);
				// For simplicity, just use plain truncated version (loses color, but fits)
				const padding = " ".repeat(width - statsLeftWidth - truncatedPlain.length);
				statsLine = statsLeft + padding + truncatedPlain;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const lines = [theme.fg("dim", pwd), dimStatsLeft + dimRemainder];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
