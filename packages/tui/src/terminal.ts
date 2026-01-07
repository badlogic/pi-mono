import { setKittyProtocolActive } from "./keys.js";
import { StdinBuffer } from "./stdin-buffer.js";

/**
 * Minimal terminal interface for TUI
 */
export interface Terminal {
	// Start the terminal with input and resize handlers
	start(onInput: (data: string) => void, onResize: () => void): void;

	// Stop the terminal and restore state
	stop(): void;

	// Write output to terminal
	write(data: string): void;

	// Get terminal dimensions
	get columns(): number;
	get rows(): number;

	// Whether Kitty keyboard protocol is active
	get kittyProtocolActive(): boolean;

	// Cursor positioning (relative to current position)
	moveBy(lines: number): void; // Move cursor up (negative) or down (positive) by N lines

	// Cursor visibility
	hideCursor(): void; // Hide the cursor
	showCursor(): void; // Show the cursor

	// Clear operations
	clearLine(): void; // Clear current line
	clearFromCursor(): void; // Clear from cursor to end of screen
	clearScreen(): void; // Clear entire screen and move cursor to (0,0)

	// Title operations
	setTitle(title: string): void; // Set terminal window title
}

/**
 * Real terminal using process.stdin/stdout
 */
export class ProcessTerminal implements Terminal {
	private wasRaw = false;
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private _kittyProtocolActive = false;
	private stdinBuffer?: StdinBuffer;
	private stdinDataHandler?: (data: string) => void;

	get kittyProtocolActive(): boolean {
		return this._kittyProtocolActive;
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;

		// Save previous state and enable raw mode
		this.wasRaw = process.stdin.isRaw || false;
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(true);
		}
		process.stdin.setEncoding("utf8");
		process.stdin.resume();

		// Enable bracketed paste mode - terminal will wrap pastes in \x1b[200~ ... \x1b[201~
		process.stdout.write("\x1b[?2004h");

		// Set up resize handler immediately
		process.stdout.on("resize", this.resizeHandler);

		// Query and enable Kitty keyboard protocol
		// The query handler intercepts input temporarily, then installs the user's handler
		// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
		this.queryAndEnableKittyProtocol();
	}

	/**
	 * Set up StdinBuffer to split batched input into individual sequences.
	 * This ensures components receive single events, making matchesKey/isKeyRelease work correctly.
	 * Note: Does NOT register the stdin handler - that's done after the Kitty protocol query.
	 */
	private setupStdinBuffer(): void {
		this.stdinBuffer = new StdinBuffer({ timeout: 10 });

		// Forward individual sequences to the input handler
		this.stdinBuffer.on("data", (sequence) => {
			if (this.inputHandler) {
				this.inputHandler(sequence);
			}
		});

		// Re-wrap paste content with bracketed paste markers for existing editor handling
		this.stdinBuffer.on("paste", (content) => {
			if (this.inputHandler) {
				this.inputHandler(`\x1b[200~${content}\x1b[201~`);
			}
		});

		// Handler that pipes stdin data through the buffer
		// Registration happens after Kitty protocol query completes
		this.stdinDataHandler = (data: string) => {
			this.stdinBuffer!.process(data);
		};
	}

	/**
	 * Query terminal for Kitty keyboard protocol support and enable if available.
	 *
	 * Sends CSI ? u to query current flags. If terminal responds with CSI ? <flags> u,
	 * it supports the protocol and we enable it with CSI > 1 u.
	 *
	 * Non-supporting terminals won't respond, so we use a timeout.
	 */
	private queryAndEnableKittyProtocol(): void {
		const QUERY_TIMEOUT_MS = 100;
		let resolved = false;
		let buffer = "";

		// Kitty protocol response pattern: \x1b[?<flags>u
		const kittyResponsePattern = /\x1b\[\?(\d+)u/;

		const queryHandler = (data: string) => {
			if (resolved) {
				// Query phase done, forward to StdinBuffer
				if (this.stdinBuffer) {
					this.stdinBuffer.process(data);
				}
				return;
			}

			buffer += data;

			// Check if we have a Kitty protocol response
			const match = buffer.match(kittyResponsePattern);
			if (match) {
				resolved = true;
				this._kittyProtocolActive = true;
				setKittyProtocolActive(true);

				// Enable Kitty keyboard protocol (push flags)
				// Flag 1 = disambiguate escape codes
				// Flag 2 = report event types (press/repeat/release)
				process.stdout.write("\x1b[>3u");

				// Remove the response from buffer, forward any remaining input through StdinBuffer
				const remaining = buffer.replace(kittyResponsePattern, "");
				if (remaining && this.stdinBuffer) {
					this.stdinBuffer.process(remaining);
				}

				// Replace query handler with StdinBuffer handler
				process.stdin.removeListener("data", queryHandler);
				if (this.stdinDataHandler) {
					process.stdin.on("data", this.stdinDataHandler);
				}
			}
		};

		// Set up StdinBuffer before query (it will receive input after query completes)
		this.setupStdinBuffer();

		// Temporarily intercept input for the query (before StdinBuffer)
		process.stdin.on("data", queryHandler);

		// Send query
		process.stdout.write("\x1b[?u");

		// Timeout: if no response, terminal doesn't support Kitty protocol
		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				this._kittyProtocolActive = false;
				setKittyProtocolActive(false);

				// Forward any buffered input that wasn't a Kitty response through StdinBuffer
				if (buffer && this.stdinBuffer) {
					this.stdinBuffer.process(buffer);
				}

				// Replace query handler with StdinBuffer handler
				process.stdin.removeListener("data", queryHandler);
				if (this.stdinDataHandler) {
					process.stdin.on("data", this.stdinDataHandler);
				}
			}
		}, QUERY_TIMEOUT_MS);
	}

	stop(): void {
		// Disable bracketed paste mode
		process.stdout.write("\x1b[?2004l");

		// Disable Kitty keyboard protocol (pop the flags we pushed) - only if we enabled it
		if (this._kittyProtocolActive) {
			process.stdout.write("\x1b[<u");
			this._kittyProtocolActive = false;
			setKittyProtocolActive(false);
		}

		// Clean up StdinBuffer
		if (this.stdinBuffer) {
			this.stdinBuffer.destroy();
			this.stdinBuffer = undefined;
		}

		// Remove event handlers
		if (this.stdinDataHandler) {
			process.stdin.removeListener("data", this.stdinDataHandler);
			this.stdinDataHandler = undefined;
		}
		this.inputHandler = undefined;
		if (this.resizeHandler) {
			process.stdout.removeListener("resize", this.resizeHandler);
			this.resizeHandler = undefined;
		}

		// Restore raw mode state
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(this.wasRaw);
		}
	}

	write(data: string): void {
		process.stdout.write(data);
	}

	get columns(): number {
		return process.stdout.columns || 80;
	}

	get rows(): number {
		return process.stdout.rows || 24;
	}

	moveBy(lines: number): void {
		if (lines > 0) {
			// Move down
			process.stdout.write(`\x1b[${lines}B`);
		} else if (lines < 0) {
			// Move up
			process.stdout.write(`\x1b[${-lines}A`);
		}
		// lines === 0: no movement
	}

	hideCursor(): void {
		process.stdout.write("\x1b[?25l");
	}

	showCursor(): void {
		process.stdout.write("\x1b[?25h");
	}

	clearLine(): void {
		process.stdout.write("\x1b[K");
	}

	clearFromCursor(): void {
		process.stdout.write("\x1b[J");
	}

	clearScreen(): void {
		process.stdout.write("\x1b[2J\x1b[H"); // Clear screen and move to home (1,1)
	}

	setTitle(title: string): void {
		// OSC 0;title BEL - set terminal window title
		process.stdout.write(`\x1b]0;${title}\x07`);
	}
}
