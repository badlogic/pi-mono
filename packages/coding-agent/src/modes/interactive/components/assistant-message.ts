import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
	type CodeBlockInfo,
	Container,
	Markdown,
	type MarkdownOptions,
	type MarkdownTheme,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

export type CodeBlockRegistry = {
	register(info: CodeBlockInfo, owner: Markdown): void;
	clearPrefix(prefix: string): void;
};

const CODE_FENCE_REGEX = /^\s*```/;

function countCodeBlocks(text: string): number {
	let count = 0;
	let inFence = false;
	for (const line of text.split(/\r?\n/)) {
		if (CODE_FENCE_REGEX.test(line)) {
			if (!inFence) {
				count += 1;
			}
			inFence = !inFence;
		}
	}
	return count;
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private lastMessage?: AssistantMessage;
	private codeBlockRegistry?: CodeBlockRegistry;
	private showCodeBlockLabels = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		codeBlockRegistry?: CodeBlockRegistry,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.codeBlockRegistry = codeBlockRegistry;

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

	setShowCodeBlockLabels(show: boolean): void {
		if (this.showCodeBlockLabels === show) {
			return;
		}
		this.showCodeBlockLabels = show;
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

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		let codeBlockLabelOffset = 0;

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				const prefix = `am-${message.timestamp}-${i}-`;
				const trimmedText = content.text.trim();
				this.codeBlockRegistry?.clearPrefix(prefix);
				let markdown: Markdown | undefined;
				const labelOffset = this.showCodeBlockLabels ? codeBlockLabelOffset : undefined;
				if (this.showCodeBlockLabels) {
					codeBlockLabelOffset += countCodeBlocks(trimmedText);
				}
				const options: MarkdownOptions | undefined = this.codeBlockRegistry
					? {
							codeBlockIdPrefix: prefix,
							codeBlockLabel: this.showCodeBlockLabels ? ({ index }) => `[#${index}]` : undefined,
							codeBlockLabelOffset: labelOffset,
							onCodeBlock: (info: CodeBlockInfo) => {
								if (markdown) {
									this.codeBlockRegistry?.register(info, markdown);
								}
							},
						}
					: undefined;

				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				markdown = new Markdown(trimmedText, 1, 0, this.markdownTheme, undefined, options);
				this.contentContainer.addChild(markdown);
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Check if there's text content after this thinking block
				const hasTextAfter = message.content.slice(i + 1).some((c) => c.type === "text" && c.text.trim());

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
					if (hasTextAfter) {
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
					this.contentContainer.addChild(new Spacer(1));
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
}
