/**
 * Kitty keyboard protocol key sequence helpers.
 *
 * The Kitty keyboard protocol sends enhanced escape sequences in the format:
 *   \x1b[<codepoint>;<modifier>u
 *
 * Modifier values (added to 1):
 *   - Shift: 1 (value 2)
 *   - Alt: 2 (value 3)
 *   - Ctrl: 4 (value 5)
 *   - Super: 8 (value 9)
 *
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */

// Common codepoints
const CODEPOINTS = {
	// Letters (lowercase ASCII)
	a: 97,
	c: 99,
	d: 100,
	e: 101,
	k: 107,
	o: 111,
	p: 112,
	t: 116,
	u: 117,
	w: 119,

	// Special keys
	tab: 9,
	enter: 13,
	backspace: 127,
} as const;

// Modifier bits (before adding 1)
const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
	super: 8,
} as const;

/**
 * Build a Kitty keyboard protocol sequence for a key with modifier.
 */
function kittySequence(codepoint: number, modifier: number): string {
	return `\x1b[${codepoint};${modifier + 1}u`;
}

// Pre-built sequences for common key combinations
export const Keys = {
	// Ctrl+<letter> combinations
	CTRL_A: kittySequence(CODEPOINTS.a, MODIFIERS.ctrl),
	CTRL_C: kittySequence(CODEPOINTS.c, MODIFIERS.ctrl),
	CTRL_D: kittySequence(CODEPOINTS.d, MODIFIERS.ctrl),
	CTRL_E: kittySequence(CODEPOINTS.e, MODIFIERS.ctrl),
	CTRL_K: kittySequence(CODEPOINTS.k, MODIFIERS.ctrl),
	CTRL_O: kittySequence(CODEPOINTS.o, MODIFIERS.ctrl),
	CTRL_P: kittySequence(CODEPOINTS.p, MODIFIERS.ctrl),
	CTRL_T: kittySequence(CODEPOINTS.t, MODIFIERS.ctrl),
	CTRL_U: kittySequence(CODEPOINTS.u, MODIFIERS.ctrl),
	CTRL_W: kittySequence(CODEPOINTS.w, MODIFIERS.ctrl),

	// Enter combinations
	SHIFT_ENTER: kittySequence(CODEPOINTS.enter, MODIFIERS.shift),
	ALT_ENTER: kittySequence(CODEPOINTS.enter, MODIFIERS.alt),
	CTRL_ENTER: kittySequence(CODEPOINTS.enter, MODIFIERS.ctrl),

	// Tab combinations
	SHIFT_TAB: kittySequence(CODEPOINTS.tab, MODIFIERS.shift),

	// Backspace combinations
	ALT_BACKSPACE: kittySequence(CODEPOINTS.backspace, MODIFIERS.alt),
} as const;

/**
 * Check if input matches a Kitty protocol Ctrl+<key> sequence.
 * @param data - The input data to check
 * @param key - Single lowercase letter (e.g., 'c' for Ctrl+C)
 */
export function isKittyCtrl(data: string, key: string): boolean {
	if (key.length !== 1) return false;
	const codepoint = key.charCodeAt(0);
	return data === kittySequence(codepoint, MODIFIERS.ctrl);
}

/**
 * Check if input matches a Kitty protocol key sequence with specific modifier.
 * @param data - The input data to check
 * @param codepoint - ASCII codepoint of the key
 * @param modifier - Modifier value (use MODIFIERS constants)
 */
export function isKittyKey(data: string, codepoint: number, modifier: number): boolean {
	return data === kittySequence(codepoint, modifier);
}

// Raw control character codes
const RAW = {
	CTRL_A: "\x01",
	CTRL_C: "\x03",
	CTRL_D: "\x04",
	CTRL_E: "\x05",
	CTRL_K: "\x0b",
	CTRL_O: "\x0f",
	CTRL_P: "\x10",
	CTRL_T: "\x14",
	CTRL_U: "\x15",
	CTRL_W: "\x17",
	ALT_BACKSPACE: "\x1b\x7f",
	SHIFT_TAB: "\x1b[Z",
} as const;

/**
 * Check if input matches Ctrl+A (raw byte or Kitty protocol).
 */
export function isCtrlA(data: string): boolean {
	return data === RAW.CTRL_A || data === Keys.CTRL_A;
}

/**
 * Check if input matches Ctrl+C (raw byte or Kitty protocol).
 */
export function isCtrlC(data: string): boolean {
	return data === RAW.CTRL_C || data === Keys.CTRL_C;
}

/**
 * Check if input matches Ctrl+D (raw byte or Kitty protocol).
 */
export function isCtrlD(data: string): boolean {
	return data === RAW.CTRL_D || data === Keys.CTRL_D;
}

/**
 * Check if input matches Ctrl+E (raw byte or Kitty protocol).
 */
export function isCtrlE(data: string): boolean {
	return data === RAW.CTRL_E || data === Keys.CTRL_E;
}

/**
 * Check if input matches Ctrl+K (raw byte or Kitty protocol).
 */
export function isCtrlK(data: string): boolean {
	return data === RAW.CTRL_K || data === Keys.CTRL_K;
}

/**
 * Check if input matches Ctrl+O (raw byte or Kitty protocol).
 */
export function isCtrlO(data: string): boolean {
	return data === RAW.CTRL_O || data === Keys.CTRL_O;
}

/**
 * Check if input matches Ctrl+P (raw byte or Kitty protocol).
 */
export function isCtrlP(data: string): boolean {
	return data === RAW.CTRL_P || data === Keys.CTRL_P;
}

/**
 * Check if input matches Ctrl+T (raw byte or Kitty protocol).
 */
export function isCtrlT(data: string): boolean {
	return data === RAW.CTRL_T || data === Keys.CTRL_T;
}

/**
 * Check if input matches Ctrl+U (raw byte or Kitty protocol).
 */
export function isCtrlU(data: string): boolean {
	return data === RAW.CTRL_U || data === Keys.CTRL_U;
}

/**
 * Check if input matches Ctrl+W (raw byte or Kitty protocol).
 */
export function isCtrlW(data: string): boolean {
	return data === RAW.CTRL_W || data === Keys.CTRL_W;
}

/**
 * Check if input matches Alt+Backspace (legacy or Kitty protocol).
 */
export function isAltBackspace(data: string): boolean {
	return data === RAW.ALT_BACKSPACE || data === Keys.ALT_BACKSPACE;
}

/**
 * Check if input matches Shift+Tab (legacy or Kitty protocol).
 */
export function isShiftTab(data: string): boolean {
	return data === RAW.SHIFT_TAB || data === Keys.SHIFT_TAB;
}
