import {
	Editor,
	isCtrlC,
	isCtrlD,
	isCtrlG,
	isCtrlO,
	isCtrlP,
	isCtrlT,
	isCtrlZ,
	isEscape,
	isShiftTab,
} from "@mariozechner/pi-tui";

/**
 * Custom editor that handles Escape and Ctrl+C keys for coding-agent
 */
export class CustomEditor extends Editor {
	public onEscape?: () => void;
	public onCtrlC?: () => void;
	public onCtrlD?: () => void;
	public onShiftTab?: () => void;
	public onCtrlP?: () => void;
	public onCtrlO?: () => void;
	public onCtrlT?: () => void;
	public onCtrlG?: () => void;
	public onCtrlZ?: () => void;

	handleInput(data: string): void {
		// Intercept Ctrl+G for external editor
		if (isCtrlG(data) && this.onCtrlG) {
			this.onCtrlG();
			return;
		}

		// Intercept Ctrl+Z for suspend
		if (isCtrlZ(data) && this.onCtrlZ) {
			this.onCtrlZ();
			return;
		}

		// Intercept Ctrl+T for thinking block visibility toggle
		if (isCtrlT(data) && this.onCtrlT) {
			this.onCtrlT();
			return;
		}

		// Intercept Ctrl+O for tool output expansion
		if (isCtrlO(data) && this.onCtrlO) {
			this.onCtrlO();
			return;
		}

		// Intercept Ctrl+P for model cycling
		if (isCtrlP(data) && this.onCtrlP) {
			this.onCtrlP();
			return;
		}

		// Intercept Shift+Tab for thinking level cycling
		if (isShiftTab(data) && this.onShiftTab) {
			this.onShiftTab();
			return;
		}

		// Intercept Escape key - but only if autocomplete is NOT active
		// (let parent handle escape for autocomplete cancellation)
		if (isEscape(data) && this.onEscape && !this.isShowingAutocomplete()) {
			this.onEscape();
			return;
		}

		// Intercept Ctrl+C
		if (isCtrlC(data) && this.onCtrlC) {
			this.onCtrlC();
			return;
		}

		// Intercept Ctrl+D (only when editor is empty)
		if (isCtrlD(data)) {
			if (this.getText().length === 0 && this.onCtrlD) {
				this.onCtrlD();
			}
			// Always consume Ctrl+D (don't pass to parent)
			return;
		}

		// Pass to parent for normal handling
		super.handleInput(data);
	}
}
