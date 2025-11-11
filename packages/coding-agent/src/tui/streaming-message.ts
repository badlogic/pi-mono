import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a streaming message with live updates
 */
export class StreamingMessageComponent extends Container {
	private spacer: Spacer;
	private markdown: Markdown;
	private statsText: Text;

	constructor() {
		super();
		this.spacer = new Spacer(1);
		this.markdown = new Markdown("");
		this.statsText = new Text("", 1, 0);
		this.addChild(this.spacer);
		this.addChild(this.markdown);
		this.addChild(this.statsText);
	}

	updateContent(message: Message | null) {
		if (!message) {
			this.markdown.setText("");
			this.statsText.setText("");
			return;
		}

		if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;

			// Update text and thinking content
			let combinedContent = "";
			for (const c of assistantMsg.content) {
				if (c.type === "text") {
					combinedContent += c.text;
				} else if (c.type === "thinking") {
					// Add thinking in italic
					const thinkingLines = c.thinking
						.split("\n")
						.map((line) => `*${line}*`)
						.join("\n");
					if (combinedContent && !combinedContent.endsWith("\n")) combinedContent += "\n";
					combinedContent += thinkingLines;
					if (!combinedContent.endsWith("\n")) combinedContent += "\n";
				}
			}

			this.markdown.setText(combinedContent);

			// Update usage stats
			const usage = assistantMsg.usage;
			if (usage) {
				// Format token counts (similar to web-ui)
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
			} else {
				this.statsText.setText("");
			}
		}
	}
}
