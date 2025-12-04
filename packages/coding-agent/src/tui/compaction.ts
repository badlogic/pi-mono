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
		this.addChild(new Spacer(1));

		if (this.expanded) {
			// Show header + summary as markdown (like user message)
			const header = `**Context compacted from ${this.tokensBefore.toLocaleString()} tokens**\n\n`;
			this.addChild(
				new Markdown(header + this.summary, 1, 1, getMarkdownTheme(), {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}),
			);
		} else {
			// Collapsed: just show the header line with user message styling
			const isMac = process.platform === "darwin";
			const shortcut = isMac ? "CMD+O" : "CTRL+O";
			this.addChild(
				new Text(
					theme.fg("userMessageText", `--- Earlier messages compacted (${shortcut} to expand) ---`),
					1,
					1,
					(text: string) => theme.bg("userMessageBg", text),
				),
			);
		}
		this.addChild(new Spacer(1));
	}
}
