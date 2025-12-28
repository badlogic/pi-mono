import type { TextContent } from "@mariozechner/pi-ai";
import type { Component } from "@mariozechner/pi-tui";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { HookMessageRenderer } from "../../../core/hooks/types.js";
import type { HookMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a custom message entry from hooks.
 * Uses distinct styling to differentiate from user messages.
 */
export class HookMessageComponent extends Container {
	private message: HookMessage<unknown>;
	private customRenderer?: HookMessageRenderer;
	private box: Box;
	private customComponent?: Component;
	private _expanded = false;

	constructor(message: HookMessage<unknown>, customRenderer?: HookMessageRenderer) {
		super();
		this.message = message;
		this.customRenderer = customRenderer;

		this.addChild(new Spacer(1));

		// Create box with purple background (used for default rendering)
		this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	private rebuild(): void {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(this.message, { expanded: this._expanded }, theme);
				if (component) {
					// Custom renderer provides its own styled component
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// Default rendering uses our box
		this.addChild(this.box);
		this.box.clear();

		// Default rendering: label + content
		const label = theme.fg("customMessageLabel", `\x1b[1m[${this.message.customType}]\x1b[22m`);
		this.box.addChild(new Text(label, 0, 0));
		this.box.addChild(new Spacer(1));

		// Extract text content
		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else {
			text = this.message.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		// Limit lines when collapsed
		if (!this._expanded) {
			const lines = text.split("\n");
			if (lines.length > 5) {
				text = `${lines.slice(0, 5).join("\n")}\n...`;
			}
		}

		this.box.addChild(
			new Markdown(text, 0, 0, getMarkdownTheme(), {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}
}
