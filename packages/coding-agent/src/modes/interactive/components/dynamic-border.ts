import type { Component } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

/**
 * Dynamic border component that adjusts to viewport width
 */
export class DynamicBorder implements Component {
	private color: (str: string) => string;

	constructor(color?: (str: string) => string) {
		// Use provided color function, or default to theme border color
		// Theme may not be initialized at construction time, so we check at render time
		this.color = color ?? ((str) => (theme ? theme.fg("border", str) : str));
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}
