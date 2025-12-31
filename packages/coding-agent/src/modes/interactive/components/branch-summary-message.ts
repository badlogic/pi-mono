import { Box, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { BranchSummaryMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a branch summary message with collapsed/expanded state.
 * Uses same background color as hook messages for visual consistency.
 */
export class BranchSummaryMessageComponent extends Box {
	private expanded = false;
	private message: BranchSummaryMessage;

	constructor(message: BranchSummaryMessage) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.message = message;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const label = theme.fg("customMessageLabel", `\x1b[1m[branch]\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const header = "**Branch Summary**\n\n";
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, getMarkdownTheme(), {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			this.addChild(new Text(theme.fg("customMessageText", "Branch summary (ctrl+o to expand)"), 0, 0));
		}
	}
}
