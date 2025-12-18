import { Editor, isShiftTab, Keys } from "@mariozechner/pi-tui";

/**
 * Custom editor that handles Escape and Ctrl+C keys for coding-agent
 */
export class CustomEditor extends Editor {
	public onEscape?: () => void;
	public onCtrlC?: () => void;
	public onShiftTab?: () => void;
	public onCtrlP?: () => void;
	public onCtrlO?: () => void;
	public onCtrlT?: () => void;

	handleInput(data: string): void {
		// Intercept Ctrl+T for thinking block visibility toggle (raw byte or Kitty protocol)
		if ((data === "\x14" || data === Keys.CTRL_T) && this.onCtrlT) {
			this.onCtrlT();
			return;
		}

		// Intercept Ctrl+O for tool output expansion (raw byte or Kitty protocol)
		if ((data === "\x0f" || data === Keys.CTRL_O) && this.onCtrlO) {
			this.onCtrlO();
			return;
		}

		// Intercept Ctrl+P for model cycling (raw byte or Kitty protocol)
		if ((data === "\x10" || data === Keys.CTRL_P) && this.onCtrlP) {
			this.onCtrlP();
			return;
		}

		// Intercept Shift+Tab for thinking level cycling (legacy or Kitty protocol)
		if (isShiftTab(data) && this.onShiftTab) {
			this.onShiftTab();
			return;
		}

		// Intercept Escape key - but only if autocomplete is NOT active
		// (let parent handle escape for autocomplete cancellation)
		if (data === "\x1b" && this.onEscape && !this.isShowingAutocomplete()) {
			this.onEscape();
			return;
		}

		// Intercept Ctrl+C (raw byte or Kitty keyboard protocol)
		if ((data === "\x03" || data === Keys.CTRL_C) && this.onCtrlC) {
			this.onCtrlC();
			return;
		}

		// Pass to parent for normal handling
		super.handleInput(data);
	}
}
