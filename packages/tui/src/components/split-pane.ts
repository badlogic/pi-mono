import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

export interface SplitPaneConfig {
	/** Character(s) to use as the vertical divider between panes */
	divider?: string;
	/** Horizontal padding (spaces) inside each pane */
	paddingX?: number;
	/** Add an empty line before first content line and after last in each pane */
	paddingY?: boolean;
	/** Ratio of the left pane to the right pane. 0.4 means 40% of the available width. */
	ratio?: number;
}

const DEFAULT_CONFIG: Required<SplitPaneConfig> = {
	divider: "│",
	paddingX: 0,
	paddingY: false,
	ratio: 0.4,
};

/**
 * SplitPane component that renders two child components side by side.
 * Each pane gets half the available width (minus divider and borders).
 */
export class SplitPane implements Component {
	private left: Component;
	private right: Component;
	private config: Required<SplitPaneConfig>;

	constructor(left: Component, right: Component, config: SplitPaneConfig = {}) {
		this.left = left;
		this.right = right;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	invalidate(): void {
		this.left.invalidate?.();
		this.right.invalidate?.();
	}

	render(width: number): string[] {
		const { divider, paddingX, paddingY, ratio } = this.config;
		const contentWidth = width - visibleWidth(divider); // Divider between panes

		// Each pane gets half the content width
		const leftPaneWidth = Math.floor(contentWidth * ratio);
		const rightPaneWidth = contentWidth - leftPaneWidth;

		// Calculate inner content width (minus padding)
		const leftContentWidth = Math.max(1, leftPaneWidth - paddingX * 2);
		const rightContentWidth = Math.max(1, rightPaneWidth - paddingX * 2);

		// Render children
		let leftLines = this.left.render(leftContentWidth);
		let rightLines = this.right.render(rightContentWidth);

		// Add vertical padding (empty line before and after)
		if (paddingY) {
			leftLines = ["", ...leftLines, ""];
			rightLines = ["", ...rightLines, ""];
		}

		// Pad the shorter array with empty strings
		const maxLines = Math.max(leftLines.length, rightLines.length);
		while (leftLines.length < maxLines) {
			leftLines.push("");
		}
		while (rightLines.length < maxLines) {
			rightLines.push("");
		}

		const result: string[] = [];

		// Merge lines
		for (let i = 0; i < maxLines; i++) {
			const leftContent = this.padLine(leftLines[i] ?? "", leftPaneWidth, paddingX);
			const rightContent = this.padLine(rightLines[i] ?? "", rightPaneWidth, paddingX);
			result.push(leftContent + divider + rightContent);
		}

		return result;
	}

	/**
	 * Pad a line to the target width, applying horizontal padding on both sides.
	 */
	private padLine(line: string, targetWidth: number, paddingX: number): string {
		const padding = " ".repeat(paddingX);
		const lineWidth = visibleWidth(line);
		const innerWidth = targetWidth - paddingX * 2;
		const rightPad = Math.max(0, innerWidth - lineWidth);
		return padding + line + " ".repeat(rightPad) + padding;
	}
}
