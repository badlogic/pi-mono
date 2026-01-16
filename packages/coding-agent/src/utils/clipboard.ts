import { execSync, spawn } from "child_process";
import { platform } from "os";
import { isWaylandSession } from "./clipboard-image.js";

export function copyToClipboard(text: string): void {
	const p = platform();
	const options = { input: text, timeout: 5000 };

	try {
		if (p === "darwin") {
			execSync("pbcopy", options);
		} else if (p === "win32") {
			execSync("clip", options);
		} else {
			// Linux - try wl-copy for Wayland, fall back to xclip/xsel for X11
			const isWayland = isWaylandSession();
			if (isWayland) {
				try {
					// Verify wl-copy exists (spawn errors are async and won't be caught)
					execSync("which wl-copy", { stdio: "ignore" });
					// wl-copy with execSync hangs due to fork behavior; use spawn instead
					const proc = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
					proc.stdin.on("error", () => {
						// Ignore EPIPE errors if wl-copy exits early
					});
					proc.stdin.write(text);
					proc.stdin.end();
					proc.unref();
				} catch {
					// Fall back to xclip/xsel (works on XWayland)
					try {
						execSync("xclip -selection clipboard", options);
					} catch {
						execSync("xsel --clipboard --input", options);
					}
				}
			} else {
				try {
					execSync("xclip -selection clipboard", options);
				} catch {
					execSync("xsel --clipboard --input", options);
				}
			}
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (p === "linux") {
			const tools = isWaylandSession() ? "wl-copy, xclip, or xsel" : "xclip or xsel";
			throw new Error(`Failed to copy to clipboard. Install ${tools}: ${msg}`);
		}
		throw new Error(`Failed to copy to clipboard: ${msg}`);
	}
}
