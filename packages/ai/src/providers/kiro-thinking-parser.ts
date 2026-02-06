import type { AssistantMessage, TextContent, ThinkingContent } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";

const THINKING_START_TAG = "<thinking>";
const THINKING_END_TAG = "</thinking>";

/**
 * Parses streaming text content and extracts <thinking>...</thinking> blocks.
 * Emits separate events for text and thinking content.
 */
export class ThinkingTagParser {
	private textBuffer = "";
	private inThinking = false;
	private thinkingExtracted = false;
	private thinkingBlockIndex: number | null = null;
	private textBlockIndex: number | null = null;

	constructor(
		private output: AssistantMessage,
		private stream: AssistantMessageEventStream,
	) {}

	/**
	 * Process a chunk of text content.
	 * Emits text_start, text_delta, thinking_start, thinking_delta, thinking_end events.
	 */
	processChunk(chunk: string): void {
		this.textBuffer += chunk;

		while (this.textBuffer.length > 0) {
			if (!this.inThinking && !this.thinkingExtracted) {
				this.processBeforeThinking();
				if (this.textBuffer.length === 0) break;
			}

			if (this.inThinking) {
				this.processInsideThinking();
				if (this.textBuffer.length === 0) break;
			}

			if (this.thinkingExtracted) {
				this.processAfterThinking();
				break;
			}
		}
	}

	/**
	 * Finalize any remaining buffered content.
	 * Call this when the stream ends.
	 */
	finalize(): void {
		if (this.textBuffer.length === 0) return;

		if (this.inThinking && this.thinkingBlockIndex !== null) {
			// Unclosed thinking tag - emit remaining as thinking
			const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
			block.thinking += this.textBuffer;
			this.stream.push({
				type: "thinking_delta",
				contentIndex: this.thinkingBlockIndex,
				delta: this.textBuffer,
				partial: this.output,
			});
			this.stream.push({
				type: "thinking_end",
				contentIndex: this.thinkingBlockIndex,
				content: block.thinking,
				partial: this.output,
			});
		} else if (this.textBlockIndex !== null) {
			// Remaining text
			const block = this.output.content[this.textBlockIndex] as TextContent;
			block.text += this.textBuffer;
			this.stream.push({
				type: "text_delta",
				contentIndex: this.textBlockIndex,
				delta: this.textBuffer,
				partial: this.output,
			});
		}

		this.textBuffer = "";
	}

	getTextBlockIndex(): number | null {
		return this.textBlockIndex;
	}

	private processBeforeThinking(): void {
		const startPos = this.textBuffer.indexOf(THINKING_START_TAG);
		if (startPos !== -1) {
			// Found thinking start tag
			const before = this.textBuffer.slice(0, startPos);
			if (before) {
				this.emitText(before);
			}
			this.textBuffer = this.textBuffer.slice(startPos + THINKING_START_TAG.length);
			this.inThinking = true;
			return;
		}

		// No thinking tag found - emit safe portion (keep buffer for potential tag)
		const safeLen = Math.max(0, this.textBuffer.length - THINKING_START_TAG.length);
		if (safeLen > 0) {
			const safeText = this.textBuffer.slice(0, safeLen);
			this.emitText(safeText);
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processInsideThinking(): void {
		const endPos = this.textBuffer.indexOf(THINKING_END_TAG);
		if (endPos !== -1) {
			// Found thinking end tag
			const thinkingPart = this.textBuffer.slice(0, endPos);
			if (thinkingPart) {
				this.emitThinking(thinkingPart);
			}

			// End thinking block
			if (this.thinkingBlockIndex !== null) {
				const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
				this.stream.push({
					type: "thinking_end",
					contentIndex: this.thinkingBlockIndex,
					content: block.thinking,
					partial: this.output,
				});
			}

			this.textBuffer = this.textBuffer.slice(endPos + THINKING_END_TAG.length);
			this.inThinking = false;
			this.thinkingExtracted = true;

			// Skip leading newlines after thinking
			if (this.textBuffer.startsWith("\n\n")) {
				this.textBuffer = this.textBuffer.slice(2);
			}
			return;
		}

		// No end tag found - emit safe portion (keep buffer for potential tag)
		const safeLen = Math.max(0, this.textBuffer.length - THINKING_END_TAG.length);
		if (safeLen > 0) {
			const safeThinking = this.textBuffer.slice(0, safeLen);
			this.emitThinking(safeThinking);
			this.textBuffer = this.textBuffer.slice(safeLen);
		}
	}

	private processAfterThinking(): void {
		// After thinking extracted, all remaining content is text
		this.emitText(this.textBuffer);
		this.textBuffer = "";
	}

	private emitText(text: string): void {
		if (this.textBlockIndex === null) {
			this.textBlockIndex = this.output.content.length;
			this.output.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
		}
		const block = this.output.content[this.textBlockIndex] as TextContent;
		block.text += text;
		this.stream.push({
			type: "text_delta",
			contentIndex: this.textBlockIndex,
			delta: text,
			partial: this.output,
		});
	}

	private emitThinking(thinking: string): void {
		if (this.thinkingBlockIndex === null) {
			this.thinkingBlockIndex = this.output.content.length;
			this.output.content.push({ type: "thinking", thinking: "" });
			this.stream.push({
				type: "thinking_start",
				contentIndex: this.thinkingBlockIndex,
				partial: this.output,
			});
		}
		const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
		block.thinking += thinking;
		this.stream.push({
			type: "thinking_delta",
			contentIndex: this.thinkingBlockIndex,
			delta: thinking,
			partial: this.output,
		});
	}
}
