import { Container, Markdown, Spacer } from "@mariozechner/pi-tui";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private spacer: Spacer | null = null;
	private markdown: Markdown;

	constructor(text: string, isFirst: boolean) {
		super();

		// Add spacer before user message (except first one)
		if (!isFirst) {
			this.spacer = new Spacer(1);
			this.addChild(this.spacer);
		}

		// User messages with dark gray background
		this.markdown = new Markdown(text, undefined, undefined, { r: 52, g: 53, b: 65 });
		this.addChild(this.markdown);
	}
}
