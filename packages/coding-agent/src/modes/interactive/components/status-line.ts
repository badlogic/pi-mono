import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import { theme } from "../theme/theme.js";
import { getPreset } from "./status-line/presets.js";
import { renderSegment } from "./status-line/segments.js";
import { getSeparator } from "./status-line/separators.js";
import type { SegmentContext, StatusLinePreset, StatusLineSettings } from "./status-line/types.js";

const execFileAsync = promisify(execFile);

interface AssistantMessageWithMetrics extends AssistantMessage {
	duration?: number;
	ttft?: number;
	usage: AssistantMessage["usage"] & { premiumRequests?: number };
}

type ToolResultWithDuration = ToolResultMessage<{ durationMs?: unknown }>;

function inferSubagentCount(statuses: ReadonlyMap<string, string>): number {
	const statusText = statuses.get("subagents");
	if (!statusText) {
		return 0;
	}

	const match = statusText.match(/(\d+)\s+subagent/);
	if (!match) {
		return 0;
	}

	const count = Number.parseInt(match[1], 10);
	return Number.isFinite(count) ? count : 0;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function extractDurationMs(details: unknown): number {
	if (!details || typeof details !== "object") {
		return 0;
	}
	const maybeDuration = (details as { durationMs?: unknown }).durationMs;
	return typeof maybeDuration === "number" && Number.isFinite(maybeDuration) && maybeDuration > 0 ? maybeDuration : 0;
}

export class StatusLineComponent implements Component {
	private autoCompactEnabled = true;
	private settings: StatusLineSettings = {};
	private subagentCount = 0;
	private sessionStartTime = Date.now();
	private planModeStatus: { enabled: boolean; paused: boolean } | null = null;
	private gitStatusCache: { staged: number; unstaged: number; untracked: number } | null = null;
	private gitStatusLastFetch = 0;
	private prCache: { number: number; url: string } | null | undefined = undefined;
	private prLookupInFlight = false;
	private onChange: (() => void) | undefined;
	private unsubscribeBranch: (() => void) | undefined;
	private renderMainLineInBody = false;
	private toolCallCount = 0;
	private toolDurationMs = 0;

	constructor(
		private readonly session: AgentSession,
		private readonly footerData: ReadonlyFooterDataProvider,
	) {
		this.syncToolStatsFromSessionEntries();
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	updateSettings(settings: StatusLineSettings): void {
		this.settings = settings;
	}

	setSubagentCount(count: number): void {
		this.subagentCount = Math.max(0, count);
	}

	setSessionStartTime(time: number): void {
		this.sessionStartTime = time;
	}

	setPlanModeStatus(status: { enabled: boolean; paused: boolean } | undefined): void {
		this.planModeStatus = status ?? null;
	}

	setRenderMainLineInBody(enabled: boolean): void {
		this.renderMainLineInBody = enabled;
	}

	recordToolExecution(result: { details?: unknown } | undefined): void {
		this.toolCallCount += 1;
		this.toolDurationMs += extractDurationMs(result?.details);
	}

	resetToolStats(): void {
		this.toolCallCount = 0;
		this.toolDurationMs = 0;
	}

	syncToolStatsFromSessionEntries(): void {
		this.resetToolStats();
		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
			const toolResult = entry.message as ToolResultWithDuration;
			this.toolCallCount += 1;
			this.toolDurationMs += extractDurationMs(toolResult.details);
		}
	}

	watchBranch(onChange: () => void): void {
		this.onChange = onChange;
		this.unsubscribeBranch?.();
		this.unsubscribeBranch = this.footerData.onBranchChange(() => {
			this.invalidate();
			this.onChange?.();
		});
	}

	invalidate(): void {
		this.gitStatusCache = null;
		this.gitStatusLastFetch = 0;
		this.prCache = undefined;
	}

	dispose(): void {
		this.unsubscribeBranch?.();
		this.unsubscribeBranch = undefined;
	}

	private getGitStatus(): { staged: number; unstaged: number; untracked: number } | null {
		const now = Date.now();
		if (this.gitStatusCache !== null && now - this.gitStatusLastFetch < 1000) {
			return this.gitStatusCache;
		}

		try {
			const output = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], {
				cwd: process.cwd(),
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
			let staged = 0;
			let unstaged = 0;
			let untracked = 0;
			for (const line of output.split("\n")) {
				if (!line) continue;
				const x = line[0];
				const y = line[1];
				if (x === "?" && y === "?") {
					untracked++;
					continue;
				}
				if (x && x !== " " && x !== "?") staged++;
				if (y && y !== " ") unstaged++;
			}
			this.gitStatusCache = { staged, unstaged, untracked };
		} catch {
			this.gitStatusCache = null;
		}

		this.gitStatusLastFetch = now;
		return this.gitStatusCache;
	}

	private lookupPr(): { number: number; url: string } | null {
		if (this.prCache !== undefined) {
			return this.prCache;
		}

		const branch = this.footerData.getGitBranch();
		if (!branch || branch === "detached" || this.prLookupInFlight) {
			return null;
		}

		this.prLookupInFlight = true;
		void execFileAsync("gh", ["pr", "view", "--json", "number,url"], {
			cwd: process.cwd(),
			encoding: "utf8",
		})
			.then(({ stdout }) => {
				const parsed = JSON.parse(stdout) as { number?: number; url?: string };
				if (typeof parsed.number === "number" && typeof parsed.url === "string") {
					this.prCache = { number: parsed.number, url: parsed.url };
				} else {
					this.prCache = null;
				}
			})
			.catch(() => {
				this.prCache = null;
			})
			.finally(() => {
				this.prLookupInFlight = false;
				this.onChange?.();
			});

		return null;
	}

	private getTokensPerSecond(): number | null {
		const entries = this.session.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const assistant = entry.message as AssistantMessageWithMetrics;
			if (!assistant.duration || assistant.duration <= 0 || assistant.stopReason === "error") continue;
			if (!assistant.usage.output) continue;
			return (assistant.usage.output * 1000) / assistant.duration;
		}
		return null;
	}

	private resolveSettings(): Required<
		Pick<StatusLineSettings, "leftSegments" | "rightSegments" | "separator" | "segmentOptions" | "showHookStatus">
	> &
		StatusLineSettings {
		const presetName = this.settings.preset ?? "default";
		const preset = getPreset(presetName);
		const useCustomSegments = presetName === "custom";
		return {
			...this.settings,
			leftSegments: useCustomSegments ? (this.settings.leftSegments ?? preset.leftSegments) : preset.leftSegments,
			rightSegments: useCustomSegments
				? (this.settings.rightSegments ?? preset.rightSegments)
				: preset.rightSegments,
			separator: this.settings.separator ?? preset.separator,
			segmentOptions: { ...(preset.segmentOptions ?? {}), ...(this.settings.segmentOptions ?? {}) },
			showHookStatus: this.settings.showHookStatus ?? true,
		};
	}

	private buildContext(width: number, preset: StatusLinePreset): SegmentContext {
		const extensionStatuses = this.footerData.getExtensionStatuses();
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let cost = 0;
		let premiumRequests = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const assistant = entry.message as AssistantMessageWithMetrics;
			input += assistant.usage.input;
			output += assistant.usage.output;
			cacheRead += assistant.usage.cacheRead;
			cacheWrite += assistant.usage.cacheWrite;
			cost += assistant.usage.cost.total;
			premiumRequests += assistant.usage.premiumRequests ?? 0;
		}

		const contextUsage = this.session.getContextUsage();

		return {
			session: this.session,
			footerData: this.footerData,
			width,
			preset,
			options: this.resolveSettings().segmentOptions ?? {},
			usageStats: {
				input,
				output,
				cacheRead,
				cacheWrite,
				cost,
				premiumRequests,
				toolCalls: this.toolCallCount,
				toolDurationMs: this.toolDurationMs,
				tokensPerSecond: this.getTokensPerSecond(),
			},
			contextPercent: contextUsage?.percent ?? null,
			contextWindow: contextUsage?.contextWindow ?? this.session.state.model?.contextWindow ?? 0,
			autoCompactEnabled: this.autoCompactEnabled,
			subagentCount: Math.max(this.subagentCount, inferSubagentCount(extensionStatuses)),
			sessionStartTime: this.sessionStartTime,
			planMode: this.planModeStatus,
			git: {
				branch: this.footerData.getGitBranch(),
				status: this.getGitStatus(),
				pr: this.lookupPr(),
			},
		};
	}

	private buildLine(width: number): string {
		const settings = this.resolveSettings();
		const ctx = this.buildContext(width, settings.preset ?? "default");
		const separator = getSeparator(settings.separator);

		const left = settings.leftSegments
			.map((segmentId) => renderSegment(segmentId, ctx))
			.filter((segment) => segment.visible && segment.content.length > 0)
			.map((segment) => segment.content);
		const right = settings.rightSegments
			.map((segmentId) => renderSegment(segmentId, ctx))
			.filter((segment) => segment.visible && segment.content.length > 0)
			.map((segment) => segment.content);

		let leftLine = left.join(separator.left);
		let rightLine = right.join(separator.right);

		if (!leftLine && !rightLine) {
			return "";
		}

		const bgAnsi = theme.getBgAnsi("statusLineBg");
		const fgAnsi = theme.getFgAnsi("text");
		const sepAnsi = theme.getFgAnsi("statusLineSep");
		const leftSepWidth = visibleWidth(separator.left);
		const rightSepWidth = visibleWidth(separator.right);
		const leftCapWidth = separator.endCaps ? visibleWidth(separator.endCaps.right) : 0;
		const rightCapWidth = separator.endCaps ? visibleWidth(separator.endCaps.left) : 0;

		const groupWidth = (parts: string[], capWidth: number, sepWidth: number): number => {
			if (parts.length === 0) return 0;
			const partsWidth = parts.reduce((sum, part) => sum + visibleWidth(part), 0);
			const sepTotal = Math.max(0, parts.length - 1) * (sepWidth + 2);
			return partsWidth + sepTotal + 2 + capWidth;
		};

		let leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
		let rightWidth = groupWidth(right, rightCapWidth, rightSepWidth);
		const totalWidth = () => leftWidth + rightWidth + (left.length > 0 && right.length > 0 ? 1 : 0);

		if (width > 0) {
			while (totalWidth() > width && right.length > 0) {
				right.pop();
				rightWidth = groupWidth(right, rightCapWidth, rightSepWidth);
			}
			while (totalWidth() > width && left.length > 0) {
				left.pop();
				leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
			}
		}

		const renderGroup = (parts: string[], direction: "left" | "right"): string => {
			if (parts.length === 0) return "";

			const sep = direction === "left" ? separator.left : separator.right;
			const cap = separator.endCaps ? (direction === "left" ? separator.endCaps.right : separator.endCaps.left) : "";
			const capPrefix = separator.endCaps?.useBgAsFg ? bgAnsi.replace("[48;", "[38;") : `${bgAnsi}${sepAnsi}`;
			const capText = cap ? `${capPrefix}${cap}\x1b[0m` : "";

			let content = `${bgAnsi}${fgAnsi}`;
			content += ` ${parts.join(` ${sepAnsi}${sep}${fgAnsi} `)} `;
			content += "\x1b[0m";

			if (!capText) {
				return content;
			}
			return direction === "right" ? capText + content : content + capText;
		};

		leftLine = renderGroup(left, "left");
		rightLine = renderGroup(right, "right");

		if (!leftLine && !rightLine) {
			return "";
		}
		if (width === 0 || left.length === 0 || right.length === 0) {
			return leftLine + (leftLine && rightLine ? " " : "") + rightLine;
		}

		leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
		rightWidth = groupWidth(right, rightCapWidth, rightSepWidth);
		const gapWidth = Math.max(1, width - leftWidth - rightWidth);
		return leftLine + theme.fg("border", "─".repeat(gapWidth)) + rightLine;
	}

	getTopBorder(width: number): { content: string; width: number } {
		const content = this.buildLine(width);
		return {
			content,
			width: visibleWidth(content),
		};
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.renderMainLineInBody) {
			const mainLine = this.buildLine(width);
			if (mainLine) {
				lines.push(mainLine);
			}
		}
		const settings = this.resolveSettings();
		if (settings.showHookStatus) {
			const statuses = Array.from(this.footerData.getExtensionStatuses().entries())
				.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
				.map(([, text]) => sanitizeStatusText(text))
				.filter(Boolean);
			if (statuses.length > 0) {
				lines.push(theme.fg("dim", truncateToWidth(statuses.join(" "), width, "...")));
			}
		}
		return lines.filter(Boolean);
	}
}
