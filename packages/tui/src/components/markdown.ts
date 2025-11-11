import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import { marked, type Token } from "marked";
import type { Component } from "../tui.js";

type Color =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "gray"
	| "bgBlack"
	| "bgRed"
	| "bgGreen"
	| "bgYellow"
	| "bgBlue"
	| "bgMagenta"
	| "bgCyan"
	| "bgWhite"
	| "bgGray";

export class Markdown implements Component {
	private text: string;
	private bgColor?: Color;
	private fgColor?: Color;
	private customBgRgb?: { r: number; g: number; b: number };
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string = "",
		bgColor?: Color,
		fgColor?: Color,
		customBgRgb?: { r: number; g: number; b: number },
		paddingX: number = 1,
		paddingY: number = 1,
	) {
		this.text = text;
		this.bgColor = bgColor;
		this.fgColor = fgColor;
		this.customBgRgb = customBgRgb;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
	}

	setText(text: string): void {
		this.text = text;
		// Invalidate cache when text changes
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	setBgColor(bgColor?: Color): void {
		this.bgColor = bgColor;
		// Invalidate cache when color changes
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	setFgColor(fgColor?: Color): void {
		this.fgColor = fgColor;
		// Invalidate cache when color changes
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

		// Parse markdown to HTML-like tokens
		const tokens = marked.lexer(this.text);

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
			wrappedLines.push(...this.wrapLine(line, contentWidth));
		}

		// Add padding and apply colors
		const leftPad = " ".repeat(this.paddingX);
		const paddedLines: string[] = [];

		for (const line of wrappedLines) {
			// Calculate visible length (strip ANSI codes)
			const visibleLength = stripVTControlCharacters(line).length;
			// Right padding to fill to width (accounting for left padding and content)
			const rightPadLength = Math.max(0, width - this.paddingX - visibleLength);
			const rightPad = " ".repeat(rightPadLength);

			// Add left padding, content, and right padding
			let paddedLine = leftPad + line + rightPad;

			// Apply foreground color if specified
			if (this.fgColor) {
				paddedLine = (chalk as any)[this.fgColor](paddedLine);
			}

			// Apply background color if specified
			if (this.customBgRgb) {
				paddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(paddedLine);
			} else if (this.bgColor) {
				paddedLine = (chalk as any)[this.bgColor](paddedLine);
			}

			paddedLines.push(paddedLine);
		}

		// Add top padding (empty lines)
		const emptyLine = " ".repeat(width);
		const topPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			let emptyPaddedLine = emptyLine;
			if (this.customBgRgb) {
				emptyPaddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(emptyPaddedLine);
			} else if (this.bgColor) {
				emptyPaddedLine = (chalk as any)[this.bgColor](emptyPaddedLine);
			}
			topPadding.push(emptyPaddedLine);
		}

		// Add bottom padding (empty lines)
		const bottomPadding: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			let emptyPaddedLine = emptyLine;
			if (this.customBgRgb) {
				emptyPaddedLine = chalk.bgRgb(this.customBgRgb.r, this.customBgRgb.g, this.customBgRgb.b)(emptyPaddedLine);
			} else if (this.bgColor) {
				emptyPaddedLine = (chalk as any)[this.bgColor](emptyPaddedLine);
			}
			bottomPadding.push(emptyPaddedLine);
		}

		// Combine top padding, content, and bottom padding
		const result = [...topPadding, ...paddedLines, ...bottomPadding];

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}

	private renderToken(token: Token, width: number, nextTokenType?: string): string[] {
		const lines: string[] = [];

		switch (token.type) {
			case "heading": {
				const headingLevel = token.depth;
				const headingPrefix = "#".repeat(headingLevel) + " ";
				const headingText = this.renderInlineTokens(token.tokens || []);
				if (headingLevel === 1) {
					lines.push(chalk.bold.underline.yellow(headingText));
				} else if (headingLevel === 2) {
					lines.push(chalk.bold.yellow(headingText));
				} else {
					lines.push(chalk.bold(headingPrefix + headingText));
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
				lines.push(chalk.gray("```" + (token.lang || "")));
				// Split code by newlines and style each line
				const codeLines = token.text.split("\n");
				for (const codeLine of codeLines) {
					lines.push(chalk.dim("  ") + chalk.green(codeLine));
				}
				lines.push(chalk.gray("```"));
				lines.push(""); // Add spacing after code blocks
				break;
			}

			case "list":
				for (let i = 0; i < token.items.length; i++) {
					const item = token.items[i];
					const bullet = token.ordered ? `${i + 1}. ` : "- ";
					const itemText = this.renderInlineTokens(item.tokens || []);

					// Check if the item text contains multiple lines (embedded content)
					const itemLines = itemText.split("\n").filter((line) => line.trim());
					if (itemLines.length > 1) {
						// First line is the list item
						lines.push(chalk.cyan(bullet) + itemLines[0]);
						// Rest are treated as separate content
						for (let j = 1; j < itemLines.length; j++) {
							lines.push(""); // Add spacing
							lines.push(itemLines[j]);
						}
					} else {
						lines.push(chalk.cyan(bullet) + itemText);
					}
				}
				// Don't add spacing after lists if a space token follows
				// (the space token will handle it)
				break;

			case "blockquote": {
				const quoteText = this.renderInlineTokens(token.tokens || []);
				const quoteLines = quoteText.split("\n");
				for (const quoteLine of quoteLines) {
					lines.push(chalk.gray("│ ") + chalk.italic(quoteLine));
				}
				lines.push(""); // Add spacing after blockquotes
				break;
			}

			case "hr":
				lines.push(chalk.gray("─".repeat(Math.min(width, 80))));
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
						result += token.text;
					}
					break;

				case "strong":
					result += chalk.bold(this.renderInlineTokens(token.tokens || []));
					break;

				case "em":
					result += chalk.italic(this.renderInlineTokens(token.tokens || []));
					break;

				case "codespan":
					result += chalk.gray("`") + chalk.cyan(token.text) + chalk.gray("`");
					break;

				case "link": {
					const linkText = this.renderInlineTokens(token.tokens || []);
					result += chalk.underline.blue(linkText) + chalk.gray(` (${token.href})`);
					break;
				}

				case "br":
					result += "\n";
					break;

				case "del":
					result += chalk.strikethrough(this.renderInlineTokens(token.tokens || []));
					break;

				default:
					// Handle any other inline token types as plain text
					if ("text" in token && typeof token.text === "string") {
						result += token.text;
					}
			}
		}

		return result;
	}

	private wrapLine(line: string, width: number): string[] {
		// Handle ANSI escape codes properly when wrapping
		const wrapped: string[] = [];

		// Handle undefined or null lines
		if (!line) {
			return [""];
		}

		// If line fits within width, return as-is
		const visibleLength = stripVTControlCharacters(line).length;
		if (visibleLength <= width) {
			return [line];
		}

		// Track active ANSI codes to preserve them across wrapped lines
		const activeAnsiCodes: string[] = [];
		let currentLine = "";
		let currentLength = 0;
		let i = 0;

		while (i < line.length) {
			if (line[i] === "\x1b" && line[i + 1] === "[") {
				// ANSI escape sequence - parse and track it
				let j = i + 2;
				while (j < line.length && line[j] && !/[mGKHJ]/.test(line[j]!)) {
					j++;
				}
				if (j < line.length) {
					const ansiCode = line.substring(i, j + 1);
					currentLine += ansiCode;

					// Track styling codes (ending with 'm')
					if (line[j] === "m") {
						// Reset code
						if (ansiCode === "\x1b[0m" || ansiCode === "\x1b[m") {
							activeAnsiCodes.length = 0;
						} else {
							// Add to active codes (replacing similar ones)
							activeAnsiCodes.push(ansiCode);
						}
					}

					i = j + 1;
				} else {
					// Incomplete ANSI sequence at end - don't include it
					break;
				}
			} else {
				// Regular character
				if (currentLength >= width) {
					// Need to wrap - close current line with reset if needed
					if (activeAnsiCodes.length > 0) {
						wrapped.push(currentLine + "\x1b[0m");
						// Start new line with active codes
						currentLine = activeAnsiCodes.join("");
					} else {
						wrapped.push(currentLine);
						currentLine = "";
					}
					currentLength = 0;
				}
				currentLine += line[i];
				currentLength++;
				i++;
			}
		}

		if (currentLine) {
			wrapped.push(currentLine);
		}

		return wrapped.length > 0 ? wrapped : [""];
	}
}
