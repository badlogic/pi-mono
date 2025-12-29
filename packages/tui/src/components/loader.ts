import type { TUI } from "../tui.js";
import { Text } from "./text.js";

/**
 * Loader component that updates periodically with a spinning animation.
 */
export interface LoaderOptions {
	/** Animation frames to use (defaults to braille spinner) */
	frames?: string[];
	/** Interval between frames in ms (defaults to 80ms) */
	intervalMs?: number;
}

export class Loader extends Text {
	private frames: string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private intervalMs = 80;
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;

	constructor(
		ui: TUI,
		private spinnerColorFn: (str: string) => string,
		private messageColorFn: (str: string) => string,
		private message: string = "Loading...",
		options: LoaderOptions = {},
	) {
		super("", 1, 0);
		this.ui = ui;
		if (options.frames && options.frames.length > 0) {
			this.frames = options.frames;
		}
		if (typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs) && options.intervalMs > 0) {
			this.intervalMs = options.intervalMs;
		}
		this.start();
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start() {
		this.updateDisplay();
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, this.intervalMs);
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
		this.setText(`${this.spinnerColorFn(frame)} ${this.messageColorFn(this.message)}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
