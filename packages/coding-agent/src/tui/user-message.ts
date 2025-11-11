import { Container, Markdown, Spacer } from "@mariozechner/pi-tui";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private markdown: Markdown;

	constructor(text: string, isFirst: boolean) {
		super();

		// Add spacer before user message (except first one)
		if (!isFirst) {
			this.addChild(new Spacer(1));
		}

		// User messages with dark gray background
		this.markdown = new Markdown(text, undefined, undefined, { r: 52, g: 53, b: 65 });
		this.addChild(this.markdown);
	}
}
