import * as os from "node:os";
import { visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../../theme/theme.js";
import { formatExecutionDuration } from "../tool-ui.js";
import type { RenderedSegment, SegmentContext, StatusLineSegment, StatusLineSegmentId } from "./types.js";

function formatNumber(value: number): string {
	if (value < 1000) return String(value);
	if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

function shortenPath(input: string, maxLength: number): string {
	if (input.length <= maxLength) return input;
	const keep = Math.max(4, maxLength - 1);
	return `…${input.slice(-(keep - 1))}`;
}

function getIcon(ctx: SegmentContext, kind: string): string {
	if (ctx.preset === "ascii") return "";

	const icons: Record<string, string> = {
		pi: "π",
		model: "◉",
		path: "⌂",
		git: "⑂",
		pr: "#",
		host: "@",
		session: "○",
		subagents: "◫",
		input: "↑",
		output: "↓",
		tokens: "Σ",
		cache: "C",
		context: "%",
		time: "⏱",
	};

	return icons[kind] ? `${icons[kind]} ` : "";
}

function maybeWithIcon(ctx: SegmentContext, kind: string, text: string): string {
	return `${getIcon(ctx, kind)}${text}`;
}

function getModelLabel(ctx: SegmentContext): string {
	const model = ctx.session.state.model;
	if (!model) return "no-model";
	let label = model.name || model.id;
	if (label.startsWith("Claude ")) {
		label = label.slice("Claude ".length);
	}
	const showThinking = ctx.options.model?.showThinkingLevel !== false;
	if (showThinking && model.reasoning) {
		const level = ctx.session.state.thinkingLevel || "off";
		if (level !== "off") {
			label += ` · ${level}`;
		}
	}
	if (ctx.footerData.getAvailableProviderCount() > 1) {
		label = `${model.provider}:${label}`;
	}
	return label;
}

const piSegment: StatusLineSegment = {
	id: "pi",
	render(ctx) {
		return { content: theme.bold(theme.fg("accent", maybeWithIcon(ctx, "pi", "pi"))), visible: true };
	},
};

const modelSegment: StatusLineSegment = {
	id: "model",
	render(ctx) {
		return { content: theme.fg("statusLineModel", maybeWithIcon(ctx, "model", getModelLabel(ctx))), visible: true };
	},
};

const planModeSegment: StatusLineSegment = {
	id: "plan_mode",
	render(ctx) {
		if (!ctx.planMode?.enabled && !ctx.planMode?.paused) {
			return { content: "", visible: false };
		}
		const label = ctx.planMode?.paused ? "plan paused" : "plan";
		return { content: theme.fg("warning", label), visible: true };
	},
};

const pathSegment: StatusLineSegment = {
	id: "path",
	render(ctx) {
		const opts = ctx.options.path ?? {};
		const home = process.env.HOME || process.env.USERPROFILE;
		let cwd = process.cwd();
		if (home && cwd.startsWith(home)) cwd = `~${cwd.slice(home.length)}`;
		if (opts.stripWorkPrefix !== false) {
			if (cwd.startsWith("/work/")) cwd = cwd.slice(6);
			if (cwd.startsWith("~/Projects/")) cwd = cwd.slice(11);
		}
		if (opts.abbreviate !== false) {
			cwd = shortenPath(cwd, opts.maxLength ?? 40);
		}
		return { content: theme.fg("statusLinePath", maybeWithIcon(ctx, "path", cwd)), visible: true };
	},
};

const gitSegment: StatusLineSegment = {
	id: "git",
	render(ctx) {
		const opts = ctx.options.git ?? {};
		const branch = ctx.git.branch;
		const status = ctx.git.status;
		if (!branch && !status) return { content: "", visible: false };

		let content = "";
		if (opts.showBranch !== false && branch) {
			content = maybeWithIcon(ctx, "git", branch);
		}

		const indicators: string[] = [];
		if (status) {
			if (opts.showUnstaged !== false && status.unstaged > 0) {
				indicators.push(theme.fg("statusLineDirty", `*${status.unstaged}`));
			}
			if (opts.showStaged !== false && status.staged > 0) {
				indicators.push(theme.fg("statusLineStaged", `+${status.staged}`));
			}
			if (opts.showUntracked !== false && status.untracked > 0) {
				indicators.push(theme.fg("statusLineUntracked", `?${status.untracked}`));
			}
		}

		if (indicators.length > 0) {
			content = content ? `${content} ${indicators.join(" ")}` : indicators.join(" ");
		}

		if (!content) return { content: "", visible: false };
		const isDirty = Boolean(status && (status.staged || status.unstaged || status.untracked));
		return { content: theme.fg(isDirty ? "statusLineGitDirty" : "statusLineGitClean", content), visible: true };
	},
};

const prSegment: StatusLineSegment = {
	id: "pr",
	render(ctx) {
		if (!ctx.git.pr) return { content: "", visible: false };
		const label = maybeWithIcon(ctx, "pr", `${ctx.git.pr.number}`);
		return { content: theme.fg("accent", label), visible: true };
	},
};

const subagentsSegment: StatusLineSegment = {
	id: "subagents",
	render(ctx) {
		if (ctx.subagentCount <= 0) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineSubagents", maybeWithIcon(ctx, "subagents", `${ctx.subagentCount}`)),
			visible: true,
		};
	},
};

const toolCallsSegment: StatusLineSegment = {
	id: "tool_calls",
	render(ctx) {
		if (ctx.usageStats.toolCalls <= 0) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineSubagents", `tools ${formatNumber(ctx.usageStats.toolCalls)}`),
			visible: true,
		};
	},
};

const toolTimeSegment: StatusLineSegment = {
	id: "tool_time",
	render(ctx) {
		const duration = formatExecutionDuration(ctx.usageStats.toolDurationMs);
		if (!duration) return { content: "", visible: false };
		return {
			content: theme.fg("dim", `tool ${duration}`),
			visible: true,
		};
	},
};

const tokenInSegment: StatusLineSegment = {
	id: "token_in",
	render(ctx) {
		if (!ctx.usageStats.input) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineSpend", maybeWithIcon(ctx, "input", formatNumber(ctx.usageStats.input))),
			visible: true,
		};
	},
};

const tokenOutSegment: StatusLineSegment = {
	id: "token_out",
	render(ctx) {
		if (!ctx.usageStats.output) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineOutput", maybeWithIcon(ctx, "output", formatNumber(ctx.usageStats.output))),
			visible: true,
		};
	},
};

const tokenTotalSegment: StatusLineSegment = {
	id: "token_total",
	render(ctx) {
		const total = ctx.usageStats.input + ctx.usageStats.output + ctx.usageStats.cacheRead + ctx.usageStats.cacheWrite;
		if (!total) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineSpend", maybeWithIcon(ctx, "tokens", formatNumber(total))),
			visible: true,
		};
	},
};

const tokenRateSegment: StatusLineSegment = {
	id: "token_rate",
	render(ctx) {
		if (!ctx.usageStats.tokensPerSecond) return { content: "", visible: false };
		return {
			content: theme.fg(
				"statusLineOutput",
				maybeWithIcon(ctx, "output", `${ctx.usageStats.tokensPerSecond.toFixed(1)}/s`),
			),
			visible: true,
		};
	},
};

const cacheReadSegment: StatusLineSegment = {
	id: "cache_read",
	render(ctx) {
		if (!ctx.usageStats.cacheRead) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineSpend", `${getIcon(ctx, "cache")}R${formatNumber(ctx.usageStats.cacheRead)}`),
			visible: true,
		};
	},
};

const cacheWriteSegment: StatusLineSegment = {
	id: "cache_write",
	render(ctx) {
		if (!ctx.usageStats.cacheWrite) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineOutput", `${getIcon(ctx, "cache")}W${formatNumber(ctx.usageStats.cacheWrite)}`),
			visible: true,
		};
	},
};

const costSegment: StatusLineSegment = {
	id: "cost",
	render(ctx) {
		const usingSubscription = ctx.session.state.model
			? ctx.session.modelRegistry.isUsingOAuth(ctx.session.state.model)
			: false;
		if (!ctx.usageStats.cost && !ctx.usageStats.premiumRequests && !usingSubscription) {
			return { content: "", visible: false };
		}
		const parts: string[] = [];
		if (ctx.usageStats.cost) parts.push(`$${ctx.usageStats.cost.toFixed(3)}`);
		if (ctx.usageStats.premiumRequests) parts.push(`★ ${formatNumber(ctx.usageStats.premiumRequests)}`);
		if (usingSubscription) parts.push("(sub)");
		return { content: theme.fg("statusLineCost", parts.join(" ")), visible: true };
	},
};

const contextPctSegment: StatusLineSegment = {
	id: "context_pct",
	render(ctx) {
		const autoSuffix = ctx.autoCompactEnabled ? " auto" : "";
		if (ctx.contextPercent === null) {
			return {
				content: theme.fg(
					"statusLineContext",
					maybeWithIcon(ctx, "context", `?/${formatNumber(ctx.contextWindow)}${autoSuffix}`),
				),
				visible: true,
			};
		}
		const text = `${ctx.contextPercent.toFixed(1)}%/${formatNumber(ctx.contextWindow)}${autoSuffix}`;
		const color = ctx.contextPercent > 90 ? "error" : ctx.contextPercent > 70 ? "warning" : "statusLineContext";
		return { content: theme.fg(color, maybeWithIcon(ctx, "context", text)), visible: true };
	},
};

const contextTotalSegment: StatusLineSegment = {
	id: "context_total",
	render(ctx) {
		if (!ctx.contextWindow) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineContext", maybeWithIcon(ctx, "context", formatNumber(ctx.contextWindow))),
			visible: true,
		};
	},
};

const timeSpentSegment: StatusLineSegment = {
	id: "time_spent",
	render(ctx) {
		const elapsedMs = Date.now() - ctx.sessionStartTime;
		if (elapsedMs < 1000) return { content: "", visible: false };
		const elapsedSeconds = Math.floor(elapsedMs / 1000);
		const minutes = Math.floor(elapsedSeconds / 60);
		const seconds = elapsedSeconds % 60;
		const text = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
		return { content: theme.fg("dim", maybeWithIcon(ctx, "time", text)), visible: true };
	},
};

const timeSegment: StatusLineSegment = {
	id: "time",
	render(ctx) {
		const opts = ctx.options.time ?? {};
		const now = new Date();
		let hours = now.getHours();
		let suffix = "";
		if (opts.format === "12h") {
			suffix = hours >= 12 ? "pm" : "am";
			hours = hours % 12 || 12;
		}
		let text = `${String(hours).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		if (opts.showSeconds) {
			text += `:${String(now.getSeconds()).padStart(2, "0")}`;
		}
		text += suffix;
		return { content: theme.fg("dim", maybeWithIcon(ctx, "time", text)), visible: true };
	},
};

const sessionSegment: StatusLineSegment = {
	id: "session",
	render(ctx) {
		const sessionName = ctx.session.sessionManager.getSessionName();
		const sessionId = ctx.session.sessionManager.getSessionId().slice(0, 8);
		const label = sessionName ? `${sessionName}:${sessionId}` : sessionId;
		return { content: theme.fg("muted", maybeWithIcon(ctx, "session", label)), visible: true };
	},
};

const hostnameSegment: StatusLineSegment = {
	id: "hostname",
	render(ctx) {
		const label = os.hostname().split(".")[0] || "host";
		return { content: theme.fg("muted", maybeWithIcon(ctx, "host", label)), visible: true };
	},
};

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
	pi: piSegment,
	model: modelSegment,
	plan_mode: planModeSegment,
	path: pathSegment,
	git: gitSegment,
	pr: prSegment,
	subagents: subagentsSegment,
	tool_calls: toolCallsSegment,
	tool_time: toolTimeSegment,
	token_in: tokenInSegment,
	token_out: tokenOutSegment,
	token_total: tokenTotalSegment,
	token_rate: tokenRateSegment,
	cache_read: cacheReadSegment,
	cache_write: cacheWriteSegment,
	cost: costSegment,
	context_pct: contextPctSegment,
	context_total: contextTotalSegment,
	time_spent: timeSpentSegment,
	time: timeSegment,
	session: sessionSegment,
	hostname: hostnameSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
	return SEGMENTS[id].render(ctx);
}

export function trimToWidth(content: string, maxWidth: number): string {
	if (visibleWidth(content) <= maxWidth) return content;
	let result = "";
	for (const char of content) {
		const candidate = result + char;
		if (visibleWidth(candidate) > maxWidth - 1) break;
		result = candidate;
	}
	return `${result}…`;
}
