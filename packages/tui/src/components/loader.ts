import type { TUI } from "../tui.js";
import { visibleWidth } from "../utils.js";
import { Text } from "./text.js";

export type LoaderState = "idle" | "running" | "stopped" | "disposed";

/**
 * Loader component that updates with a moonwalking stickman animation.
 * Kept as a single-line loader so it still fits the current status row layout.
 */
export class Loader extends Text {
	private readonly frames = ["▱▱▱", "▰▱▱", "▰▰▱", "▰▰▰", "▱▱▱"];

	private readonly frameWidth = Math.max(...this.frames.map((frame) => visibleWidth(frame)));

	private readonly frameIntervalMs = 100;

	private currentFrame = 0;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private ui: TUI | null = null;

	private state: LoaderState = "idle";
	private epoch = 0;
	private startTime: number | null = null;
	private elapsedAtStop = 0;

	constructor(
		ui: TUI,
		private spinnerColorFn: (str: string) => string,
		private messageColorFn: (str: string) => string,
		private message: string = "Loading...",
	) {
		super("", 1, 0);
		this.ui = ui;
		this.start();
	}

	override render(width: number): string[] {
		if (this.state === "disposed") {
			return [""];
		}

		const rawFrame = this.frames[this.currentFrame] ?? this.frames[0];
		const paddedFrame = this.padFrame(rawFrame);
		const frame = this.spinnerColorFn(paddedFrame);
		const prefix = `${frame} ${this.messageColorFn(this.message)}`;

		let elapsed = this.elapsedAtStop;
		if (this.state === "running" && this.startTime !== null) {
			elapsed = performance.now() - this.startTime;
		}

		if (elapsed === 0 && this.state !== "running") {
			if (this.text !== prefix) {
				this.setText(prefix);
			}
			return super.render(width);
		}

		const totalTenths = Math.floor(elapsed / 100);
		const tenths = totalTenths % 10;
		const totalSeconds = Math.floor(totalTenths / 10);
		const seconds = totalSeconds % 60;
		const minutes = Math.floor(totalSeconds / 60);

		const minStr = minutes.toString().padStart(2, "0");
		const secStr = seconds.toString().padStart(2, "0");
		const timerStr = this.messageColorFn(`${minStr}:${secStr}.${tenths}`);

		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const prefixWidth = visibleWidth(prefix);
		const timerWidth = visibleWidth(timerStr);

		let nextText: string;
		if (prefixWidth + timerWidth + 2 <= contentWidth) {
			const padding = " ".repeat(contentWidth - prefixWidth - timerWidth);
			nextText = prefix + padding + timerStr;
		} else {
			nextText = `${prefix}  ${timerStr}`;
		}

		if (this.text !== nextText) {
			this.setText(nextText);
		}

		return super.render(width);
	}

	start() {
		if (this.state === "disposed" || this.state === "running") {
			return;
		}

		this.state = "running";
		this.epoch++;
		this.currentFrame = 0;
		this.startTime = performance.now();
		this.elapsedAtStop = 0;

		this.updateDisplay();

		const currentEpoch = this.epoch;
		this.intervalId = setInterval(() => {
			if (this.epoch !== currentEpoch || this.state !== "running") {
				this.cleanupInterval();
				return;
			}

			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, this.frameIntervalMs);
	}

	stop() {
		if (this.state === "disposed" || this.state === "stopped" || this.state === "idle") {
			return;
		}

		if (this.state === "running" && this.startTime !== null) {
			this.elapsedAtStop = performance.now() - this.startTime;
		}

		this.state = "stopped";
		this.epoch++;
		this.cleanupInterval();
		this.updateDisplay();
	}

	dispose() {
		if (this.state === "disposed") {
			return;
		}

		if (this.state === "running" && this.startTime !== null) {
			this.elapsedAtStop = performance.now() - this.startTime;
		}

		this.state = "disposed";
		this.epoch++;
		this.cleanupInterval();
		this.ui = null;
		this.cachedLines = undefined;
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.text = "";
	}

	setMessage(message: string) {
		if (this.state === "disposed") {
			return;
		}

		this.message = message;
		this.updateDisplay();
	}

	private cleanupInterval() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private padFrame(frame: string): string {
		const padding = Math.max(0, this.frameWidth - visibleWidth(frame));
		return frame + " ".repeat(padding);
	}

	private updateDisplay() {
		if (this.state === "disposed") {
			return;
		}

		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
