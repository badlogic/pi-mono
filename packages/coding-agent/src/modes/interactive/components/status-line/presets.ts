import type { PresetDef, StatusLinePreset } from "./types.js";

export const STATUS_LINE_PRESETS: Record<StatusLinePreset, PresetDef> = {
	default: {
		leftSegments: ["pi", "model", "path", "git", "pr", "context_pct", "token_total", "cost"],
		rightSegments: [],
		separator: "powerline-thin",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
	},
	minimal: {
		leftSegments: ["path", "git"],
		rightSegments: ["context_pct"],
		separator: "slash",
		segmentOptions: {
			path: { abbreviate: true, maxLength: 30, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
		},
	},
	compact: {
		leftSegments: ["model", "git", "pr"],
		rightSegments: ["cost", "context_pct"],
		separator: "powerline-thin",
		segmentOptions: {
			model: { showThinkingLevel: false },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
		},
	},
	full: {
		leftSegments: ["pi", "hostname", "model", "path", "git", "pr", "subagents"],
		rightSegments: [
			"tool_calls",
			"tool_time",
			"token_in",
			"token_out",
			"token_rate",
			"cache_read",
			"cost",
			"context_pct",
			"time_spent",
			"time",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 50, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: false },
		},
	},
	nerd: {
		leftSegments: ["pi", "hostname", "model", "path", "git", "pr", "session", "subagents"],
		rightSegments: [
			"tool_calls",
			"tool_time",
			"token_in",
			"token_out",
			"cache_read",
			"cache_write",
			"token_rate",
			"cost",
			"context_pct",
			"context_total",
			"time_spent",
			"time",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 60, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: true },
		},
	},
	ascii: {
		leftSegments: ["model", "path", "git", "pr"],
		rightSegments: ["token_total", "cost", "context_pct"],
		separator: "ascii",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: false },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
	},
	custom: {
		leftSegments: ["model", "path", "git", "pr"],
		rightSegments: ["token_total", "cost", "context_pct"],
		separator: "powerline-thin",
		segmentOptions: {},
	},
};

export function getPreset(name: StatusLinePreset): PresetDef {
	return STATUS_LINE_PRESETS[name] ?? STATUS_LINE_PRESETS.default;
}
