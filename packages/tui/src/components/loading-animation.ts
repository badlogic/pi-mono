import chalk from "chalk";
import type { TUI } from "../tui.js";
import { TextComponent } from "./text-component.js";

/**
 * LoadingAnimation component that updates every 80ms
 * Simulates the animation component that causes flicker in single-buffer mode
 */
export class LoadingAnimation extends TextComponent {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;

	constructor(
		ui: TUI,
		private message: string = "Loading...",
	) {
		super("", { bottom: 1 });
		this.ui = ui;
		this.start();
	}

	start() {
		this.updateDisplay();
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, 80);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setMessage(message: string) {
		this.message = message;
		this.updateDisplay();
	}

	private updateDisplay() {
		const frame = this.frames[this.currentFrame];
		this.setText(`${chalk.cyan(frame)} ${chalk.dim(this.message)}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
