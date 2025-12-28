import { Container, Markdown, Spacer } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string) {
		super();
		this.addChild(new Spacer(1));
		this.addChild(
			new Markdown(text, 1, 1, getMarkdownTheme(), {
				bgColor: (text: string) => theme.bg("userMessageBg", text),
				color: (text: string) => theme.fg("userMessageText", text),
			}),
		);
	}
}
