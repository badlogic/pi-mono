/**
 * Extracts <thinking> tags from streaming text.
 * Used when models leak thinking content as tags in regular text
 * instead of using the API's native thinking mechanism.
 */
export class ThinkingTagExtractor {
	private inThinkingMode = false;

	/**
	 * Process a text chunk. Returns separated thinking and regular text content.
	 * Assumes tags are not split across chunks.
	 */
	process(
		text: string,
		isMarkedAsThinking: boolean,
	): {
		thinking: string;
		text: string;
	} {
		// If already marked as thinking by API, pass through
		if (isMarkedAsThinking) {
			return { thinking: text, text: "" };
		}

		let thinking = "";
		let regularText = "";
		let remaining = text;

		while (remaining.length > 0) {
			if (!this.inThinkingMode) {
				const trimmed = remaining.trimStart();
				if (trimmed.startsWith("<thinking>")) {
					this.inThinkingMode = true;
					const tagIndex = remaining.indexOf("<thinking>");
					const beforeTag = remaining.slice(0, tagIndex);
					if (beforeTag.length > 0) {
						regularText += beforeTag;
					}
					remaining = remaining.slice(tagIndex + "<thinking>".length);
				} else {
					regularText += remaining;
					remaining = "";
				}
			} else {
				const endTagIndex = remaining.indexOf("</thinking>");
				if (endTagIndex !== -1) {
					thinking += remaining.slice(0, endTagIndex);
					remaining = remaining.slice(endTagIndex + "</thinking>".length);
					this.inThinkingMode = false;
				} else {
					thinking += remaining;
					remaining = "";
				}
			}
		}

		return { thinking, text: regularText };
	}

	isInThinkingMode(): boolean {
		return this.inThinkingMode;
	}
}
