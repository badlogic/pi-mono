import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a compaction indicator with collapsed/expanded state.
 * Collapsed: shows "Context compacted from X tokens"
 * Expanded: shows the full summary rendered as markdown (like a user message)
 */
export class CompactionComponent extends Container {
	private expanded = false;
	private tokensBefore: number;
	private summary: string;

	constructor(tokensBefore: number, summary: string) {
		super();
		this.tokensBefore = tokensBefore;
		this.summary = summary;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		if (this.expanded) {
			// Show header + summary as markdown (like user message)
			this.addChild(new Spacer(1));
			const header = `**Context compacted from ${this.tokensBefore.toLocaleString()} tokens**\n\n`;
			this.addChild(
				new Markdown(header + this.summary, 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}),
			);
			this.addChild(new Spacer(1));
		} else {
			// Collapsed: simple text in warning color with token count
			const tokenStr = this.tokensBefore.toLocaleString();
			this.addChild(
				new Text(
					theme.fg("warning", `Earlier messages compacted from ${tokenStr} tokens (ctrl+o to expand)`),
					1,
					1,
				),
			);
		}
	}
}
