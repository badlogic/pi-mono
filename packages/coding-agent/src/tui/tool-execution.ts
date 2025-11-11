import { Container, Markdown } from "@mariozechner/pi-tui";

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private markdown: Markdown;
	private toolName: string;
	private args: any;
	private result?: { output: string; isError: boolean };

	constructor(toolName: string, args: any) {
		super();
		this.toolName = toolName;
		this.args = args;
		this.markdown = new Markdown("", undefined, undefined, { r: 40, g: 40, b: 50 });
		this.addChild(this.markdown);
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
		this.markdown.setCustomBgRgb(bgColor);
		this.markdown.setText(this.formatToolExecution());
	}

	private formatToolExecution(): string {
		let text = "";

		// Format based on tool type
		if (this.toolName === "bash") {
			const command = this.args.command || "";
			text = `**$ ${command}**`;
			if (this.result) {
				// Show output without code fences - more minimal
				const output = this.result.output.trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = 5;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

					text += "\n" + displayLines.join("\n");
					if (remaining > 0) {
						text += `\n... (${remaining} more lines)`;
					}
				}

				if (this.result.isError) {
					text += " ❌";
				}
			}
		} else if (this.toolName === "read") {
			const path = this.args.path || "";
			text = `**read** \`${path}\``;
			if (this.result) {
				const lines = this.result.output.split("\n");
				const maxLines = 5;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n```\n" + displayLines.join("\n");
				if (remaining > 0) {
					text += `\n... (${remaining} more lines)`;
				}
				text += "\n```";

				if (this.result.isError) {
					text += " ❌";
				}
			}
		} else if (this.toolName === "write") {
			const path = this.args.path || "";
			const content = this.args.content || "";
			const lines = content.split("\n");
			text = `**write** \`${path}\` (${lines.length} lines)`;
			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}
		} else if (this.toolName === "edit") {
			const path = this.args.path || "";
			text = `**edit** \`${path}\``;
			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}
		} else {
			// Generic tool
			text = `**${this.toolName}**\n\`\`\`json\n${JSON.stringify(this.args, null, 2)}\n\`\`\``;
			if (this.result) {
				text += `\n\`\`\`\n${this.result.output}\n\`\`\``;
				text += this.result.isError ? " ❌" : " ✓";
			}
		}

		return text;
	}
}
