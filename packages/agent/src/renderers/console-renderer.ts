import chalk from "chalk";
import type { AgentEvent, AgentEventReceiver } from "../agent.js";

export class ConsoleRenderer implements AgentEventReceiver {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private currentFrame = 0;
	private animationInterval: NodeJS.Timeout | null = null;
	private isAnimating = false;
	private animationLine = "";
	private isTTY = process.stdout.isTTY;

	private startAnimation(text: string = "Thinking"): void {
		if (this.isAnimating || !this.isTTY) return;
		this.isAnimating = true;
		this.currentFrame = 0;

		// Write initial frame
		this.animationLine = `${chalk.cyan(this.frames[this.currentFrame])} ${chalk.dim(text)}`;
		process.stdout.write(this.animationLine);

		this.animationInterval = setInterval(() => {
			// Clear current line
			process.stdout.write(`\r${" ".repeat(this.animationLine.length)}\r`);

			// Update frame
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.animationLine = `${chalk.cyan(this.frames[this.currentFrame])} ${chalk.dim(text)}`;
			process.stdout.write(this.animationLine);
		}, 80);
	}

	private stopAnimation(): void {
		if (!this.isAnimating) return;

		if (this.animationInterval) {
			clearInterval(this.animationInterval);
			this.animationInterval = null;
		}

		// Clear the animation line
		process.stdout.write(`\r${" ".repeat(this.animationLine.length)}\r`);
		this.isAnimating = false;
		this.animationLine = "";
	}

	async on(event: AgentEvent): Promise<void> {
		// Stop animation for any new event except token_usage
		if (event.type !== "token_usage" && this.isAnimating) {
			this.stopAnimation();
		}

		switch (event.type) {
			case "session_start":
				console.log(
					chalk.blue(
						`[Session started] ID: ${event.sessionId}, Model: ${event.model}, API: ${event.api}, Base URL: ${event.baseURL}`,
					),
				);
				console.log(chalk.dim(`System Prompt: ${event.systemPrompt}\n`));
				break;

			case "assistant_start":
				console.log(chalk.hex("#FFA500")("[assistant]"));
				this.startAnimation();
				break;

			case "thinking":
				this.stopAnimation();
				console.log(chalk.dim("[thinking]"));
				console.log(chalk.dim(event.text));
				console.log();
				// Resume animation after showing thinking
				this.startAnimation("Processing");
				break;

			case "tool_call":
				this.stopAnimation();
				console.log(chalk.yellow(`[tool] ${event.name}(${event.args})`));
				// Resume animation while tool executes
				this.startAnimation(`Running ${event.name}`);
				break;

			case "tool_result": {
				this.stopAnimation();
				const lines = event.result.split("\n");
				const maxLines = 10;
				const truncated = lines.length > maxLines;
				const toShow = truncated ? lines.slice(0, maxLines) : lines;

				const text = toShow.join("\n");
				console.log(event.isError ? chalk.red(text) : chalk.gray(text));

				if (truncated) {
					console.log(chalk.dim(`... (${lines.length - maxLines} more lines)`));
				}
				console.log();
				// Resume animation after tool result
				this.startAnimation("Thinking");
				break;
			}

			case "assistant_message":
				this.stopAnimation();
				console.log(event.text);
				console.log();
				break;

			case "error":
				this.stopAnimation();
				console.error(chalk.red(`[error] ${event.message}\n`));
				break;

			case "user_message":
				console.log(chalk.green("[user]"));
				console.log(event.text);
				console.log();
				break;

			case "interrupted":
				this.stopAnimation();
				console.log(chalk.red("[Interrupted by user]\n"));
				break;

			case "token_usage":
				// Token usage is not displayed in console mode
				// Don't stop animation for this event
				break;
		}
	}
}
