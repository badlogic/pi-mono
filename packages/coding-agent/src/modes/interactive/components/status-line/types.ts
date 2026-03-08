import type { AgentSession } from "../../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../../core/footer-data-provider.js";
import type {
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSegmentOptions,
	StatusLineSeparatorStyle,
} from "../../../../core/status-line-settings.js";

export type {
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSegmentOptions,
	StatusLineSeparatorStyle,
	StatusLineSettings,
} from "../../../../core/status-line-settings.js";

export interface SegmentContext {
	session: AgentSession;
	footerData: ReadonlyFooterDataProvider;
	width: number;
	preset: StatusLinePreset;
	options: StatusLineSegmentOptions;
	usageStats: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		premiumRequests: number;
		toolCalls: number;
		toolDurationMs: number;
		tokensPerSecond: number | null;
	};
	contextPercent: number | null;
	contextWindow: number;
	autoCompactEnabled: boolean;
	subagentCount: number;
	sessionStartTime: number;
	planMode: { enabled: boolean; paused: boolean } | null;
	git: {
		branch: string | null;
		status: { staged: number; unstaged: number; untracked: number } | null;
		pr: { number: number; url: string } | null;
	};
}

export interface RenderedSegment {
	content: string;
	visible: boolean;
}

export interface StatusLineSegment {
	id: StatusLineSegmentId;
	render(ctx: SegmentContext): RenderedSegment;
}

export interface PresetDef {
	leftSegments: StatusLineSegmentId[];
	rightSegments: StatusLineSegmentId[];
	separator: StatusLineSeparatorStyle;
	segmentOptions?: StatusLineSegmentOptions;
}
