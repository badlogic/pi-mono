import * as os from "node:os";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

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
 * Generate a unified diff between old and new strings with line numbers
 */
function generateDiff(oldStr: string, newStr: string): string {
	// Split into lines
	const oldLines = oldStr.split("\n");
	const newLines = newStr.split("\n");

	const diff: string[] = [];

	// Calculate line number padding (for alignment)
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	// Show old lines with line numbers
	diff.push(chalk.red("- old:"));
	for (let i = 0; i < oldLines.length; i++) {
		const lineNum = String(i + 1).padStart(lineNumWidth, " ");
		diff.push(chalk.red(`- ${chalk.dim(lineNum)} ${oldLines[i]}`));
	}

	diff.push("");

	// Show new lines with line numbers
	diff.push(chalk.green("+ new:"));
	for (let i = 0; i < newLines.length; i++) {
		const lineNum = String(i + 1).padStart(lineNumWidth, " ");
		diff.push(chalk.green(`+ ${chalk.dim(lineNum)} ${newLines[i]}`));
	}

	return diff.join("\n");
}

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private contentText: Text;
	private toolName: string;
	private args: any;
	private result?: { output: string; isError: boolean };

	constructor(toolName: string, args: any) {
		super();
		this.toolName = toolName;
		this.args = args;
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

	updateResult(result: { output: string; isError: boolean }): void {
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

	private formatToolExecution(): string {
		let text = "";

		// Format based on tool type
		if (this.toolName === "bash") {
			const command = this.args?.command || "";
			text = chalk.bold(`$ ${command || chalk.dim("...")}`);

			if (this.result) {
				// Show output without code fences - more minimal
				const output = this.result.output.trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = 5;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

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
				const lines = this.result.output.split("\n");
				const maxLines = 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

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
			if (totalLines > 10) {
				text += ` (${totalLines} lines)`;
			}

			// Show first 10 lines of content if available
			if (fileContent) {
				const maxLines = 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n\n" + displayLines.map((line: string) => chalk.dim(replaceTabs(line))).join("\n");
				if (remaining > 0) {
					text += chalk.dim(`\n... (${remaining} more lines)`);
				}
			}
		} else if (this.toolName === "edit") {
			const path = shortenPath(this.args?.file_path || this.args?.path || "");
			text = chalk.bold("edit") + " " + (path ? chalk.cyan(path) : chalk.dim("..."));

			// Show diff if we have old_string and new_string
			if (this.args?.old_string && this.args?.new_string) {
				text += "\n\n" + generateDiff(this.args.old_string, this.args.new_string);
			}
		} else {
			// Generic tool
			text = chalk.bold(this.toolName);

			const content = JSON.stringify(this.args, null, 2);
			text += "\n\n" + content;
			if (this.result?.output) {
				text += "\n" + this.result.output;
			}
		}

		return text;
	}
}
