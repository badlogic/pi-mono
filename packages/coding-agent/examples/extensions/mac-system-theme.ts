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
		const result = execSync(
			"osascript -e 'tell application \"System Events\" to tell appearance preferences to return dark mode'",
			{ encoding: "utf-8" },
		);
		return result.trim() === "true";
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	let intervalId: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", (_event, ctx) => {
		let currentTheme = isDarkMode() ? "dark" : "light";
		ctx.ui.setTheme(currentTheme);

		intervalId = setInterval(() => {
			const newTheme = isDarkMode() ? "dark" : "light";
			if (newTheme !== currentTheme) {
				currentTheme = newTheme;
				ctx.ui.setTheme(currentTheme);
			}
		}, 2000);
	});

	pi.on("session_shutdown", () => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	});
}
