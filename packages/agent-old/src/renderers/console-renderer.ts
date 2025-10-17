import chalk from "chalk";
import type { AgentEvent, AgentEventReceiver } from "../agent.js";

export class ConsoleRenderer implements AgentEventReceiver {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private currentFrame = 0;
	private animationInterval: NodeJS.Timeout | null = null;
	private isAnimating = false;
	private animationLine = "";
	private isTTY = process.stdout.isTTY;
	private toolCallCount = 0;
	private lastInputTokens = 0;
	private lastOutputTokens = 0;
	private lastCacheReadTokens = 0;
	private lastCacheWriteTokens = 0;
	private lastReasoningTokens = 0;

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

	private displayMetrics(): void {
		// Build metrics display
		let metricsText = chalk.dim(
			`↑${this.lastInputTokens.toLocaleString()} ↓${this.lastOutputTokens.toLocaleString()}`,
		);

		// Add reasoning tokens if present
		if (this.lastReasoningTokens > 0) {
			metricsText += chalk.dim(` ⚡${this.lastReasoningTokens.toLocaleString()}`);
		}

		// Add cache info if available
		if (this.lastCacheReadTokens > 0 || this.lastCacheWriteTokens > 0) {
			const cacheText: string[] = [];
			if (this.lastCacheReadTokens > 0) {
				cacheText.push(`⟲${this.lastCacheReadTokens.toLocaleString()}`);
			}
			if (this.lastCacheWriteTokens > 0) {
				cacheText.push(`⟳${this.lastCacheWriteTokens.toLocaleString()}`);
			}
			metricsText += chalk.dim(` (${cacheText.join(" ")})`);
		}

		// Add tool call count
		if (this.toolCallCount > 0) {
			metricsText += chalk.dim(` ⚒ ${this.toolCallCount}`);
		}

		console.log(metricsText);
		console.log();
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

			case "reasoning":
				this.stopAnimation();
				console.log(chalk.dim("[thinking]"));
				console.log(chalk.dim(event.text));
				console.log();
				// Resume animation after showing thinking
				this.startAnimation("Processing");
				break;

			case "tool_call":
				this.stopAnimation();
				this.toolCallCount++;
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
				// Display metrics after assistant message
				this.displayMetrics();
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
				// Store token usage for display after assistant message
				this.lastInputTokens = event.inputTokens;
				this.lastOutputTokens = event.outputTokens;
				this.lastCacheReadTokens = event.cacheReadTokens;
				this.lastCacheWriteTokens = event.cacheWriteTokens;
				this.lastReasoningTokens = event.reasoningTokens;
				// Don't stop animation for this event
				break;
		}
	}
}
