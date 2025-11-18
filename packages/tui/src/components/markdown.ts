import { Chalk } from "chalk";
import { marked, type Token } from "marked";
import type { Component } from "../tui.js";
import { visibleWidth, wrapTextWithAnsi } from "../utils.js";

// Use a chalk instance with color level 3 for consistent ANSI output
const colorChalk = new Chalk({ level: 3 });

/**
 * Default text styling for markdown content.
 * Applied to all text unless overridden by markdown formatting.
 */
export interface DefaultTextStyle {
	/** Foreground color - named color or hex string like "#ff0000" */
	color?: string;
	/** Background color - named color or hex string like "#ff0000" */
	bgColor?: string;
	/** Bold text */
	bold?: boolean;
	/** Italic text */
	italic?: boolean;
	/** Strikethrough text */
	strikethrough?: boolean;
	/** Underline text */
	underline?: boolean;
}

export class Markdown implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private defaultTextStyle?: DefaultTextStyle;

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(text: string = "", paddingX: number = 1, paddingY: number = 1, defaultTextStyle?: DefaultTextStyle) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.defaultTextStyle = defaultTextStyle;
	}

	setText(text: string): void {
		this.text = text;
		// Invalidate cache when text changes
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

		// Wrap lines to fit content width
		const wrappedLines: string[] = [];
		for (const line of renderedLines) {
			wrappedLines.push(...wrapTextWithAnsi(line, contentWidth));
		}

		// Add padding and apply background color if specified
		const leftPad = " ".repeat(this.paddingX);
		const paddedLines: string[] = [];

		for (const line of wrappedLines) {
			// Calculate visible length
			const visibleLength = visibleWidth(line);
			// Right padding to fill to width (accounting for left padding and content)
			const rightPadLength = Math.max(0, width - this.paddingX - visibleLength);
			const rightPad = " ".repeat(rightPadLength);

			// Add left padding, content, and right padding
			let paddedLine = leftPad + line + rightPad;

			// Apply background color to entire line if specified
			if (this.defaultTextStyle?.bgColor) {
				paddedLine = this.applyBgColor(paddedLine);
			}

			paddedLines.push(paddedLine);
		}

		// Add top padding (empty lines)
		const emptyLine = " ".repeat(width);
		const topPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			const paddedEmptyLine = this.defaultTextStyle?.bgColor ? this.applyBgColor(emptyLine) : emptyLine;
			topPadding.push(paddedEmptyLine);
		}

		// Add bottom padding (empty lines)
		const bottomPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			const paddedEmptyLine = this.defaultTextStyle?.bgColor ? this.applyBgColor(emptyLine) : emptyLine;
			bottomPadding.push(paddedEmptyLine);
		}

		// Combine top padding, content, and bottom padding
		const result = [...topPadding, ...paddedLines, ...bottomPadding];

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}

	/**
	 * Apply only background color from default style.
	 * Used for padding lines that don't have text content.
	 */
	private applyBgColor(text: string): string {
		if (!this.defaultTextStyle?.bgColor) {
			return text;
		}

		if (this.defaultTextStyle.bgColor.startsWith("#")) {
			// Hex color
			const hex = this.defaultTextStyle.bgColor.substring(1);
			const r = Number.parseInt(hex.substring(0, 2), 16);
			const g = Number.parseInt(hex.substring(2, 4), 16);
			const b = Number.parseInt(hex.substring(4, 6), 16);
			return colorChalk.bgRgb(r, g, b)(text);
		}
		// Named background color (bgRed, bgBlue, etc.)
		return (colorChalk as any)[this.defaultTextStyle.bgColor](text);
	}

	/**
	 * Apply default text style to a string.
	 * This is the base styling applied to all text content.
	 */
	private applyDefaultStyle(text: string): string {
		if (!this.defaultTextStyle) {
			return text;
		}

		let styled = text;

		// Apply color
		if (this.defaultTextStyle.color) {
			if (this.defaultTextStyle.color.startsWith("#")) {
				// Hex color
				const hex = this.defaultTextStyle.color.substring(1);
				const r = Number.parseInt(hex.substring(0, 2), 16);
				const g = Number.parseInt(hex.substring(2, 4), 16);
				const b = Number.parseInt(hex.substring(4, 6), 16);
				styled = colorChalk.rgb(r, g, b)(styled);
			} else {
				// Named color
				styled = (colorChalk as any)[this.defaultTextStyle.color](styled);
			}
		}

		// Apply background color
		if (this.defaultTextStyle.bgColor) {
			if (this.defaultTextStyle.bgColor.startsWith("#")) {
				// Hex color
				const hex = this.defaultTextStyle.bgColor.substring(1);
				const r = Number.parseInt(hex.substring(0, 2), 16);
				const g = Number.parseInt(hex.substring(2, 4), 16);
				const b = Number.parseInt(hex.substring(4, 6), 16);
				styled = colorChalk.bgRgb(r, g, b)(styled);
			} else {
				// Named background color (bgRed, bgBlue, etc.)
				styled = (colorChalk as any)[this.defaultTextStyle.bgColor](styled);
			}
		}

		// Apply text decorations
		if (this.defaultTextStyle.bold) {
			styled = colorChalk.bold(styled);
		}
		if (this.defaultTextStyle.italic) {
			styled = colorChalk.italic(styled);
		}
		if (this.defaultTextStyle.strikethrough) {
			styled = colorChalk.strikethrough(styled);
		}
		if (this.defaultTextStyle.underline) {
			styled = colorChalk.underline(styled);
		}

		return styled;
	}

	private renderToken(token: Token, width: number, nextTokenType?: string): string[] {
		const lines: string[] = [];

		switch (token.type) {
			case "heading": {
				const headingLevel = token.depth;
				const headingPrefix = "#".repeat(headingLevel) + " ";
				const headingText = this.renderInlineTokens(token.tokens || []);
				if (headingLevel === 1) {
					lines.push(colorChalk.bold.underline.yellow(headingText));
				} else if (headingLevel === 2) {
					lines.push(colorChalk.bold.yellow(headingText));
				} else {
					lines.push(colorChalk.bold(headingPrefix + headingText));
				}
				lines.push(""); // Add spacing after headings
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
				lines.push(colorChalk.gray("```" + (token.lang || "")));
				// Split code by newlines and style each line
				const codeLines = token.text.split("\n");
				for (const codeLine of codeLines) {
					lines.push(colorChalk.dim("  ") + colorChalk.green(codeLine));
				}
				lines.push(colorChalk.gray("```"));
				lines.push(""); // Add spacing after code blocks
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
				const tableLines = this.renderTable(token as any);
				lines.push(...tableLines);
				break;
			}

			case "blockquote": {
				const quoteText = this.renderInlineTokens(token.tokens || []);
				const quoteLines = quoteText.split("\n");
				for (const quoteLine of quoteLines) {
					lines.push(colorChalk.gray("│ ") + colorChalk.italic(quoteLine));
				}
				lines.push(""); // Add spacing after blockquotes
				break;
			}

			case "hr":
				lines.push(colorChalk.gray("─".repeat(Math.min(width, 80))));
				lines.push(""); // Add spacing after horizontal rules
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
					result += colorChalk.bold(boldContent) + this.applyDefaultStyle("");
					break;
				}

				case "em": {
					// Apply italic, then reapply default style after
					const italicContent = this.renderInlineTokens(token.tokens || []);
					result += colorChalk.italic(italicContent) + this.applyDefaultStyle("");
					break;
				}

				case "codespan":
					// Apply code styling, then reapply default style after
					result +=
						colorChalk.gray("`") +
						colorChalk.cyan(token.text) +
						colorChalk.gray("`") +
						this.applyDefaultStyle("");
					break;

				case "link": {
					const linkText = this.renderInlineTokens(token.tokens || []);
					// If link text matches href, only show the link once
					if (linkText === token.href) {
						result += colorChalk.underline.blue(linkText) + this.applyDefaultStyle("");
					} else {
						result +=
							colorChalk.underline.blue(linkText) +
							colorChalk.gray(` (${token.href})`) +
							this.applyDefaultStyle("");
					}
					break;
				}

				case "br":
					result += "\n";
					break;

				case "del": {
					const delContent = this.renderInlineTokens(token.tokens || []);
					result += colorChalk.strikethrough(delContent) + this.applyDefaultStyle("");
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
					lines.push(indent + colorChalk.cyan(bullet) + firstLine);
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
				lines.push(indent + colorChalk.cyan(bullet));
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
				lines.push(colorChalk.gray("```" + (token.lang || "")));
				const codeLines = token.text.split("\n");
				for (const codeLine of codeLines) {
					lines.push(colorChalk.dim("  ") + colorChalk.green(codeLine));
				}
				lines.push(colorChalk.gray("```"));
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
	 * Render a table
	 */
	private renderTable(token: Token & { header: any[]; rows: any[][] }): string[] {
		const lines: string[] = [];

		// Calculate column widths
		const columnWidths: number[] = [];

		// Check header
		for (let i = 0; i < token.header.length; i++) {
			const headerText = this.renderInlineTokens(token.header[i].tokens || []);
			const width = visibleWidth(headerText);
			columnWidths[i] = Math.max(columnWidths[i] || 0, width);
		}

		// Check rows
		for (const row of token.rows) {
			for (let i = 0; i < row.length; i++) {
				const cellText = this.renderInlineTokens(row[i].tokens || []);
				const width = visibleWidth(cellText);
				columnWidths[i] = Math.max(columnWidths[i] || 0, width);
			}
		}

		// Limit column widths to reasonable max
		const maxColWidth = 40;
		for (let i = 0; i < columnWidths.length; i++) {
			columnWidths[i] = Math.min(columnWidths[i], maxColWidth);
		}

		// Render header
		const headerCells = token.header.map((cell, i) => {
			const text = this.renderInlineTokens(cell.tokens || []);
			return colorChalk.bold(text.padEnd(columnWidths[i]));
		});
		lines.push("│ " + headerCells.join(" │ ") + " │");

		// Render separator
		const separatorCells = columnWidths.map((width) => "─".repeat(width));
		lines.push("├─" + separatorCells.join("─┼─") + "─┤");

		// Render rows
		for (const row of token.rows) {
			const rowCells = row.map((cell, i) => {
				const text = this.renderInlineTokens(cell.tokens || []);
				const visWidth = visibleWidth(text);
				const padding = " ".repeat(Math.max(0, columnWidths[i] - visWidth));
				return text + padding;
			});
			lines.push("│ " + rowCells.join(" │ ") + " │");
		}

		lines.push(""); // Add spacing after table
		return lines;
	}
}
