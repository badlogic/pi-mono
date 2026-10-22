/** Split a leading UTF-8 byte order mark from decoded text. */
export function splitBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

/** Remove a leading UTF-8 byte order mark from decoded text. */
export function stripBom(content: string): string {
	return splitBom(content).text;
}

/**
 * Remove whole-line HTML comments (`<!-- ... -->`) from a context file.
 *
 * Claude Code skips whole-line HTML comments in `CLAUDE.md`, so maintainers use
 * them for notes that must not reach the model. Pi reads context files verbatim,
 * so without this step the same file sends those notes to the model as prompt
 * text. A line is dropped only when its first non-whitespace characters are
 * `<!--`; a comment that shares a line with rule text is kept, because dropping
 * it would delete the rule too.
 */
export function stripHtmlComments(content: string): string {
	if (!content.includes("<!--")) {
		return content;
	}
	const lines = content.split("\n");
	const kept = lines.filter((line) => !line.trimStart().startsWith("<!--"));
	if (kept.length === lines.length) {
		return content;
	}
	// Collapse the run of blank lines that removing a comment block leaves behind.
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}
