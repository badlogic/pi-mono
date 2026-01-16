/**
 * Load file into editor - for testing editor scrolling
 *
 * Usage: pi --extension ./examples/extensions/load-file.ts
 *
 * Commands:
 *   /load [path]  - Load file into editor (defaults to README.md)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("load", {
		description: "Load file into editor (defaults to README.md)",
		handler: async (args, ctx) => {
			const filePath = args.trim() || "README.md";
			const fullPath = path.resolve(filePath);

			if (!fs.existsSync(fullPath)) {
				ctx.ui.notify(`File not found: ${fullPath}`, "error");
				return;
			}

			try {
				const content = fs.readFileSync(fullPath, "utf-8");
				ctx.ui.setEditorText(content);
				ctx.ui.notify(`Loaded ${filePath} (${content.split("\n").length} lines)`);
			} catch (err) {
				ctx.ui.notify(`Failed to read file: ${err}`, "error");
			}
		},
	});
}
