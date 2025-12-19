import { marked, type Token } from "marked";
import type { Component } from "../tui.js";
import { applyBackgroundToLine, visibleWidth, wrapTextWithAnsi } from "../utils.js";

/**
 * Default text styling for markdown content.
 * Applied to all text unless overridden by markdown formatting.
 */
export interface DefaultTextStyle {
	/** Foreground color function */
	color?: (text: string) => string;
	/** Background color function */
	bgColor?: (text: string) => string;
	/** Bold text */
	bold?: boolean;
	/** Italic text */
	italic?: boolean;
	/** Strikethrough text */
	strikethrough?: boolean;
	/** Underline text */
	underline?: boolean;
}

/**
 * Theme functions for markdown elements.
 * Each function takes text and returns styled text with ANSI codes.
 */
export interface MarkdownTheme {
	heading: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	strikethrough: (text: string) => string;
	underline: (text: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
}

export class Markdown implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private defaultTextStyle?: DefaultTextStyle;
	private theme: MarkdownTheme;
	private defaultStylePrefix?: string;

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string,
		paddingX: number,
		paddingY: number,
		theme: MarkdownTheme,
		defaultTextStyle?: DefaultTextStyle,
	) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.theme = theme;
		this.defaultTextStyle = defaultTextStyle;
	}

	setText(text: string): void {
		this.text = text;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		// Check cache
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
			return this.cachedLines;
		}

		// Calculate available width for content (subtract horizontal padding)
		const contentWidth = Math.max(1, width - this.paddingX * 2);

		// Don't render anything if there's no actual text
		if (!this.text || this.text.trim() === "") {
			const result: string[] = [];
			// Update cache
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}

		// Replace tabs with 3 spaces for consistent rendering
		const normalizedText = this.text.replace(/\t/g, "   ");

		// Parse markdown to HTML-like tokens
		const tokens = marked.lexer(normalizedText);

		// Convert tokens to styled terminal output
		const renderedLines: string[] = [];

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const nextToken = tokens[i + 1];
			const tokenLines = this.renderToken(token, contentWidth, nextToken?.type);
			renderedLines.push(...tokenLines);
		}

		// Wrap lines (NO padding, NO background yet)
		const wrappedLines: string[] = [];
		for (const line of renderedLines) {
			wrappedLines.push(...wrapTextWithAnsi(line, contentWidth));
		}

		// Add margins and background to each wrapped line
		const leftMargin = " ".repeat(this.paddingX);
		const rightMargin = " ".repeat(this.paddingX);
		const bgFn = this.defaultTextStyle?.bgColor;
		const contentLines: string[] = [];

		for (const line of wrappedLines) {
			const lineWithMargins = leftMargin + line + rightMargin;

			if (bgFn) {
				contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
			} else {
				// No background - just pad to width
				const visibleLen = visibleWidth(lineWithMargins);
				const paddingNeeded = Math.max(0, width - visibleLen);
				contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
			}
		}

		// Add top/bottom padding (empty lines)
		const emptyLine = " ".repeat(width);
		const emptyLines: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
			emptyLines.push(line);
		}

		// Combine top padding, content, and bottom padding
		const result = [...emptyLines, ...contentLines, ...emptyLines];

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}

	/**
	 * Apply default text style to a string.
	 * This is the base styling applied to all text content.
	 * NOTE: Background color is NOT applied here - it's applied at the padding stage
	 * to ensure it extends to the full line width.
	 */
	private applyDefaultStyle(text: string): string {
		if (!this.defaultTextStyle) {
			return text;
		}

		let styled = text;

		// Apply foreground color (NOT background - that's applied at padding stage)
		if (this.defaultTextStyle.color) {
			styled = this.defaultTextStyle.color(styled);
		}

		// Apply text decorations using this.theme
		if (this.defaultTextStyle.bold) {
			styled = this.theme.bold(styled);
		}
		if (this.defaultTextStyle.italic) {
			styled = this.theme.italic(styled);
		}
		if (this.defaultTextStyle.strikethrough) {
			styled = this.theme.strikethrough(styled);
		}
		if (this.defaultTextStyle.underline) {
			styled = this.theme.underline(styled);
		}

		return styled;
	}

	private getDefaultStylePrefix(): string {
		if (!this.defaultTextStyle) {
			return "";
		}

		if (this.defaultStylePrefix !== undefined) {
			return this.defaultStylePrefix;
		}

		const sentinel = "\u0000";
		let styled = sentinel;

		if (this.defaultTextStyle.color) {
			styled = this.defaultTextStyle.color(styled);
		}

		if (this.defaultTextStyle.bold) {
			styled = this.theme.bold(styled);
		}
		if (this.defaultTextStyle.italic) {
			styled = this.theme.italic(styled);
		}
		if (this.defaultTextStyle.strikethrough) {
			styled = this.theme.strikethrough(styled);
		}
		if (this.defaultTextStyle.underline) {
			styled = this.theme.underline(styled);
		}

		const sentinelIndex = styled.indexOf(sentinel);
		this.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
		return this.defaultStylePrefix;
	}

	private renderToken(token: Token, width: number, nextTokenType?: string): string[] {
		const lines: string[] = [];

		switch (token.type) {
			case "heading": {
				const headingLevel = token.depth;
				const headingPrefix = "#".repeat(headingLevel) + " ";
				const headingText = this.renderInlineTokens(token.tokens || []);
				let styledHeading: string;
				if (headingLevel === 1) {
					styledHeading = this.theme.heading(this.theme.bold(this.theme.underline(headingText)));
				} else if (headingLevel === 2) {
					styledHeading = this.theme.heading(this.theme.bold(headingText));
				} else {
					styledHeading = this.theme.heading(this.theme.bold(headingPrefix + headingText));
				}
				lines.push(styledHeading);
				if (nextTokenType !== "space") {
					lines.push(""); // Add spacing after headings (unless space token follows)
				}
				break;
			}

			case "paragraph": {
				const paragraphText = this.renderInlineTokens(token.tokens || []);
				lines.push(paragraphText);
				// Don't add spacing if next token is space or list
				if (nextTokenType && nextTokenType !== "list" && nextTokenType !== "space") {
					lines.push("");
				}
				break;
			}

			case "code": {
				lines.push(this.theme.codeBlockBorder("```" + (token.lang || "")));
				if (this.theme.highlightCode) {
					const highlightedLines = this.theme.highlightCode(token.text, token.lang);
					for (const hlLine of highlightedLines) {
						lines.push("  " + hlLine);
					}
				} else {
					// Split code by newlines and style each line
					const codeLines = token.text.split("\n");
					for (const codeLine of codeLines) {
						lines.push("  " + this.theme.codeBlock(codeLine));
					}
				}
				lines.push(this.theme.codeBlockBorder("```"));
				if (nextTokenType !== "space") {
					lines.push(""); // Add spacing after code blocks (unless space token follows)
				}
				break;
			}

			case "list": {
				const listLines = this.renderList(token as any, 0);
				lines.push(...listLines);
				// Don't add spacing after lists if a space token follows
				// (the space token will handle it)
				break;
			}

			case "table": {
				const tableLines = this.renderTable(token as any, width);
				lines.push(...tableLines);
				break;
			}

			case "blockquote": {
				const quoteText = this.renderInlineTokens(token.tokens || []);
				const quoteLines = quoteText.split("\n");
				for (const quoteLine of quoteLines) {
					lines.push(this.theme.quoteBorder("│ ") + this.theme.quote(this.theme.italic(quoteLine)));
				}
				if (nextTokenType !== "space") {
					lines.push(""); // Add spacing after blockquotes (unless space token follows)
				}
				break;
			}

			case "hr":
				lines.push(this.theme.hr("─".repeat(Math.min(width, 80))));
				if (nextTokenType !== "space") {
					lines.push(""); // Add spacing after horizontal rules (unless space token follows)
				}
				break;

			case "html":
				// Skip HTML for terminal output
				break;

			case "space":
				// Space tokens represent blank lines in markdown
				lines.push("");
				break;

			default:
				// Handle any other token types as plain text
				if ("text" in token && typeof token.text === "string") {
					lines.push(token.text);
				}
		}

		return lines;
	}

	private renderInlineTokens(tokens: Token[]): string {
		let result = "";

		for (const token of tokens) {
			switch (token.type) {
				case "text":
					// Text tokens in list items can have nested tokens for inline formatting
					if (token.tokens && token.tokens.length > 0) {
						result += this.renderInlineTokens(token.tokens);
					} else {
						// Apply default style to plain text
						result += this.applyDefaultStyle(token.text);
					}
					break;

				case "strong": {
					// Apply bold, then reapply default style after
					const boldContent = this.renderInlineTokens(token.tokens || []);
					result += this.theme.bold(boldContent) + this.getDefaultStylePrefix();
					break;
				}

				case "em": {
					// Apply italic, then reapply default style after
					const italicContent = this.renderInlineTokens(token.tokens || []);
					result += this.theme.italic(italicContent) + this.getDefaultStylePrefix();
					break;
				}

				case "codespan":
					// Apply code styling without backticks
					result += this.theme.code(token.text) + this.getDefaultStylePrefix();
					break;

				case "link": {
					const linkText = this.renderInlineTokens(token.tokens || []);
					// If link text matches href, only show the link once
					// Compare raw text (token.text) not styled text (linkText) since linkText has ANSI codes
					if (token.text === token.href) {
						result += this.theme.link(this.theme.underline(linkText)) + this.getDefaultStylePrefix();
					} else {
						result +=
							this.theme.link(this.theme.underline(linkText)) +
							this.theme.linkUrl(` (${token.href})`) +
							this.getDefaultStylePrefix();
					}
					break;
				}

				case "br":
					result += "\n";
					break;

				case "del": {
					const delContent = this.renderInlineTokens(token.tokens || []);
					result += this.theme.strikethrough(delContent) + this.getDefaultStylePrefix();
					break;
				}

				default:
					// Handle any other inline token types as plain text
					if ("text" in token && typeof token.text === "string") {
						result += this.applyDefaultStyle(token.text);
					}
			}
		}

		return result;
	}

	/**
	 * Render a list with proper nesting support
	 */
	private renderList(token: Token & { items: any[]; ordered: boolean }, depth: number): string[] {
		const lines: string[] = [];
		const indent = "  ".repeat(depth);

		for (let i = 0; i < token.items.length; i++) {
			const item = token.items[i];
			const bullet = token.ordered ? `${i + 1}. ` : "- ";

			// Process item tokens to handle nested lists
			const itemLines = this.renderListItem(item.tokens || [], depth);

			if (itemLines.length > 0) {
				// First line - check if it's a nested list
				// A nested list will start with indent (spaces) followed by cyan bullet
				const firstLine = itemLines[0];
				const isNestedList = /^\s+\x1b\[36m[-\d]/.test(firstLine); // starts with spaces + cyan + bullet char

				if (isNestedList) {
					// This is a nested list, just add it as-is (already has full indent)
					lines.push(firstLine);
				} else {
					// Regular text content - add indent and bullet
					lines.push(indent + this.theme.listBullet(bullet) + firstLine);
				}

				// Rest of the lines
				for (let j = 1; j < itemLines.length; j++) {
					const line = itemLines[j];
					const isNestedListLine = /^\s+\x1b\[36m[-\d]/.test(line); // starts with spaces + cyan + bullet char

					if (isNestedListLine) {
						// Nested list line - already has full indent
						lines.push(line);
					} else {
						// Regular content - add parent indent + 2 spaces for continuation
						lines.push(indent + "  " + line);
					}
				}
			} else {
				lines.push(indent + this.theme.listBullet(bullet));
			}
		}

		return lines;
	}

	/**
	 * Render list item tokens, handling nested lists
	 * Returns lines WITHOUT the parent indent (renderList will add it)
	 */
	private renderListItem(tokens: Token[], parentDepth: number): string[] {
		const lines: string[] = [];

		for (const token of tokens) {
			if (token.type === "list") {
				// Nested list - render with one additional indent level
				// These lines will have their own indent, so we just add them as-is
				const nestedLines = this.renderList(token as any, parentDepth + 1);
				lines.push(...nestedLines);
			} else if (token.type === "text") {
				// Text content (may have inline tokens)
				const text =
					token.tokens && token.tokens.length > 0 ? this.renderInlineTokens(token.tokens) : token.text || "";
				lines.push(text);
			} else if (token.type === "paragraph") {
				// Paragraph in list item
				const text = this.renderInlineTokens(token.tokens || []);
				lines.push(text);
			} else if (token.type === "code") {
				// Code block in list item
				lines.push(this.theme.codeBlockBorder("```" + (token.lang || "")));
				if (this.theme.highlightCode) {
					const highlightedLines = this.theme.highlightCode(token.text, token.lang);
					for (const hlLine of highlightedLines) {
						lines.push("  " + hlLine);
					}
				} else {
					const codeLines = token.text.split("\n");
					for (const codeLine of codeLines) {
						lines.push("  " + this.theme.codeBlock(codeLine));
					}
				}
				lines.push(this.theme.codeBlockBorder("```"));
			} else {
				// Other token types - try to render as inline
				const text = this.renderInlineTokens([token]);
				if (text) {
					lines.push(text);
				}
			}
		}

		return lines;
	}

	/**
	 * Wrap a table cell to fit into a column.
	 *
	 * Delegates to wrapTextWithAnsi() so ANSI codes + long tokens are handled
	 * consistently with the rest of the renderer.
	 */
	private wrapCellText(text: string, maxWidth: number): string[] {
		return wrapTextWithAnsi(text, Math.max(1, maxWidth));
	}

	/**
	 * Render a table with width-aware cell wrapping.
	 * Cells that don't fit are wrapped to multiple lines.
	 */
	private renderTable(
		token: Token & { header: any[]; rows: any[][]; raw?: string },
		availableWidth: number,
	): string[] {
		const lines: string[] = [];
		const numCols = token.header.length;

		if (numCols === 0) {
			return lines;
		}

		// Calculate border overhead: "│ " + (n-1) * " │ " + " │"
		// = 2 + (n-1) * 3 + 2 = 3n + 1
		const borderOverhead = 3 * numCols + 1;

		// Minimum width for a bordered table with at least 1 char per column.
		const minTableWidth = borderOverhead + numCols;
		if (availableWidth < minTableWidth) {
			// Too narrow to render a stable table. Fall back to raw markdown.
			const fallbackLines = token.raw ? wrapTextWithAnsi(token.raw, availableWidth) : [];
			fallbackLines.push("");
			return fallbackLines;
		}

		// Calculate natural column widths (what each column needs without constraints)
		const naturalWidths: number[] = [];
		for (let i = 0; i < numCols; i++) {
			const headerText = this.renderInlineTokens(token.header[i].tokens || []);
			naturalWidths[i] = visibleWidth(headerText);
		}
		for (const row of token.rows) {
			for (let i = 0; i < row.length; i++) {
				const cellText = this.renderInlineTokens(row[i].tokens || []);
				naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
			}
		}

		// Calculate column widths that fit within available width
		const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
		let columnWidths: number[];

		if (totalNaturalWidth <= availableWidth) {
			// Everything fits naturally
			columnWidths = naturalWidths;
		} else {
			// Need to shrink columns to fit
			const availableForCells = availableWidth - borderOverhead;
			if (availableForCells <= numCols) {
				// Extremely narrow - give each column at least 1 char
				columnWidths = naturalWidths.map(() => Math.max(1, Math.floor(availableForCells / numCols)));
			} else {
				// Distribute space proportionally based on natural widths
				const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);
				columnWidths = naturalWidths.map((w) => {
					const proportion = w / totalNatural;
					return Math.max(1, Math.floor(proportion * availableForCells));
				});

				// Adjust for rounding errors - distribute remaining space
				const allocated = columnWidths.reduce((a, b) => a + b, 0);
				let remaining = availableForCells - allocated;
				for (let i = 0; remaining > 0 && i < numCols; i++) {
					columnWidths[i]++;
					remaining--;
				}
			}
		}

		// Render top border
		const topBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push("┌─" + topBorderCells.join("─┬─") + "─┐");

		// Render header with wrapping
		const headerCellLines: string[][] = token.header.map((cell, i) => {
			const text = this.renderInlineTokens(cell.tokens || []);
			return this.wrapCellText(text, columnWidths[i]);
		});
		const headerLineCount = Math.max(...headerCellLines.map((c) => c.length));

		for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
			const rowParts = headerCellLines.map((cellLines, colIdx) => {
				const text = cellLines[lineIdx] || "";
				const padded = text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
				return this.theme.bold(padded);
			});
			lines.push("│ " + rowParts.join(" │ ") + " │");
		}

		// Render separator
		const separatorCells = columnWidths.map((w) => "─".repeat(w));
		lines.push("├─" + separatorCells.join("─┼─") + "─┤");

		// Render rows with wrapping
		for (const row of token.rows) {
			const rowCellLines: string[][] = row.map((cell, i) => {
				const text = this.renderInlineTokens(cell.tokens || []);
				return this.wrapCellText(text, columnWidths[i]);
			});
			const rowLineCount = Math.max(...rowCellLines.map((c) => c.length));

			for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
				const rowParts = rowCellLines.map((cellLines, colIdx) => {
					const text = cellLines[lineIdx] || "";
					return text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
				});
				lines.push("│ " + rowParts.join(" │ ") + " │");
			}
		}

		// Render bottom border
		const bottomBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push("└─" + bottomBorderCells.join("─┴─") + "─┘");

		lines.push(""); // Add spacing after table
		return lines;
	}
}
