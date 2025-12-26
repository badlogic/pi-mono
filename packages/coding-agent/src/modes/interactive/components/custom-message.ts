import type { TextContent } from "@mariozechner/pi-ai";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { CustomMessageRenderer } from "../../../core/hooks/types.js";
import type { CustomMessageEntry } from "../../../core/session-manager.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a custom message entry from hooks.
 * Uses distinct styling to differentiate from user messages.
 */
export class CustomMessageComponent extends Container {
	constructor(entry: CustomMessageEntry, customRenderer?: CustomMessageRenderer) {
		super();

		this.addChild(new Spacer(1));

		// Create box with purple background
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));

		// Try custom renderer first
		if (customRenderer) {
			try {
				const component = customRenderer(entry, { expanded: false }, theme);
				if (component) {
					box.addChild(component);
					this.addChild(box);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// Default rendering: label + content
		const label = theme.fg("customMessageLabel", `\x1b[1m[${entry.customType}]\x1b[22m`);
		box.addChild(new Text(label, 0, 0));
		box.addChild(new Spacer(1));

		// Extract text content
		let text: string;
		if (typeof entry.content === "string") {
			text = entry.content;
		} else {
			text = entry.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		box.addChild(
			new Markdown(text, 0, 0, getMarkdownTheme(), {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);

		this.addChild(box);
	}
}
