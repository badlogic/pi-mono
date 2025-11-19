import * as os from "node:os";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";
import * as Diff from "diff";

/**
 * Convert absolute path to tilde notation if it's in home directory
 */
function shortenPath(path: string): string {
	const home = os.homedir();
	if (path.startsWith(home)) {
		return "~" + path.slice(home.length);
	}
	return path;
}

/**
 * Replace tabs with spaces for consistent rendering
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/**
 * Generate a unified diff with line numbers and context
 */
function generateDiff(oldStr: string, newStr: string): string {
	const parts = Diff.diffLines(oldStr, newStr);
	const output: string[] = [];

	// Calculate max line number for padding
	const oldLines = oldStr.split("\n");
	const newLines = newStr.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	const CONTEXT_LINES = 2; // Show 2 lines of context around changes

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			// Show the change
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(chalk.green(`${lineNum} ${line}`));
					newLineNum++;
				} else {
					// removed
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(chalk.red(`${lineNum} ${line}`));
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const isFirstPart = i === 0;
			const isLastPart = i === parts.length - 1;
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);

			if (lastWasChange || nextPartIsChange || isFirstPart || isLastPart) {
				// Show context
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;

				if (!isFirstPart && !lastWasChange) {
					// Show only last N lines as leading context
					skipStart = Math.max(0, raw.length - CONTEXT_LINES);
					linesToShow = raw.slice(skipStart);
				}

				if (!isLastPart && !nextPartIsChange && linesToShow.length > CONTEXT_LINES) {
					// Show only first N lines as trailing context
					skipEnd = linesToShow.length - CONTEXT_LINES;
					linesToShow = linesToShow.slice(0, CONTEXT_LINES);
				}

				// Add ellipsis if we skipped lines at start
				if (skipStart > 0) {
					output.push(chalk.dim(`${"".padStart(lineNumWidth, " ")} ...`));
				}

				for (const line of linesToShow) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(chalk.dim(`${lineNum} ${line}`));
					oldLineNum++;
					newLineNum++;
				}

				// Add ellipsis if we skipped lines at end
				if (skipEnd > 0) {
					output.push(chalk.dim(`${"".padStart(lineNumWidth, " ")} ...`));
				}

				// Update line numbers for skipped lines
				oldLineNum += skipStart + skipEnd;
				newLineNum += skipStart + skipEnd;
			} else {
				// Skip these context lines entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return output.join("\n");
}

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private contentText: Text;
	private toolName: string;
	private args: any;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	private previewLines?: number | undefined;

	constructor(toolName: string, args: any, previewLines?: number | undefined) {
		super();
		this.toolName = toolName;
		this.args = args;
		this.previewLines = previewLines;
		this.addChild(new Spacer(1));
		// Content with colored background and padding
		this.contentText = new Text("", 1, 1, { r: 40, g: 40, b: 50 });
		this.addChild(this.contentText);
		this.updateDisplay();
	}

	updateArgs(args: any): void {
		this.args = args;
		this.updateDisplay();
	}

	updateResult(result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: any;
		isError: boolean;
	}): void {
		this.result = result;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const bgColor = this.result
			? this.result.isError
				? { r: 60, g: 40, b: 40 }
				: { r: 40, g: 50, b: 40 }
			: { r: 40, g: 40, b: 50 };

		this.contentText.setCustomBgRgb(bgColor);
		this.contentText.setText(this.formatToolExecution());
	}

	private getTextOutput(): string {
		if (!this.result) return "";

		// Extract text from content blocks
		const textBlocks = this.result.content?.filter((c: any) => c.type === "text") || [];
		const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];

		let output = textBlocks.map((c: any) => c.text).join("\n");

		// Add indicator for images
		if (imageBlocks.length > 0) {
			const imageIndicators = imageBlocks.map((img: any) => `[Image: ${img.mimeType}]`).join("\n");
			output = output ? `${output}\n${imageIndicators}` : imageIndicators;
		}

		return output;
	}

	private formatToolExecution(): string {
		let text = "";

		// Format based on tool type
		if (this.toolName === "bash") {
			const command = this.args?.command || "";
			text = chalk.bold(`$ ${command || chalk.dim("...")}`);

			if (this.result) {
				// Show output without code fences - more minimal
				const output = this.getTextOutput().trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines =
						this.previewLines === undefined
							? 5
							: this.previewLines === 0
								? Number.MAX_SAFE_INTEGER
								: this.previewLines;
					const displayLines = lines.slice(0, maxLines);
					const remaining = Math.max(0, lines.length - maxLines);

					text += "\n\n" + displayLines.map((line: string) => chalk.dim(line)).join("\n");
					if (remaining > 0) {
						text += chalk.dim(`\n... (${remaining} more lines)`);
					}
				}
			}
		} else if (this.toolName === "read") {
			const path = shortenPath(this.args?.file_path || this.args?.path || "");
			text = chalk.bold("read") + " " + (path ? chalk.cyan(path) : chalk.dim("..."));

			if (this.result) {
				const output = this.getTextOutput();
				const lines = output.split("\n");
				const maxLines =
					this.previewLines === undefined
						? 10
						: this.previewLines === 0
							? Number.MAX_SAFE_INTEGER
							: this.previewLines;
				const displayLines = lines.slice(0, maxLines);
				const remaining = Math.max(0, lines.length - maxLines);

				text += "\n\n" + displayLines.map((line: string) => chalk.dim(replaceTabs(line))).join("\n");
				if (remaining > 0) {
					text += chalk.dim(`\n... (${remaining} more lines)`);
				}
			}
		} else if (this.toolName === "write") {
			const path = shortenPath(this.args?.file_path || this.args?.path || "");
			const fileContent = this.args?.content || "";
			const lines = fileContent ? fileContent.split("\n") : [];
			const totalLines = lines.length;

			text = chalk.bold("write") + " " + (path ? chalk.cyan(path) : chalk.dim("..."));
			if (
				totalLines >
				(this.previewLines === undefined
					? 10
					: this.previewLines === 0
						? Number.MAX_SAFE_INTEGER
						: this.previewLines)
			) {
				text += ` (${totalLines} lines)`;
			}

			// Show first 10 lines of content if available
			if (fileContent) {
				const maxLines =
					this.previewLines === undefined
						? 10
						: this.previewLines === 0
							? Number.MAX_SAFE_INTEGER
							: this.previewLines;
				const displayLines = lines.slice(0, maxLines);
				const remaining = Math.max(0, lines.length - maxLines);

				text += "\n\n" + displayLines.map((line: string) => chalk.dim(replaceTabs(line))).join("\n");
				if (remaining > 0) {
					text += chalk.dim(`\n... (${remaining} more lines)`);
				}
			}
		} else if (this.toolName === "edit") {
			const path = shortenPath(this.args?.file_path || this.args?.path || "");
			text = chalk.bold("edit") + " " + (path ? chalk.cyan(path) : chalk.dim("..."));

			if (this.result) {
				// Show error message if it's an error
				if (this.result.isError) {
					const errorText = this.getTextOutput();
					if (errorText) {
						text += "\n\n" + chalk.red(errorText);
					}
				} else if (this.result.details?.diff) {
					// Show diff if available
					const diffLines = this.result.details.diff.split("\n");
					const coloredLines = diffLines.map((line: string) => {
						if (line.startsWith("+")) {
							return chalk.green(line);
						} else if (line.startsWith("-")) {
							return chalk.red(line);
						} else {
							return chalk.dim(line);
						}
					});
					text += "\n\n" + coloredLines.join("\n");
				}
			}
		} else {
			// Generic tool
			text = chalk.bold(this.toolName);

			const content = JSON.stringify(this.args, null, 2);
			text += "\n\n" + content;
			const output = this.getTextOutput();
			if (output) {
				text += "\n" + output;
			}
		}

		return text;
	}
}
