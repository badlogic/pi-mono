/**
 * Test hook demonstrating custom commands, message rendering, and before_agent_start.
 */
import type { HookAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

export default function (pi: HookAPI) {
	// Track whether injection is enabled
	let injectEnabled = false;

	// Register a custom message renderer for our "test-info" type
	pi.registerMessageRenderer("test-info", (message, options, theme) => {
		const box = new Box(0, 0, (t) => theme.bg("customMessageBg", t));

		const label = theme.fg("successText", "[TEST INFO]");
		box.addChild(new Text(label, 0, 0));

		const content =
			typeof message.content === "string"
				? message.content
				: message.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("");

		box.addChild(new Text(theme.fg("successText", content), 0, 1));

		if (options.expanded && message.details) {
			box.addChild(new Text(theme.fg("dim", `Details: ${JSON.stringify(message.details)}`), 0, 2));
		}

		return box;
	});

	// Register /test-msg command
	pi.registerCommand("test-msg", {
		description: "Send a test custom message",
		handler: async (ctx) => {
			pi.sendMessage({
				customType: "test-info",
				content: "This is a test message with custom rendering!",
				display: true,
				details: { timestamp: Date.now(), source: "test-command hook" },
			});
		},
	});

	// Register /test-hidden command
	pi.registerCommand("test-hidden", {
		description: "Send a hidden message (display: false)",
		handler: async (ctx) => {
			pi.sendMessage({
				customType: "test-info",
				content: "This message is in context but not displayed",
				display: false,
			});
			ctx.ui.notify("Sent hidden message (check session file)");
		},
	});

	// Register /test-inject command to toggle before_agent_start injection
	pi.registerCommand("test-inject", {
		description: "Toggle context injection before agent starts",
		handler: async (ctx) => {
			injectEnabled = !injectEnabled;
			ctx.ui.notify(`Context injection ${injectEnabled ? "enabled" : "disabled"}`);
		},
	});

	// Demonstrate before_agent_start: inject context when enabled
	pi.on("before_agent_start", async (event, ctx) => {
		if (!injectEnabled) return;

		// Return a message to inject before the user's prompt
		return {
			message: {
				customType: "test-info",
				content: `[Injected context for prompt: "${event.prompt.slice(0, 50)}..."]`,
				display: true,
				details: { injectedAt: Date.now() },
			},
		};
	});
}
