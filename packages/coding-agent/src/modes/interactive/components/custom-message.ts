import type { TextContent } from "@mariozechner/pi-ai";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { HookMessage, HookMessageRenderer } from "../../../core/hooks/types.js";
import type { CustomMessageEntry } from "../../../core/session-manager.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a custom message entry from hooks.
 * Uses distinct styling to differentiate from user messages.
 */
export class CustomMessageComponent extends Container {
	private entry: CustomMessageEntry;
	private customRenderer?: HookMessageRenderer;
	private box: Box;
	private _expanded = false;

	constructor(entry: CustomMessageEntry, customRenderer?: HookMessageRenderer) {
		super();
		this.entry = entry;
		this.customRenderer = customRenderer;

		this.addChild(new Spacer(1));

		// Create box with purple background
		this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		this.addChild(this.box);

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	private rebuild(): void {
		this.box.clear();

		// Convert entry to HookMessage for renderer
		const message: HookMessage = {
			customType: this.entry.customType,
			content: this.entry.content,
			display: this.entry.display,
			details: this.entry.details,
		};

		// Try custom renderer first
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(message, { expanded: this._expanded }, theme);
				if (component) {
					this.box.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// Default rendering: label + content
		const label = theme.fg("customMessageLabel", `\x1b[1m[${this.entry.customType}]\x1b[22m`);
		this.box.addChild(new Text(label, 0, 0));
		this.box.addChild(new Spacer(1));

		// Extract text content
		let text: string;
		if (typeof this.entry.content === "string") {
			text = this.entry.content;
		} else {
			text = this.entry.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		this.box.addChild(
			new Markdown(text, 0, 0, getMarkdownTheme(), {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}
}
