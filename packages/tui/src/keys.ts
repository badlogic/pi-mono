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

/**
 * Check if input matches Ctrl+C (raw byte or Kitty protocol).
 */
export function isCtrlC(data: string): boolean {
	return data === "\x03" || data === Keys.CTRL_C;
}

/**
 * Check if input matches Shift+Tab (legacy or Kitty protocol).
 */
export function isShiftTab(data: string): boolean {
	return data === "\x1b[Z" || data === Keys.SHIFT_TAB;
}
