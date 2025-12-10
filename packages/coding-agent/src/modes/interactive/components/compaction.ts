import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a compaction indicator with collapsed/expanded state.
 * Collapsed: shows "Earlier messages compacted from Xk tokens (Xs, cached)" or without timing
 * Expanded: shows the full summary rendered as markdown (like a user message)
 */
export class CompactionComponent extends Container {
	private expanded = false;
	private tokensBefore: number;
	private summary: string;
	private durationMs?: number;
	private usedCache?: boolean;

	constructor(tokensBefore: number, summary: string, durationMs?: number, usedCache?: boolean) {
		super();
		this.tokensBefore = tokensBefore;
		this.summary = summary;
		this.durationMs = durationMs;
		this.usedCache = usedCache;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	private formatTokens(tokens: number): string {
		if (tokens < 1000) return tokens.toString();
		if (tokens < 10000) return (tokens / 1000).toFixed(1) + "k";
		if (tokens < 1000000) return Math.round(tokens / 1000) + "k";
		return (tokens / 1000000).toFixed(1) + "M";
	}

	private formatDuration(ms: number): string {
		return `${(ms / 1000).toFixed(1)}s`;
	}

	private updateDisplay(): void {
		this.clear();

		if (this.expanded) {
			// Show header + summary as markdown (like user message)
			this.addChild(new Spacer(1));
			const header = `**Context compacted from ${this.formatTokens(this.tokensBefore)} tokens**\n\n`;
			this.addChild(
				new Markdown(header + this.summary, 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}),
			);
			this.addChild(new Spacer(1));
		} else {
			// Collapsed: "Earlier messages compacted from Xk tokens (Xs, cached)" or without timing
			const tokenStr = this.formatTokens(this.tokensBefore);
			let text = `Earlier messages compacted from ${tokenStr} tokens`;

			if (this.durationMs !== undefined) {
				const durationStr = this.formatDuration(this.durationMs);
				if (this.usedCache) {
					text += ` (${durationStr}, cached)`;
				} else {
					text += ` (${durationStr})`;
				}
			}

			text += " (ctrl+o to expand)";

			this.addChild(new Text(theme.fg("warning", text), 1, 1));
		}
	}
}
