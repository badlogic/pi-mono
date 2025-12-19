/**
 * TUI session selector for --resume flag
 */

import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import type { SessionManager } from "../core/session-manager.js";
import { SessionSelectorComponent } from "../modes/interactive/components/session-selector.js";

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(sessionManager: SessionManager): Promise<string | null> {
	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new SessionSelectorComponent(
			sessionManager,
			(path: string) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(path);
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
			() => {
				ui.stop();
				process.exit(0);
			},
		);

		ui.addChild(selector);
		ui.setFocus(selector.getSessionList());
		ui.start();
	});
}
