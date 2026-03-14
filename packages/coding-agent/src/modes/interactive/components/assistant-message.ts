import type { AssistantMessage } from "@apholdings/jensen-ai";
import { Container, Markdown, type MarkdownTheme, Spacer, Text } from "@apholdings/jensen-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private lastMessage?: AssistantMessage;
	private topSpacing: number;
	private bottomSpacing: number;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		topSpacing = 1,
		bottomSpacing = 1,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.topSpacing = Math.max(0, topSpacing);
		this.bottomSpacing = Math.max(0, bottomSpacing);

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
	}

	setSpacing(topSpacing: number, bottomSpacing: number): void {
		this.topSpacing = Math.max(0, topSpacing);
		this.bottomSpacing = Math.max(0, bottomSpacing);

		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setTopSpacing(spacing: number): void {
		this.topSpacing = Math.max(0, spacing);

		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setBottomSpacing(spacing: number): void {
		this.bottomSpacing = Math.max(0, spacing);

		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		const hasToolCalls = message.content.some((c) => c.type === "toolCall");

		let renderedAnyBlock = false;

		if (hasVisibleContent && this.topSpacing > 0) {
			this.contentContainer.addChild(new Spacer(this.topSpacing));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];

			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, this.markdownTheme));
				renderedAnyBlock = true;
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
					renderedAnyBlock = true;

					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), 1, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					renderedAnyBlock = true;

					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";

				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
				renderedAnyBlock = true;
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";

				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
				renderedAnyBlock = true;
			}
		}

		// Only add bottom spacing for standalone assistant messages.
		// Do not add it when tool calls exist, because tool execution UI is rendered separately
		// and should remain visually attached to this assistant turn.
		if (!hasToolCalls && renderedAnyBlock && this.bottomSpacing > 0) {
			this.contentContainer.addChild(new Spacer(this.bottomSpacing));
		}
	}
}
