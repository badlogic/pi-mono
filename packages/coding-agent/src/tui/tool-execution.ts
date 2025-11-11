import { Container, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private spacerText: Text;
	private headerText: Text;
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
		// Header with colored background
		this.headerText = new Text("", 1, 0, { r: 40, g: 40, b: 50 });
		this.addChild(this.headerText);
		// Content has same colored background
		this.contentText = new Text("", 1, 0, { r: 40, g: 40, b: 50 });
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

		const { header, content } = this.formatToolExecution();

		this.headerText.setCustomBgRgb(bgColor);
		this.headerText.setText(header);

		if (content) {
			this.contentText.setCustomBgRgb(bgColor);
			this.contentText.setText(content);
		} else {
			this.contentText.setText("");
		}
	}

	private formatToolExecution(): { header: string; content: string } {
		let header = "";
		let content = "";

		// Format based on tool type
		if (this.toolName === "bash") {
			const command = this.args.command || "";
			header = chalk.bold(`$ ${command}`);
			if (this.result) {
				// Show output without code fences - more minimal
				const output = this.result.output.trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = 5;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

					content = displayLines.map((line: string) => chalk.dim(line)).join("\n");
					if (remaining > 0) {
						content += chalk.dim(`\n... (${remaining} more lines)`);
					}
				}

				if (this.result.isError) {
					header += " ❌";
				}
			}
		} else if (this.toolName === "read") {
			const path = this.args.path || "";
			header = chalk.bold("read") + " " + chalk.cyan(path);
			if (this.result) {
				const lines = this.result.output.split("\n");
				const maxLines = 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				content = displayLines.map((line: string) => chalk.dim(line)).join("\n");
				if (remaining > 0) {
					content += chalk.dim(`\n... (${remaining} more lines)`);
				}

				if (this.result.isError) {
					header += " ❌";
				}
			}
		} else if (this.toolName === "write") {
			const path = this.args.path || "";
			const fileContent = this.args.content || "";
			const lines = fileContent.split("\n");
			const totalLines = lines.length;

			header = chalk.bold("write") + " " + chalk.cyan(path);
			if (totalLines > 10) {
				header += ` (${totalLines} lines)`;
			}

			if (this.result) {
				header += this.result.isError ? " ❌" : " ✓";
			}

			// Show first 10 lines of content
			const maxLines = 10;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;

			content = displayLines.map((line: string) => chalk.dim(line)).join("\n");
			if (remaining > 0) {
				content += chalk.dim(`\n... (${remaining} more lines)`);
			}
		} else if (this.toolName === "edit") {
			const path = this.args.path || "";
			header = chalk.bold("edit") + " " + chalk.cyan(path);
			if (this.result) {
				header += this.result.isError ? " ❌" : " ✓";
			}
		} else {
			// Generic tool
			header = chalk.bold(this.toolName);
			content = JSON.stringify(this.args, null, 2);
			if (this.result) {
				content += "\n" + this.result.output;
				header += this.result.isError ? " ❌" : " ✓";
			}
		}

		return { header, content };
	}
}
