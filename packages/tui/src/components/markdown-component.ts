import chalk from "chalk";
import { marked, type Token } from "marked";
import { type Component, type ComponentRenderResult, getNextComponentId } from "../tui.js";

export class MarkdownComponent implements Component {
	readonly id = getNextComponentId();
	private text: string;
	private lines: string[] = [];
	private previousLines: string[] = [];

	constructor(text: string = "") {
		this.text = text;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(width: number): ComponentRenderResult {
		// Parse markdown to HTML-like tokens
		const tokens = marked.lexer(this.text);

		// Convert tokens to styled terminal output
		const renderedLines: string[] = [];

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const nextToken = tokens[i + 1];
			const tokenLines = this.renderToken(token, width, nextToken?.type);
			renderedLines.push(...tokenLines);
		}

		// Wrap lines to fit width
		const wrappedLines: string[] = [];
		for (const line of renderedLines) {
			wrappedLines.push(...this.wrapLine(line, width));
		}

		this.previousLines = this.lines;
		this.lines = wrappedLines;

		// Determine if content changed
		const changed =
			this.lines.length !== this.previousLines.length ||
			this.lines.some((line, i) => line !== this.previousLines[i]);

		return {
			lines: this.lines,
			changed,
		};
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
		const visibleLength = this.getVisibleLength(line);
		if (visibleLength <= width) {
			return [line];
		}

		// Need to wrap - this is complex with ANSI codes
		// For now, use a simple approach that may break styling at wrap points
		let currentLine = "";
		let currentLength = 0;
		let i = 0;

		while (i < line.length) {
			if (line[i] === "\x1b" && line[i + 1] === "[") {
				// ANSI escape sequence - include it without counting length
				let j = i + 2;
				while (j < line.length && line[j] && !/[mGKHJ]/.test(line[j]!)) {
					j++;
				}
				if (j < line.length) {
					currentLine += line.substring(i, j + 1);
					i = j + 1;
				} else {
					break;
				}
			} else {
				// Regular character
				if (currentLength >= width) {
					wrapped.push(currentLine);
					currentLine = "";
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

	private getVisibleLength(str: string): number {
		// Remove ANSI escape codes and count visible characters
		return (str || "").replace(/\x1b\[[0-9;]*m/g, "").length;
	}
}
