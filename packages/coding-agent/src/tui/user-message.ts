import { Container, Markdown, Spacer } from "@mariozechner/pi-tui";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	constructor(text: string, isFirst: boolean) {
		super();

		// Add spacer before user message (except first one)
		if (!isFirst) {
			this.addChild(new Spacer(1));
		}
		this.addChild(new Markdown(text, 1, 1, { bgColor: "#343541" }));
	}
}
