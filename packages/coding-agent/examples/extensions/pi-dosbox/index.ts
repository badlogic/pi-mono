/**
 * DOSBox extension for pi
 *
 * Features:
 * - Persistent DOSBox instance running in background
 * - QuickBASIC 4.5 mounted at C:\QB
 * - /dosbox command to view and interact with DOSBox
 * - dosbox tool for agent to send keys, read screen, take screenshots
 *
 * Usage: pi --extension ./examples/extensions/pi-dosbox
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { DosboxComponent } from "./src/dosbox-component.js";
import { DosboxInstance } from "./src/dosbox-instance.js";

export default function (pi: ExtensionAPI) {
	// Start DOSBox instance at session start
	pi.on("session_start", async () => {
		try {
			await DosboxInstance.getInstance();
		} catch (error) {
			console.error("Failed to start DOSBox:", error);
		}
	});

	// Clean up on session shutdown
	pi.on("session_shutdown", async () => {
		await DosboxInstance.destroyInstance();
	});

	// Register /dosbox command to view DOSBox
	pi.registerCommand("dosbox", {
		description: "View and interact with DOSBox (Ctrl+Q to detach)",

		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("DOSBox requires interactive mode", "error");
				return;
			}

			// Ensure instance is running
			const instance = DosboxInstance.getInstanceSync();
			if (!instance || !instance.isReady()) {
				ctx.ui.notify("DOSBox is not running. It should start automatically.", "error");
				return;
			}

			await ctx.ui.custom((tui, theme, _kb, done) => {
				const fallbackColor = (s: string) => theme.fg("warning", s);
				return new DosboxComponent(tui, fallbackColor, () => done(undefined));
			});
		},
	});

	// Register dosbox tool for agent interaction
	pi.registerTool({
		name: "dosbox",
		label: "DOSBox",
		description: `Interact with DOSBox emulator running QuickBASIC 4.5.
Actions:
- send_keys: Send keystrokes to DOSBox. Use \\n for Enter, \\t for Tab.
- screenshot: Get a PNG screenshot of the current DOSBox screen.
- read_text: Read text-mode screen content (returns null in graphics mode).

QuickBASIC 4.5 is mounted at C:\\QB. Run "C:\\QB\\QB.EXE" to start it.`,
		parameters: Type.Object({
			action: StringEnum(["send_keys", "screenshot", "read_text"] as const, {
				description: "The action to perform",
			}),
			keys: Type.Optional(
				Type.String({
					description:
						"For send_keys: the keys to send. Use \\n for Enter, \\t for Tab, or special:<key> for special keys (enter, backspace, tab, escape, up, down, left, right, f5)",
				}),
			),
		}),

		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { action, keys } = params;

			const instance = DosboxInstance.getInstanceSync();
			if (!instance || !instance.isReady()) {
				return {
					content: [{ type: "text", text: "Error: DOSBox is not running" }],
					details: {},
				};
			}

			switch (action) {
				case "send_keys": {
					if (!keys) {
						return {
							content: [{ type: "text", text: "Error: keys parameter required for send_keys action" }],
							details: {},
						};
					}

					// Handle special keys
					if (keys.startsWith("special:")) {
						const specialKey = keys.slice(8) as
							| "enter"
							| "backspace"
							| "tab"
							| "escape"
							| "up"
							| "down"
							| "left"
							| "right"
							| "f5";
						instance.sendSpecialKey(specialKey);
						return {
							content: [{ type: "text", text: `Sent special key: ${specialKey}` }],
							details: {},
						};
					}

					// Handle escape sequences
					const processedKeys = keys.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");

					instance.sendKeys(processedKeys);
					return {
						content: [{ type: "text", text: `Sent ${processedKeys.length} characters` }],
						details: {},
					};
				}

				case "screenshot": {
					const screenshot = instance.getScreenshot();
					if (!screenshot) {
						return {
							content: [{ type: "text", text: "Error: No frame available yet" }],
							details: {},
						};
					}

					return {
						content: [
							{
								type: "image",
								data: screenshot.base64,
								mimeType: "image/png",
							},
							{
								type: "text",
								text: `Screenshot: ${screenshot.width}x${screenshot.height} pixels`,
							},
						],
						details: {},
					};
				}

				case "read_text": {
					const text = instance.readScreenText();
					if (text === null) {
						const state = instance.getState();
						return {
							content: [
								{
									type: "text",
									text: `Screen is in graphics mode (${state.width}x${state.height}). Use screenshot action to see the display.`,
								},
							],
							details: {},
						};
					}
					return {
						content: [{ type: "text", text: text || "(empty screen)" }],
						details: {},
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Error: Unknown action: ${action}` }],
						details: {},
					};
			}
		},
	});
}
