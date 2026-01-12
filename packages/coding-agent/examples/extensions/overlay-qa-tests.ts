/**
 * Overlay QA Tests - comprehensive overlay positioning and edge case tests
 *
 * Usage: pi --extension ./examples/extensions/overlay-qa-tests.ts
 *
 * Commands:
 *   /overlay-anchors    - Cycle through all 9 anchor positions
 *   /overlay-margins    - Test margin and offset options
 *   /overlay-stack      - Test stacked overlays
 *   /overlay-overflow   - Test width overflow with streaming process output
 *   /overlay-edge       - Test overlay positioned at terminal edge
 *   /overlay-percent    - Test percentage-based positioning
 *   /overlay-maxheight  - Test maxHeight truncation
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import type { OverlayAnchor, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";

export default function (pi: ExtensionAPI) {
	// Test all 9 anchor positions
	pi.registerCommand("overlay-anchors", {
		description: "Cycle through all anchor positions",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const anchors: OverlayAnchor[] = [
				"top-left",
				"top-center",
				"top-right",
				"left-center",
				"center",
				"right-center",
				"bottom-left",
				"bottom-center",
				"bottom-right",
			];

			let index = 0;
			while (true) {
				const result = await ctx.ui.custom<"next" | "confirm" | "cancel">(
					(_tui, theme, _kb, done) => new AnchorTestComponent(theme, anchors[index]!, done),
					{
						overlay: true,
						overlayOptions: { anchor: anchors[index], width: 40 },
					},
				);

				if (result === "next") {
					index = (index + 1) % anchors.length;
					continue;
				}
				if (result === "confirm") {
					ctx.ui.notify(`Selected: ${anchors[index]}`, "info");
				}
				break;
			}
		},
	});

	// Test margins and offsets
	pi.registerCommand("overlay-margins", {
		description: "Test margin and offset options",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const configs: { name: string; options: OverlayOptions }[] = [
				{ name: "No margin (top-left)", options: { anchor: "top-left", width: 35 } },
				{ name: "Margin: 3 all sides", options: { anchor: "top-left", width: 35, margin: 3 } },
				{
					name: "Margin: top=5, left=10",
					options: { anchor: "top-left", width: 35, margin: { top: 5, left: 10 } },
				},
				{ name: "Center + offset (10, -3)", options: { anchor: "center", width: 35, offsetX: 10, offsetY: -3 } },
				{ name: "Bottom-right, margin: 2", options: { anchor: "bottom-right", width: 35, margin: 2 } },
			];

			let index = 0;
			while (true) {
				const result = await ctx.ui.custom<"next" | "close">(
					(_tui, theme, _kb, done) => new MarginTestComponent(theme, configs[index]!, done),
					{
						overlay: true,
						overlayOptions: configs[index]!.options,
					},
				);

				if (result === "next") {
					index = (index + 1) % configs.length;
					continue;
				}
				break;
			}
		},
	});

	// Test stacked overlays
	pi.registerCommand("overlay-stack", {
		description: "Test stacked overlays",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			// Three large overlays that overlap in the center area
			// Each offset slightly so you can see the stacking

			ctx.ui.notify("Showing overlay 1 (back)...", "info");
			const p1 = ctx.ui.custom<string>(
				(_tui, theme, _kb, done) => new StackOverlayComponent(theme, 1, "back (red border)", done),
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: 50, offsetX: -8, offsetY: -4, maxHeight: 15 },
				},
			);

			await sleep(400);

			ctx.ui.notify("Showing overlay 2 (middle)...", "info");
			const p2 = ctx.ui.custom<string>(
				(_tui, theme, _kb, done) => new StackOverlayComponent(theme, 2, "middle (green border)", done),
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: 50, offsetX: 0, offsetY: 0, maxHeight: 15 },
				},
			);

			await sleep(400);

			ctx.ui.notify("Showing overlay 3 (front)...", "info");
			const p3 = ctx.ui.custom<string>(
				(_tui, theme, _kb, done) => new StackOverlayComponent(theme, 3, "front (blue border)", done),
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: 50, offsetX: 8, offsetY: 4, maxHeight: 15 },
				},
			);

			// Wait for all to close
			const results = await Promise.all([p1, p2, p3]);
			ctx.ui.notify(`Closed in order: ${results.join(", ")}`, "info");
		},
	});

	// Test width overflow scenarios (original crash case) - streams real process output
	pi.registerCommand("overlay-overflow", {
		description: "Test width overflow with streaming process output",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.ui.custom<void>((tui, theme, _kb, done) => new StreamingOverflowComponent(tui, theme, done), {
				overlay: true,
				overlayOptions: { anchor: "center", width: 90, maxHeight: 20 },
			});
		},
	});

	// Test overlay at terminal edge
	pi.registerCommand("overlay-edge", {
		description: "Test overlay positioned at terminal edge",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new EdgeTestComponent(theme, done), {
				overlay: true,
				overlayOptions: { anchor: "right-center", width: 40, margin: { right: 0 } },
			});
		},
	});

	// Test percentage-based positioning
	pi.registerCommand("overlay-percent", {
		description: "Test percentage-based positioning",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const configs = [
				{ name: "rowPercent: 0 (top)", row: 0, col: 50 },
				{ name: "rowPercent: 50 (middle)", row: 50, col: 50 },
				{ name: "rowPercent: 100 (bottom)", row: 100, col: 50 },
				{ name: "colPercent: 0 (left)", row: 50, col: 0 },
				{ name: "colPercent: 100 (right)", row: 50, col: 100 },
			];

			let index = 0;
			while (true) {
				const config = configs[index]!;
				const result = await ctx.ui.custom<"next" | "close">(
					(_tui, theme, _kb, done) => new PercentTestComponent(theme, config, done),
					{
						overlay: true,
						overlayOptions: {
							width: 30,
							rowPercent: config.row,
							colPercent: config.col,
						},
					},
				);

				if (result === "next") {
					index = (index + 1) % configs.length;
					continue;
				}
				break;
			}
		},
	});

	// Test maxHeight
	pi.registerCommand("overlay-maxheight", {
		description: "Test maxHeight truncation",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new MaxHeightTestComponent(theme, done), {
				overlay: true,
				overlayOptions: { anchor: "center", width: 50, maxHeight: 10 },
			});
		},
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Base overlay component with common rendering
abstract class BaseOverlay {
	constructor(protected theme: Theme) {}

	protected box(lines: string[], width: number, title?: string): string[] {
		const th = this.theme;
		const innerW = width - 2;
		const result: string[] = [];

		const titleStr = title ? truncateToWidth(` ${title} `, innerW) : "";
		const titleW = visibleWidth(titleStr);
		const topLine = "─".repeat(Math.floor((innerW - titleW) / 2));
		const topLine2 = "─".repeat(Math.max(0, innerW - titleW - topLine.length));
		result.push(th.fg("border", `╭${topLine}`) + th.fg("accent", titleStr) + th.fg("border", `${topLine2}╮`));

		for (const line of lines) {
			result.push(th.fg("border", "│") + truncateToWidth(line, innerW, "...", true) + th.fg("border", "│"));
		}

		result.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
		return result;
	}

	invalidate(): void {}
	dispose(): void {}
}

// Anchor position test
class AnchorTestComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private anchor: OverlayAnchor,
		private done: (result: "next" | "confirm" | "cancel") => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done("cancel");
		} else if (matchesKey(data, "return")) {
			this.done("confirm");
		} else if (matchesKey(data, "space") || matchesKey(data, "right")) {
			this.done("next");
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		return this.box(
			[
				"",
				` Current: ${th.fg("accent", this.anchor)}`,
				"",
				` ${th.fg("dim", "Space/→ = next anchor")}`,
				` ${th.fg("dim", "Enter = confirm")}`,
				` ${th.fg("dim", "Esc = cancel")}`,
				"",
			],
			width,
			"Anchor Test",
		);
	}
}

// Margin/offset test
class MarginTestComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private config: { name: string; options: OverlayOptions },
		private done: (result: "next" | "close") => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done("close");
		} else if (matchesKey(data, "space") || matchesKey(data, "right")) {
			this.done("next");
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		return this.box(
			[
				"",
				` ${th.fg("accent", this.config.name)}`,
				"",
				` ${th.fg("dim", "Space/→ = next config")}`,
				` ${th.fg("dim", "Esc = close")}`,
				"",
			],
			width,
			"Margin Test",
		);
	}
}

// Stacked overlay test
class StackOverlayComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private num: number,
		private position: string,
		private done: (result: string) => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "return")) {
			this.done(`Overlay ${this.num}`);
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		// Use different colors for each overlay to show stacking
		const colors = ["error", "success", "accent"] as const;
		const color = colors[(this.num - 1) % colors.length]!;
		const innerW = width - 2;
		const border = (char: string) => th.fg(color, char);
		const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
		const lines: string[] = [];

		lines.push(border(`╭${"─".repeat(innerW)}╮`));
		lines.push(border("│") + padLine(` Overlay ${th.fg("accent", `#${this.num}`)}`) + border("│"));
		lines.push(border("│") + padLine(` Layer: ${th.fg(color, this.position)}`) + border("│"));
		lines.push(border("│") + padLine("") + border("│"));
		// Add extra lines to make it taller
		for (let i = 0; i < 5; i++) {
			lines.push(border("│") + padLine(` ${"░".repeat(innerW - 2)} `) + border("│"));
		}
		lines.push(border("│") + padLine("") + border("│"));
		lines.push(border("│") + padLine(th.fg("dim", " Press Enter/Esc to close")) + border("│"));
		lines.push(border(`╰${"─".repeat(innerW)}╯`));

		return lines;
	}
}

// Streaming overflow test - spawns real process with colored output (original crash scenario)
class StreamingOverflowComponent extends BaseOverlay {
	private lines: string[] = [];
	private proc: ReturnType<typeof spawn> | null = null;
	private scrollOffset = 0;
	private maxVisibleLines = 15;
	private finished = false;
	private disposed = false;

	constructor(
		private tui: TUI,
		theme: Theme,
		private done: () => void,
	) {
		super(theme);
		this.startProcess();
	}

	private startProcess(): void {
		// Run a command that produces many lines with ANSI colors
		// Using find with -ls produces file listings, or use ls --color
		this.proc = spawn("bash", [
			"-c",
			`
			echo "Starting streaming overflow test (30+ seconds)..."
			echo "This simulates subagent output with colors, hyperlinks, and long paths"
			echo ""
			for i in $(seq 1 100); do
				# Simulate long file paths with OSC 8 hyperlinks (clickable) - tests width overflow
				DIR="/Users/nicobailon/Documents/development/pi-mono/packages/coding-agent/src/modes/interactive"
				FILE="\${DIR}/components/very-long-component-name-that-exceeds-width-\${i}.ts"
				echo -e "\\033]8;;file://\${FILE}\\007▶ read: \${FILE}\\033]8;;\\007"
				
				# Add some colored status messages with long text
				if [ $((i % 5)) -eq 0 ]; then
					echo -e "  \\033[32m✓ Successfully processed \${i} files in /Users/nicobailon/Documents/development/pi-mono\\033[0m"
				fi
				if [ $((i % 7)) -eq 0 ]; then
					echo -e "  \\033[33m⚠ Warning: potential issue detected at line \${i} in very-long-component-name-that-exceeds-width.ts\\033[0m"
				fi
				if [ $((i % 11)) -eq 0 ]; then
					echo -e "  \\033[31m✗ Error: file not found /some/really/long/path/that/definitely/exceeds/the/overlay/width/limit/file-\${i}.ts\\033[0m"
				fi
				sleep 0.3
			done
			echo ""
			echo -e "\\033[32m✓ Complete - 100 files processed in 30 seconds\\033[0m"
			echo "Press Esc to close"
			`,
		]);

		this.proc.stdout?.on("data", (data: Buffer) => {
			if (this.disposed) return; // Guard against callbacks after dispose
			const text = data.toString();
			const newLines = text.split("\n");
			for (const line of newLines) {
				if (line) this.lines.push(line);
			}
			// Auto-scroll to bottom
			this.scrollOffset = Math.max(0, this.lines.length - this.maxVisibleLines);
			this.tui.requestRender();
		});

		this.proc.stderr?.on("data", (data: Buffer) => {
			if (this.disposed) return; // Guard against callbacks after dispose
			this.lines.push(this.theme.fg("error", data.toString().trim()));
			this.tui.requestRender();
		});

		this.proc.on("close", () => {
			if (this.disposed) return; // Guard against callbacks after dispose
			this.finished = true;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.proc?.kill();
			this.done();
		} else if (matchesKey(data, "up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui.requestRender(); // Trigger re-render after scroll
		} else if (matchesKey(data, "down")) {
			this.scrollOffset = Math.min(Math.max(0, this.lines.length - this.maxVisibleLines), this.scrollOffset + 1);
			this.tui.requestRender(); // Trigger re-render after scroll
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = width - 2;
		const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
		const border = (c: string) => th.fg("border", c);

		const result: string[] = [];
		const title = truncateToWidth(` Streaming Output (${this.lines.length} lines) `, innerW);
		const titlePad = Math.max(0, innerW - visibleWidth(title));
		result.push(border("╭") + th.fg("accent", title) + border("─".repeat(titlePad) + "╮"));

		// Scroll indicators
		const canScrollUp = this.scrollOffset > 0;
		const canScrollDown = this.scrollOffset < this.lines.length - this.maxVisibleLines;
		const scrollInfo = `↑${this.scrollOffset} | ↓${Math.max(0, this.lines.length - this.maxVisibleLines - this.scrollOffset)}`;

		result.push(
			border("│") + padLine(canScrollUp || canScrollDown ? th.fg("dim", ` ${scrollInfo}`) : "") + border("│"),
		);

		// Visible lines - truncate long lines to fit within border
		const visibleLines = this.lines.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleLines);
		for (const line of visibleLines) {
			result.push(border("│") + padLine(` ${line}`) + border("│"));
		}

		// Pad to maxVisibleLines
		for (let i = visibleLines.length; i < this.maxVisibleLines; i++) {
			result.push(border("│") + padLine("") + border("│"));
		}

		const status = this.finished ? th.fg("success", "✓ Done") : th.fg("warning", "● Running");
		result.push(border("│") + padLine(` ${status} ${th.fg("dim", "| ↑↓ scroll | Esc close")}`) + border("│"));
		result.push(border(`╰${"─".repeat(innerW)}╯`));

		return result;
	}

	dispose(): void {
		this.disposed = true;
		this.proc?.kill();
	}
}

// Edge position test
class EdgeTestComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private done: () => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done();
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		return this.box(
			[
				"",
				" This overlay is at the",
				" right edge of terminal.",
				"",
				` ${th.fg("dim", "Verify right border")}`,
				` ${th.fg("dim", "aligns with edge.")}`,
				"",
				` ${th.fg("dim", "Press Esc to close")}`,
				"",
			],
			width,
			"Edge Test",
		);
	}
}

// Percentage positioning test
class PercentTestComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private config: { name: string; row: number; col: number },
		private done: (result: "next" | "close") => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done("close");
		} else if (matchesKey(data, "space") || matchesKey(data, "right")) {
			this.done("next");
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		return this.box(
			[
				"",
				` ${th.fg("accent", this.config.name)}`,
				"",
				` ${th.fg("dim", "Space/→ = next")}`,
				` ${th.fg("dim", "Esc = close")}`,
				"",
			],
			width,
			"Percent Test",
		);
	}
}

// MaxHeight test - renders 20 lines, truncated to 10 by maxHeight
class MaxHeightTestComponent extends BaseOverlay {
	constructor(
		theme: Theme,
		private done: () => void,
	) {
		super(theme);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done();
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		// Intentionally render 21 lines - maxHeight: 10 will truncate to first 10
		// You should see header + lines 1-6, with bottom border cut off
		const contentLines: string[] = [
			th.fg("warning", " ⚠ Rendering 21 lines, maxHeight: 10"),
			th.fg("dim", " Lines 11-21 truncated (no bottom border)"),
			"",
		];

		for (let i = 1; i <= 14; i++) {
			contentLines.push(` Line ${i} of 14`);
		}

		contentLines.push("", th.fg("dim", " Press Esc to close"));

		return this.box(contentLines, width, "MaxHeight Test");
	}
}
