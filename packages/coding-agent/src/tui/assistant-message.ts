import type { AssistantMessage } from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private spacer: Spacer;
	private contentContainer: Container;
	private statsText: Text;

	constructor(message?: AssistantMessage) {
		super();

		// Add spacer before assistant message
		this.spacer = new Spacer(1);
		this.addChild(this.spacer);

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		// Stats text
		this.statsText = new Text("", 1, 0);
		this.addChild(this.statsText);

		if (message) {
			this.updateContent(message);
		}
	}

	updateContent(message: AssistantMessage): void {
		// Clear content container
		this.contentContainer.clear();

		// Check if there's any actual content (text or thinking)
		let hasContent = false;

		// Render content in order
		for (const content of message.content) {
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), undefined, undefined, undefined, 1, 0));
				hasContent = true;
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Thinking traces in dark gray italic
				// Apply styling to entire block so wrapping preserves it
				const thinkingText = chalk.gray.italic(content.thinking);
				this.contentContainer.addChild(new Text(thinkingText, 1, 0));
				this.contentContainer.addChild(new Spacer(1));
				hasContent = true;
			}
		}

		// Check if aborted - show after partial content
		if (message.stopReason === "aborted") {
			this.contentContainer.addChild(new Text(chalk.red("Aborted")));
			hasContent = true;
		} else if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			this.contentContainer.addChild(new Text(chalk.red(`Error: ${errorMsg}`)));
			hasContent = true;
		}

		// Only update stats if there's actual content (not just tool calls)
		if (hasContent) {
			this.updateStats(message.usage);
		}
	}

	updateStats(usage: any): void {
		if (!usage) {
			this.statsText.setText("");
			return;
		}

		// Format token counts
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return (count / 1000).toFixed(1) + "k";
			return Math.round(count / 1000) + "k";
		};

		const statsParts = [];
		if (usage.input) statsParts.push(`↑${formatTokens(usage.input)}`);
		if (usage.output) statsParts.push(`↓${formatTokens(usage.output)}`);
		if (usage.cacheRead) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);
		if (usage.cost?.total) statsParts.push(`$${usage.cost.total.toFixed(3)}`);

		this.statsText.setText(chalk.gray(statsParts.join(" ")));
	}

	hideStats(): void {
		this.statsText.setText("");
	}
}
