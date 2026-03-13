import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import { theme } from "../theme/theme.js";

type GitInfo = {
	inGitRepo: boolean;
	repoName?: string;
	branch?: string;
	dirty?: boolean;
};

type GitCache = {
	cwd: string;
	info: GitInfo;
	fetchedAt: number;
};

const GIT_CACHE_TTL_MS = 5000;

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatTokenCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

function shortenPath(input: string): string {
	const home = os.homedir();
	let p = input;

	if (home && p.startsWith(home)) {
		p = `~${p.slice(home.length)}`;
	}

	if (p === "/") return "/";

	const parts = p.split("/").filter(Boolean);
	if (parts.length <= 4) return p;

	const tail = parts.slice(-3).join("/");
	return p.startsWith("~") ? `~/…/${tail}` : `/…/${tail}`;
}

function shortenPathForWidth(input: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";

	const base = shortenPath(input);
	if (visibleWidth(base) <= maxWidth) return base;

	const root = base.startsWith("~") ? "~/" : "/";
	const parts = base.replace(/^~?\//, "").split("/").filter(Boolean);
	if (parts.length === 0) return truncateToWidth(base, maxWidth, "...");

	const compactParts = parts.map((part, i) => (i === parts.length - 1 ? part : (part[0] ?? part)));
	const compact = `${root}${compactParts.join("/")}`;
	if (visibleWidth(compact) <= maxWidth) return compact;

	const tailOnly = `${root}…/${parts[parts.length - 1]}`;
	if (visibleWidth(tailOnly) <= maxWidth) return tailOnly;

	return truncateToWidth(tailOnly, maxWidth, "...");
}

export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private gitCache: GitCache | null = null;

	constructor(
		private session: AgentSession,
		private footerData: ReadonlyFooterDataProvider,
	) {}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	invalidate(): void {
		this.gitCache = null;
	}

	dispose(): void {
		this.gitCache = null;
	}

	private getGitInfo(cwd: string): GitInfo {
		const now = Date.now();
		if (this.gitCache?.cwd === cwd && now - this.gitCache.fetchedAt < GIT_CACHE_TTL_MS) {
			return this.gitCache.info;
		}

		const providerBranch = this.footerData.getGitBranch();

		try {
			const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 500,
			}).trim();

			if (!repoRoot) {
				const fallbackInfo = providerBranch ? { inGitRepo: true, branch: providerBranch } : { inGitRepo: false };
				this.gitCache = { cwd, info: fallbackInfo, fetchedAt: now };
				return fallbackInfo;
			}

			const branch =
				providerBranch ||
				execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
					cwd,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
					timeout: 500,
				}).trim() ||
				undefined;

			const porcelain = execFileSync("git", ["status", "--porcelain", "-uno"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 500,
			}).trim();

			const info: GitInfo = {
				inGitRepo: true,
				repoName: path.basename(repoRoot),
				branch,
				dirty: porcelain.length > 0,
			};

			this.gitCache = { cwd, info, fetchedAt: now };
			return info;
		} catch {
			const fallbackInfo = providerBranch ? { inGitRepo: true, branch: providerBranch } : { inGitRepo: false };
			this.gitCache = { cwd, info: fallbackInfo, fetchedAt: now };
			return fallbackInfo;
		}
	}

	private getContextTokens(): string {
		const usage = this.session.getContextUsage();
		if (!usage || usage.tokens == null) return "--";

		const contextWindow =
			typeof usage.contextWindow === "number"
				? usage.contextWindow
				: (this.session.state.model?.contextWindow ?? null);

		if (contextWindow == null) {
			return formatTokenCount(usage.tokens);
		}

		return `${formatTokenCount(usage.tokens)}/${formatTokenCount(contextWindow)}`;
	}

	private getContextPercentValue(): number | null {
		const usage = this.session.getContextUsage();
		if (!usage || usage.percent == null) return null;
		return usage.percent;
	}

	private getContextPercentDisplay(): string {
		const percent = this.getContextPercentValue();
		if (percent == null) return "--";
		return `${percent.toFixed(1)}%${this.autoCompactEnabled ? " (auto)" : ""}`;
	}

	private getContextPercentColor(): "success" | "warning" | "error" {
		const percent = this.getContextPercentValue();
		if (percent == null) return "success";
		if (percent > 90) return "error";
		if (percent > 70) return "warning";
		return "success";
	}

	render(width: number): string[] {
		if (width <= 0) return [""];

		const cwd = process.cwd();
		const git = this.getGitInfo(cwd);
		const separator = theme.fg("dim", " · ");

		let cwdLabel = shortenPath(cwd);

		const leftMetaParts: string[] = [
			theme.fg("dim", "host ") + theme.fg("muted", `${os.userInfo().username}@${os.hostname()}`),
		];

		if (git.inGitRepo) {
			if (git.repoName) {
				leftMetaParts.push(theme.fg("dim", "repo ") + theme.fg("toolTitle", git.repoName));
			}
			if (git.branch) {
				const branchDisplay = git.dirty ? `${git.branch}*` : git.branch;
				leftMetaParts.push(
					theme.fg("dim", "branch ") + theme.fg(git.dirty ? "warning" : "borderAccent", branchDisplay),
				);
			}
		}

		const rightParts = [
			theme.fg("dim", "tok ") + theme.fg("success", this.getContextTokens()),
			theme.fg("dim", "ctx ") + theme.fg(this.getContextPercentColor(), this.getContextPercentDisplay()),
		];

		const ellipsis = theme.fg("dim", "...");
		const minGap = 1;

		let right = `${rightParts.join(separator)} `;
		let left = ` ${theme.fg("accent", cwdLabel)}${
			leftMetaParts.length > 0 ? separator + leftMetaParts.join(separator) : ""
		}`;

		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		let footerLine: string;

		if (leftWidth + minGap + rightWidth <= width) {
			const gap = Math.max(minGap, width - leftWidth - rightWidth);
			footerLine = left + " ".repeat(gap) + right;
		} else {
			const maxRight = Math.max(12, Math.floor(width * 0.55));
			right = truncateToWidth(right, Math.min(rightWidth, maxRight), ellipsis);

			const rightFitWidth = visibleWidth(right);
			const availableLeft = Math.max(0, width - minGap - rightFitWidth);

			if (availableLeft > 0) {
				const meta = leftMetaParts.length > 0 ? separator + leftMetaParts.join(separator) : "";
				const fixedLeftWidth = visibleWidth(` ${meta}`);
				const cwdBudget = Math.max(1, availableLeft - fixedLeftWidth);

				cwdLabel = shortenPathForWidth(cwd, cwdBudget);
				left = ` ${theme.fg("accent", cwdLabel)}${meta}`;
				left = truncateToWidth(left, availableLeft, ellipsis);
			} else {
				left = "";
			}

			const leftFitWidth = visibleWidth(left);

			if (leftFitWidth === 0) {
				footerLine = truncateToWidth(right, width, ellipsis);
			} else {
				const gap = Math.max(minGap, width - leftFitWidth - rightFitWidth);
				footerLine = left + " ".repeat(gap) + right;
			}
		}

		footerLine = truncateToWidth(footerLine, width, ellipsis);
		const lines = [footerLine];

		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));

			const statusLine = sortedStatuses.join(" ");
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
