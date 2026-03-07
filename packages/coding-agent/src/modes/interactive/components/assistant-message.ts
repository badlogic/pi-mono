import type { AssistantMessage } from "@mariozechner/pi-ai";
import { type Component, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private lastMessage?: AssistantMessage;
	private streamingMode = false;
	private streamingSpacer?: Spacer;
	private streamingTextComponent?: Text;
	private streamingErrorSpacer?: Spacer;
	private streamingErrorTextComponent?: Text;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;

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
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setStreamingMode(streaming: boolean): void {
		if (this.streamingMode === streaming) {
			return;
		}
		this.streamingMode = streaming;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		if (this.streamingMode) {
			this.updateStreamingContent(message);
			return;
		}

		this.updateRichContent(message);
	}

	private updateRichContent(message: AssistantMessage): void {
		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, this.markdownTheme));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
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
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleContent) {
					this.contentContainer.addChild(new Spacer(1));
				} else {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}

	private updateStreamingContent(message: AssistantMessage): void {
		const visibleText = this.buildStreamingText(message);
		const errorText = this.getStreamingErrorText(message);

		const children: Component[] = [];

		if (visibleText) {
			if (!this.streamingSpacer) {
				this.streamingSpacer = new Spacer(1);
			}
			if (!this.streamingTextComponent) {
				this.streamingTextComponent = new Text(visibleText, 1, 0);
			} else {
				this.streamingTextComponent.setText(visibleText);
			}
			children.push(this.streamingSpacer, this.streamingTextComponent);
		}

		if (errorText) {
			if (!this.streamingErrorSpacer) {
				this.streamingErrorSpacer = new Spacer(1);
			}
			if (!this.streamingErrorTextComponent) {
				this.streamingErrorTextComponent = new Text(errorText, 1, 0);
			} else {
				this.streamingErrorTextComponent.setText(errorText);
			}
			children.push(this.streamingErrorSpacer, this.streamingErrorTextComponent);
		}

		this.contentContainer.children = children;
	}

	private buildStreamingText(message: AssistantMessage): string {
		const blocks: string[] = [];

		for (const content of message.content) {
			if (content.type === "text" && content.text.trim()) {
				blocks.push(content.text.trim());
			} else if (content.type === "thinking" && content.thinking.trim()) {
				if (this.hideThinkingBlock) {
					blocks.push(theme.italic(theme.fg("thinkingText", "Thinking...")));
				} else {
					blocks.push(theme.italic(theme.fg("thinkingText", content.thinking.trim())));
				}
			}
		}

		return blocks.join("\n\n");
	}

	private getStreamingErrorText(message: AssistantMessage): string | undefined {
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (hasToolCalls) {
			return undefined;
		}

		if (message.stopReason === "aborted") {
			const abortMessage =
				message.errorMessage && message.errorMessage !== "Request was aborted"
					? message.errorMessage
					: "Operation aborted";
			return theme.fg("error", abortMessage);
		}

		if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			return theme.fg("error", `Error: ${errorMsg}`);
		}

		return undefined;
	}
}
