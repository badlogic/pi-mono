import type { Component } from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Dynamic border component that adjusts to viewport width
 */
export class DynamicBorder implements Component {
	private color: (str: string) => string;

	constructor(color: (str: string) => string = chalk.blue) {
		this.color = color;
	}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}
