import { Container, Text } from "@mariozechner/pi-tui";
import type { EmbeddedSessionRefEntry } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";

export interface EmbeddedSessionRefComponentConfig {
	entry: EmbeddedSessionRefEntry;
}

/**
 * Component that renders an embedded session reference in the parent chat.
 * Shows a collapsible block with summary and metadata.
 */
export class EmbeddedSessionRefComponent extends Container {
	private entry: EmbeddedSessionRefEntry;
	private expanded = false;

	constructor(config: EmbeddedSessionRefComponentConfig) {
		super();
		this.entry = config.entry;
		this.renderContent();
	}

	private renderContent(): void {
		this.clear();

		const { entry } = this;
		const icon = entry.cancelled ? "○" : "●";
		const status = entry.cancelled ? "cancelled" : "completed";
		const duration = this.formatDuration(entry.durationMs);

		// Header line
		const header = [
			theme.fg(entry.cancelled ? "dim" : "accent", icon),
			theme.fg("muted", " Embedded: "),
			theme.bold(entry.title ?? "Session"),
			theme.fg("dim", ` (${status}, ${duration}, ${entry.messageCount} messages)`),
		].join("");

		this.addChild(new Text(header, 1, 0));

		// Summary (if present) - always show truncated in collapsed view
		if (entry.summary) {
			const summaryText = this.expanded ? entry.summary : entry.summary.slice(0, 200);
			const ellipsis = !this.expanded && entry.summary.length > 200 ? "..." : "";
			this.addChild(new Text(theme.fg("text", `  ${summaryText}${ellipsis}`), 1, 0));
		}

		// Files modified (collapsed view)
		if (entry.filesModified?.length && !this.expanded) {
			const count = entry.filesModified.length;
			const preview = entry.filesModified
				.slice(0, 3)
				.map((f) => f.split("/").pop())
				.join(", ");
			const more = count > 3 ? ` +${count - 3} more` : "";
			this.addChild(new Text(theme.fg("dim", `  Modified: ${preview}${more}`), 1, 0));
		}

		// Expanded details
		if (this.expanded) {
			if (entry.filesRead?.length) {
				this.addChild(new Text(theme.fg("dim", `  Read: ${entry.filesRead.join(", ")}`), 1, 0));
			}
			if (entry.filesModified?.length) {
				this.addChild(new Text(theme.fg("dim", `  Modified: ${entry.filesModified.join(", ")}`), 1, 0));
			}
			if (entry.tokens) {
				const tokens = `${entry.tokens.input}/${entry.tokens.output}`;
				this.addChild(new Text(theme.fg("dim", `  Tokens: ${tokens}`), 1, 0));
			}
		}
	}

	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}m ${secs}s`;
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.renderContent();
	}

	invalidate(): void {
		this.renderContent();
	}
}
