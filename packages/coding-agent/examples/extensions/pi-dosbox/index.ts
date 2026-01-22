/**
 * DOSBox extension for pi
 *
 * Usage: pi --extension ./examples/extensions/pi-dosbox
 * Command: /dosbox [bundle.jsdos]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DosboxComponent } from "./src/dosbox-component.js";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("dosbox", {
		description: "Run DOSBox emulator",

		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("DOSBox requires interactive mode", "error");
				return;
			}

			const bundlePath = args?.trim();
			let bundleData: Uint8Array | undefined;
			if (bundlePath) {
				try {
					const resolvedPath = resolve(ctx.cwd, bundlePath);
					bundleData = await readFile(resolvedPath);
				} catch (error) {
					ctx.ui.notify(
						`Failed to load bundle: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}
			}

			await ctx.ui.custom((tui, theme, _kb, done) => {
				const fallbackColor = (s: string) => theme.fg("warning", s);
				return new DosboxComponent(tui, fallbackColor, () => done(undefined), bundleData);
			});
		},
	});
}
