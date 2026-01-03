/**
 * Environment detection utilities for terminal capabilities.
 */

/**
 * Detects if running in a headless environment (SSH, no display, etc.)
 * where browser auto-open and hyperlinks won't work properly.
 */
export function isHeadlessEnvironment(): boolean {
	// SSH session detection
	const isSSH = !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION);

	// No graphical display (Linux/Unix)
	const noDisplay = process.platform !== "win32" && process.platform !== "darwin" && !process.env.DISPLAY;

	// Dumb terminal
	const isDumbTerminal = process.env.TERM === "dumb";

	// Running inside tmux (may not pass through OSC 8 hyperlinks)
	const inTmux = !!process.env.TMUX;

	// Running inside screen
	const inScreen = !!process.env.STY;

	return isSSH || noDisplay || isDumbTerminal || inTmux || inScreen;
}

/**
 * Detects if the terminal likely supports OSC 8 hyperlinks.
 * This is a best-effort detection since there's no reliable way to query support.
 */
export function supportsHyperlinks(): boolean {
	// If in a headless environment, hyperlinks likely won't work
	if (isHeadlessEnvironment()) {
		return false;
	}

	// Known terminals with good hyperlink support
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
	const term = process.env.TERM?.toLowerCase() || "";

	// Terminals known to support OSC 8 hyperlinks
	const supportedTerminals = [
		"iterm.app",
		"hyper",
		"wezterm",
		"kitty",
		"alacritty",
		"vscode",
		"ghostty",
		"contour",
		"foot",
	];

	if (supportedTerminals.some((t) => termProgram.includes(t) || term.includes(t))) {
		return true;
	}

	// Check for specific environment variables
	if (process.env.KITTY_WINDOW_ID || process.env.WEZTERM_PANE || process.env.ITERM_SESSION_ID) {
		return true;
	}

	// Default to false for unknown terminals - safer to show plain URL
	return false;
}

/**
 * Detects if we can attempt to auto-open a browser.
 * Returns false for SSH sessions and environments without a display.
 */
export function canOpenBrowser(): boolean {
	// macOS and Windows generally always have a way to open URLs
	if (process.platform === "darwin" || process.platform === "win32") {
		// But not if we're in an SSH session
		if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
			return false;
		}
		return true;
	}

	// Linux/Unix needs DISPLAY or Wayland
	if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
		return false;
	}

	// SSH session without X forwarding won't work
	if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
		// Check if X11 forwarding is enabled (DISPLAY would be set to something like localhost:10.0)
		if (!process.env.DISPLAY) {
			return false;
		}
	}

	return true;
}
