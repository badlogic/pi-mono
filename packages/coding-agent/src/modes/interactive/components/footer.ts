import type { AssistantMessage } from "@mariozechner/pi-ai";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, type FSWatcher, readFileSync, watch } from "fs";
import { dirname, join } from "path";
import type { AgentSession } from "../../../core/agent-session.js";
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
 * Find the git root directory by walking up from cwd.
 * Returns the path to .git/HEAD if found, null otherwise.
 */
function findGitHeadPath(): string | null {
	let dir = process.cwd();
	while (true) {
		const gitHeadPath = join(dir, ".git", "HEAD");
		if (existsSync(gitHeadPath)) {
			return gitHeadPath;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			// Reached filesystem root
			return null;
		}
		dir = parent;
	}
}

/**
 * Footer component that shows pwd, token stats, and context usage
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private cachedBranch: string | null | undefined = undefined; // undefined = not checked yet, null = not in git repo, string = branch name
	private gitWatcher: FSWatcher | null = null;
	private onBranchChange: (() => void) | null = null;
	private autoCompactEnabled: boolean = true;
	private hookStatuses: Map<string, string> = new Map();

	constructor(session: AgentSession) {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * Set hook status text to display in the footer.
	 * Text is sanitized (newlines/tabs replaced with spaces) and truncated to terminal width.
	 * ANSI escape codes for styling are preserved.
	 * @param key - Unique key to identify this status
	 * @param text - Status text, or undefined to clear
	 */
	setHookStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.hookStatuses.delete(key);
		} else {
			this.hookStatuses.set(key, text);
		}
	}

	/**
	 * Set up a file watcher on .git/HEAD to detect branch changes.
	 * Call the provided callback when branch changes.
	 */
	watchBranch(onBranchChange: () => void): void {
		this.onBranchChange = onBranchChange;
		this.setupGitWatcher();
	}

	private setupGitWatcher(): void {
		// Clean up existing watcher
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}

		const gitHeadPath = findGitHeadPath();
		if (!gitHeadPath) {
			return;
		}

		try {
			this.gitWatcher = watch(gitHeadPath, () => {
				this.cachedBranch = undefined; // Invalidate cache
				if (this.onBranchChange) {
					this.onBranchChange();
				}
			});
		} catch {
			// Silently fail if we can't watch
		}
	}

	/**
	 * Clean up the file watcher
	 */
	dispose(): void {
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}
	}

	invalidate(): void {
		// Invalidate cached branch so it gets re-read on next render
		this.cachedBranch = undefined;
	}

	/**
	 * Get current git branch by reading .git/HEAD directly.
	 * Returns null if not in a git repo, branch name otherwise.
	 */
	private getCurrentBranch(): string | null {
		// Return cached value if available
		if (this.cachedBranch !== undefined) {
			return this.cachedBranch;
		}

		try {
			const gitHeadPath = findGitHeadPath();
			if (!gitHeadPath) {
				this.cachedBranch = null;
				return null;
			}
			const content = readFileSync(gitHeadPath, "utf8").trim();

			if (content.startsWith("ref: refs/heads/")) {
				// Normal branch: extract branch name
				this.cachedBranch = content.slice(16);
			} else {
				// Detached HEAD state
				this.cachedBranch = "detached";
			}
		} catch {
			// Not in a git repo or error reading file
			this.cachedBranch = null;
		}

		return this.cachedBranch;
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		// Get last assistant message for context percentage calculation (skip aborted messages)
		const lastAssistantMessage = state.messages
			.slice()
			.reverse()
			.find((m) => m.role === "assistant" && m.stopReason !== "aborted") as AssistantMessage | undefined;

		// Calculate context percentage from last message (input + output + cacheRead + cacheWrite)
		const contextTokens = lastAssistantMessage
			? lastAssistantMessage.usage.input +
				lastAssistantMessage.usage.output +
				lastAssistantMessage.usage.cacheRead +
				lastAssistantMessage.usage.cacheWrite
			: 0;
		const contextWindow = state.model?.contextWindow || 0;
		const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
		const contextPercent = contextPercentValue.toFixed(1);

		// Format token counts (similar to web-ui)
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
			if (count < 1000000) return `${Math.round(count / 1000)}k`;
			if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
			return `${Math.round(count / 1000000)}M`;
		};

		// Replace home directory with ~
		let pwd = process.cwd();
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = `~${pwd.slice(home.length)}`;
		}

		// Add git branch if available
		const branch = this.getCurrentBranch();
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
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
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

		// Add hook statuses on a single line, sorted by key alphabetically
		if (this.hookStatuses.size > 0) {
			const sortedStatuses = Array.from(this.hookStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
