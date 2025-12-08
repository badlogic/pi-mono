/**
 * Component for displaying bash command execution with streaming output.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import { theme } from "../theme/theme.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type TruncationResult, truncateTail } from "../tools/truncate.js";

// Preview line limit when not expanded (matches tool execution behavior)
const PREVIEW_LINES = 20;

export class BashExecutionComponent extends Container {
	private command: string;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | null = null;
	private loader: Loader;
	private truncationResult?: TruncationResult;
	private fullOutputPath?: string;
	private contentText: Text;
	private statusText: Text | null = null;
	private expanded = false;

	constructor(command: string, ui: TUI) {
		super();
		this.command = command;

		// Add spacer
		this.addChild(new Spacer(1));

		// Command header
		const header = new Text(theme.fg("bashMode", theme.bold(`$ ${command}`)), 1, 0);
		this.addChild(header);

		// Output area (will be updated)
		this.contentText = new Text("", 1, 0);
		this.addChild(this.contentText);

		// Loader
		this.loader = new Loader(
			ui,
			(spinner) => theme.fg("bashMode", spinner),
			(text) => theme.fg("muted", text),
			"Running... (esc to cancel)",
		);
		this.addChild(this.loader);
	}

	/**
	 * Set whether the output is expanded (shows full output) or collapsed (preview only).
	 */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	appendOutput(chunk: string): void {
		// Strip ANSI codes and normalize line endings
		const clean = stripAnsi(chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		// Append to output lines
		const newLines = clean.split("\n");
		if (this.outputLines.length > 0 && newLines.length > 0) {
			// Append first chunk to last line (incomplete line continuation)
			this.outputLines[this.outputLines.length - 1] += newLines[0];
			this.outputLines.push(...newLines.slice(1));
		} else {
			this.outputLines.push(...newLines);
		}

		this.updateDisplay();
	}

	setComplete(
		exitCode: number | null,
		cancelled: boolean,
		truncationResult?: TruncationResult,
		fullOutputPath?: string,
	): void {
		this.exitCode = exitCode;
		this.status = cancelled ? "cancelled" : exitCode !== 0 && exitCode !== null ? "error" : "complete";
		this.truncationResult = truncationResult;
		this.fullOutputPath = fullOutputPath;

		// Stop and remove loader
		this.loader.stop();
		this.removeChild(this.loader);

		this.updateDisplay();
	}

	private updateDisplay(): void {
		// Apply truncation for LLM context limits (same limits as bash tool)
		const fullOutput = this.outputLines.join("\n");
		const contextTruncation = truncateTail(fullOutput, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});

		// Get the lines to potentially display (after context truncation)
		const availableLines = contextTruncation.content ? contextTruncation.content.split("\n") : [];

		// Apply preview truncation based on expanded state
		const maxDisplayLines = this.expanded ? availableLines.length : PREVIEW_LINES;
		const displayLines = availableLines.slice(-maxDisplayLines); // Show last N lines (tail)
		const hiddenLineCount = availableLines.length - displayLines.length;

		let displayText = "";
		if (displayLines.length > 0) {
			displayText = displayLines.map((line) => theme.fg("muted", line)).join("\n");
		}

		this.contentText.setText(displayText ? "\n" + displayText : "");

		// Update/add status text if complete
		if (this.status !== "running") {
			if (this.statusText) {
				this.removeChild(this.statusText);
			}

			const statusParts: string[] = [];

			// Show how many lines are hidden (collapsed preview)
			if (hiddenLineCount > 0) {
				statusParts.push(theme.fg("dim", `... ${hiddenLineCount} more lines (ctrl+o to expand)`));
			}

			if (this.status === "cancelled") {
				statusParts.push(theme.fg("warning", "(cancelled)"));
			} else if (this.status === "error") {
				statusParts.push(theme.fg("error", `(exit ${this.exitCode})`));
			}

			// Add truncation warning (context truncation, not preview truncation)
			const wasTruncated = this.truncationResult?.truncated || contextTruncation.truncated;
			if (wasTruncated && this.fullOutputPath) {
				statusParts.push(theme.fg("warning", `Output truncated. Full output: ${this.fullOutputPath}`));
			}

			if (statusParts.length > 0) {
				this.statusText = new Text("\n" + statusParts.join("\n"), 1, 0);
				this.addChild(this.statusText);
			}
		}
	}

	/**
	 * Get the raw output for creating BashExecutionMessage.
	 */
	getOutput(): string {
		return this.outputLines.join("\n");
	}

	/**
	 * Get the command that was executed.
	 */
	getCommand(): string {
		return this.command;
	}
}
