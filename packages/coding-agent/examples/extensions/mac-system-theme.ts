/**
 * Syncs pi theme with macOS system appearance (dark/light mode).
 *
 * Usage:
 *   pi -e examples/extensions/mac-system-theme.ts
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function isDarkMode(): boolean {
	try {
		execSync("defaults read -g AppleInterfaceStyle", { encoding: "utf-8" });
		return true; // Returns "Dark" if dark mode
	} catch {
		return false; // Throws if light mode
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const theme = isDarkMode() ? "dark" : "light";
		ctx.ui.setTheme(theme);
	});
}
