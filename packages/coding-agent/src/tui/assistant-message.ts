import type { AssistantMessage } from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;

	constructor(message?: AssistantMessage) {
		super();

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	updateContent(message: AssistantMessage): void {
		// Clear content container
		this.contentContainer.clear();

		if (
			message.content.length > 0 &&
			message.content.some(
				(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
			)
		) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (const content of message.content) {
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), undefined, undefined, undefined, 1, 0));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Thinking traces in dark gray italic
				// Use Markdown component because it preserves ANSI codes across wrapped lines
				const thinkingText = chalk.gray.italic(content.thinking);
				this.contentContainer.addChild(new Markdown(thinkingText, undefined, undefined, undefined, 1, 0));
				this.contentContainer.addChild(new Spacer(1));
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				this.contentContainer.addChild(new Text(chalk.red("\nAborted"), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(chalk.red(`Error: ${errorMsg}`), 1, 0));
			}
		}
	}
}
