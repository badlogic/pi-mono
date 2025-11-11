import { Container, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private spacerText: Text;
	private contentText: Text;
	private toolName: string;
	private args: any;
	private result?: { output: string; isError: boolean };

	constructor(toolName: string, args: any) {
		super();
		this.toolName = toolName;
		this.args = args;
		// Blank line with no background for spacing
		this.spacerText = new Text("\n", 0, 0);
		this.addChild(this.spacerText);
		// Content with colored background and padding
		this.contentText = new Text("", 1, 1, { r: 40, g: 40, b: 50 });
		this.addChild(this.contentText);
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
			const command = this.args.command || "";
			text = chalk.bold(`$ ${command}`);
			if (this.result?.isError) {
				text += " ❌";
			}

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
			const path = this.args.path || "";
			text = chalk.bold("read") + " " + chalk.cyan(path);
			if (this.result?.isError) {
				text += " ❌";
			}

			if (this.result) {
				const lines = this.result.output.split("\n");
				const maxLines = 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n\n" + displayLines.map((line: string) => chalk.dim(line)).join("\n");
				if (remaining > 0) {
					text += chalk.dim(`\n... (${remaining} more lines)`);
				}
			}
		} else if (this.toolName === "write") {
			const path = this.args.path || "";
			const fileContent = this.args.content || "";
			const lines = fileContent.split("\n");
			const totalLines = lines.length;

			text = chalk.bold("write") + " " + chalk.cyan(path);
			if (totalLines > 10) {
				text += ` (${totalLines} lines)`;
			}

			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}

			// Show first 10 lines of content
			const maxLines = 10;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;

			text += "\n\n" + displayLines.map((line: string) => chalk.dim(line)).join("\n");
			if (remaining > 0) {
				text += chalk.dim(`\n... (${remaining} more lines)`);
			}
		} else if (this.toolName === "edit") {
			const path = this.args.path || "";
			text = chalk.bold("edit") + " " + chalk.cyan(path);
			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}
		} else {
			// Generic tool
			text = chalk.bold(this.toolName);
			if (this.result?.isError) {
				text += " ❌";
			} else if (this.result) {
				text += " ✓";
			}

			const content = JSON.stringify(this.args, null, 2);
			text += "\n\n" + content;
			if (this.result?.output) {
				text += "\n" + this.result.output;
			}
		}

		return text;
	}
}
