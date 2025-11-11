import type { AssistantMessage } from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private spacer: Spacer;

	constructor(message: AssistantMessage) {
		super();

		// Add spacer before assistant message
		this.spacer = new Spacer(1);
		this.addChild(this.spacer);

		// Render content in order
		for (const content of message.content) {
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.addChild(new Markdown(content.text.trim(), undefined, undefined, undefined, 1, 0));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Thinking traces in dark gray italic
				const thinkingText = content.thinking
					.split("\n")
					.map((line) => chalk.gray.italic(line))
					.join("\n");
				this.addChild(new Text(thinkingText, 1, 0));
			}
		}

		// Check if aborted - show after partial content
		if (message.stopReason === "aborted") {
			this.addChild(new Text(chalk.red("Aborted")));
			return;
		}

		if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			this.addChild(new Text(chalk.red(`Error: ${errorMsg}`)));
			return;
		}
	}
}
