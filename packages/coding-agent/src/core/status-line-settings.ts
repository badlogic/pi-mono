export const STATUS_LINE_PRESETS = ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"] as const;
export type StatusLinePreset = (typeof STATUS_LINE_PRESETS)[number];

export const STATUS_LINE_SEPARATOR_STYLES = [
	"powerline",
	"powerline-thin",
	"slash",
	"pipe",
	"block",
	"none",
	"ascii",
] as const;
export type StatusLineSeparatorStyle = (typeof STATUS_LINE_SEPARATOR_STYLES)[number];

export const STATUS_LINE_SEGMENTS = [
	"pi",
	"model",
	"plan_mode",
	"path",
	"git",
	"pr",
	"subagents",
	"tool_calls",
	"tool_time",
	"token_in",
	"token_out",
	"token_total",
	"token_rate",
	"cost",
	"context_pct",
	"context_total",
	"time_spent",
	"time",
	"session",
	"hostname",
	"cache_read",
	"cache_write",
] as const;
export type StatusLineSegmentId = (typeof STATUS_LINE_SEGMENTS)[number];

export interface StatusLineSegmentOptions {
	model?: { showThinkingLevel?: boolean };
	path?: { abbreviate?: boolean; maxLength?: number; stripWorkPrefix?: boolean };
	git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean };
	time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

export interface StatusLineSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
	segmentOptions?: StatusLineSegmentOptions;
	showHookStatus?: boolean;
}
