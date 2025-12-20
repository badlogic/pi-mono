/**
 * Kitty keyboard protocol key sequence helpers.
 *
 * The Kitty keyboard protocol sends enhanced escape sequences in the format:
 *   \x1b[<codepoint>;<modifier>u
 *
 * Modifier bits (before adding 1 for transmission):
 *   - Shift: 1 (value 2)
 *   - Alt: 2 (value 3)
 *   - Ctrl: 4 (value 5)
 *   - Super: 8 (value 9)
 *   - Hyper: 16
 *   - Meta: 32
 *   - Caps_Lock: 64
 *   - Num_Lock: 128
 *
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 *
 * NOTE: Some terminals (e.g., Ghostty on Linux) include lock key states
 * (Caps Lock, Num Lock) in the modifier field. We mask these out when
 * checking for key combinations since they shouldn't affect behavior.
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
	escape: 27,
	tab: 9,
	enter: 13,
	backspace: 127,
} as const;

// Lock key bits to ignore when matching (Caps Lock + Num Lock)
const LOCK_MASK = 64 + 128; // 192

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

/**
 * Parsed Kitty keyboard protocol sequence.
 */
interface ParsedKittySequence {
	codepoint: number;
	modifier: number; // Actual modifier bits (after subtracting 1)
}

/**
 * Parse a Kitty keyboard protocol sequence.
 * Handles formats:
 *   - \x1b[<codepoint>u (no modifier)
 *   - \x1b[<codepoint>;<modifier>u (with modifier)
 *   - \x1b[1;<modifier>A/B/C/D (arrow keys with modifier)
 *
 * Returns null if not a valid Kitty sequence.
 */
// Virtual codepoints for functional keys (negative to avoid conflicts)
const FUNCTIONAL_CODEPOINTS = {
	delete: -10,
	insert: -11,
	pageUp: -12,
	pageDown: -13,
	home: -14,
	end: -15,
} as const;

function parseKittySequence(data: string): ParsedKittySequence | null {
	// Match CSI u format: \x1b[<num>u or \x1b[<num>;<mod>u
	const csiUMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?u$/);
	if (csiUMatch) {
		const codepoint = parseInt(csiUMatch[1]!, 10);
		const modValue = csiUMatch[2] ? parseInt(csiUMatch[2], 10) : 1;
		return { codepoint, modifier: modValue - 1 };
	}

	// Match arrow keys with modifier: \x1b[1;<mod>A/B/C/D
	const arrowMatch = data.match(/^\x1b\[1;(\d+)([ABCD])$/);
	if (arrowMatch) {
		const modValue = parseInt(arrowMatch[1]!, 10);
		// Map arrow letters to virtual codepoints for easier matching
		const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
		const codepoint = arrowCodes[arrowMatch[2]!]!;
		return { codepoint, modifier: modValue - 1 };
	}

	// Match functional keys with ~ terminator: \x1b[<num>~ or \x1b[<num>;<mod>~
	// DELETE=3, INSERT=2, PAGEUP=5, PAGEDOWN=6, etc.
	const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?~$/);
	if (funcMatch) {
		const keyNum = parseInt(funcMatch[1]!, 10);
		const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
		// Map functional key numbers to virtual codepoints
		const funcCodes: Record<number, number> = {
			2: FUNCTIONAL_CODEPOINTS.insert,
			3: FUNCTIONAL_CODEPOINTS.delete,
			5: FUNCTIONAL_CODEPOINTS.pageUp,
			6: FUNCTIONAL_CODEPOINTS.pageDown,
			7: FUNCTIONAL_CODEPOINTS.home, // Alternative home
			8: FUNCTIONAL_CODEPOINTS.end, // Alternative end
		};
		const codepoint = funcCodes[keyNum];
		if (codepoint !== undefined) {
			return { codepoint, modifier: modValue - 1 };
		}
	}

	// Match Home/End with modifier: \x1b[1;<mod>H/F
	const homeEndMatch = data.match(/^\x1b\[1;(\d+)([HF])$/);
	if (homeEndMatch) {
		const modValue = parseInt(homeEndMatch[1]!, 10);
		const codepoint = homeEndMatch[2] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
		return { codepoint, modifier: modValue - 1 };
	}

	return null;
}

/**
 * Check if a Kitty sequence matches the expected codepoint and modifier,
 * ignoring lock key bits (Caps Lock, Num Lock).
 */
function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;

	// Mask out lock bits from both sides for comparison
	const actualMod = parsed.modifier & ~LOCK_MASK;
	const expectedMod = expectedModifier & ~LOCK_MASK;

	return parsed.codepoint === expectedCodepoint && actualMod === expectedMod;
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
 * Ignores lock key bits (Caps Lock, Num Lock).
 * @param data - The input data to check
 * @param key - Single lowercase letter (e.g., 'c' for Ctrl+C)
 */
export function isKittyCtrl(data: string, key: string): boolean {
	if (key.length !== 1) return false;
	const codepoint = key.charCodeAt(0);
	// Check exact match first (fast path)
	if (data === kittySequence(codepoint, MODIFIERS.ctrl)) return true;
	// Check with lock bits masked out
	return matchesKittySequence(data, codepoint, MODIFIERS.ctrl);
}

/**
 * Check if input matches a Kitty protocol key sequence with specific modifier.
 * Ignores lock key bits (Caps Lock, Num Lock).
 * @param data - The input data to check
 * @param codepoint - ASCII codepoint of the key
 * @param modifier - Modifier value (use MODIFIERS constants)
 */
export function isKittyKey(data: string, codepoint: number, modifier: number): boolean {
	// Check exact match first (fast path)
	if (data === kittySequence(codepoint, modifier)) return true;
	// Check with lock bits masked out
	return matchesKittySequence(data, codepoint, modifier);
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
 * Ignores lock key bits.
 */
export function isCtrlA(data: string): boolean {
	return data === RAW.CTRL_A || data === Keys.CTRL_A || matchesKittySequence(data, CODEPOINTS.a, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+C (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlC(data: string): boolean {
	return data === RAW.CTRL_C || data === Keys.CTRL_C || matchesKittySequence(data, CODEPOINTS.c, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+D (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlD(data: string): boolean {
	return data === RAW.CTRL_D || data === Keys.CTRL_D || matchesKittySequence(data, CODEPOINTS.d, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+E (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlE(data: string): boolean {
	return data === RAW.CTRL_E || data === Keys.CTRL_E || matchesKittySequence(data, CODEPOINTS.e, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+K (raw byte or Kitty protocol).
 * Ignores lock key bits.
 * Also checks if first byte is 0x0b for compatibility with terminals
 * that may send trailing bytes.
 */
export function isCtrlK(data: string): boolean {
	return (
		data === RAW.CTRL_K ||
		(data.length > 0 && data.charCodeAt(0) === 0x0b) ||
		data === Keys.CTRL_K ||
		matchesKittySequence(data, CODEPOINTS.k, MODIFIERS.ctrl)
	);
}

/**
 * Check if input matches Ctrl+O (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlO(data: string): boolean {
	return data === RAW.CTRL_O || data === Keys.CTRL_O || matchesKittySequence(data, CODEPOINTS.o, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+P (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlP(data: string): boolean {
	return data === RAW.CTRL_P || data === Keys.CTRL_P || matchesKittySequence(data, CODEPOINTS.p, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+T (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlT(data: string): boolean {
	return data === RAW.CTRL_T || data === Keys.CTRL_T || matchesKittySequence(data, CODEPOINTS.t, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+U (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlU(data: string): boolean {
	return data === RAW.CTRL_U || data === Keys.CTRL_U || matchesKittySequence(data, CODEPOINTS.u, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+W (raw byte or Kitty protocol).
 * Ignores lock key bits.
 */
export function isCtrlW(data: string): boolean {
	return data === RAW.CTRL_W || data === Keys.CTRL_W || matchesKittySequence(data, CODEPOINTS.w, MODIFIERS.ctrl);
}

/**
 * Check if input matches Alt+Backspace (legacy or Kitty protocol).
 * Ignores lock key bits.
 */
export function isAltBackspace(data: string): boolean {
	return (
		data === RAW.ALT_BACKSPACE ||
		data === Keys.ALT_BACKSPACE ||
		matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt)
	);
}

/**
 * Check if input matches Shift+Tab (legacy or Kitty protocol).
 * Ignores lock key bits.
 */
export function isShiftTab(data: string): boolean {
	return (
		data === RAW.SHIFT_TAB || data === Keys.SHIFT_TAB || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift)
	);
}

/**
 * Check if input matches the Escape key (raw byte or Kitty protocol).
 * Raw: \x1b (single byte)
 * Kitty: \x1b[27u (codepoint 27 = escape)
 * Ignores lock key bits.
 */
export function isEscape(data: string): boolean {
	return data === "\x1b" || data === `\x1b[${CODEPOINTS.escape}u` || matchesKittySequence(data, CODEPOINTS.escape, 0);
}

// Arrow key virtual codepoints (negative to avoid conflicts with real codepoints)
const ARROW_CODEPOINTS = {
	up: -1,
	down: -2,
	right: -3,
	left: -4,
} as const;

/**
 * Check if input matches Arrow Up key.
 * Handles both legacy (\x1b[A) and Kitty protocol with modifiers.
 */
export function isArrowUp(data: string): boolean {
	return data === "\x1b[A" || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
}

/**
 * Check if input matches Arrow Down key.
 * Handles both legacy (\x1b[B) and Kitty protocol with modifiers.
 */
export function isArrowDown(data: string): boolean {
	return data === "\x1b[B" || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
}

/**
 * Check if input matches Arrow Right key.
 * Handles both legacy (\x1b[C) and Kitty protocol with modifiers.
 */
export function isArrowRight(data: string): boolean {
	return data === "\x1b[C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
}

/**
 * Check if input matches Arrow Left key.
 * Handles both legacy (\x1b[D) and Kitty protocol with modifiers.
 */
export function isArrowLeft(data: string): boolean {
	return data === "\x1b[D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
}

/**
 * Check if input matches plain Tab key (no modifiers).
 * Handles both legacy (\t) and Kitty protocol.
 */
export function isTab(data: string): boolean {
	return data === "\t" || matchesKittySequence(data, CODEPOINTS.tab, 0);
}

/**
 * Check if input matches plain Enter/Return key (no modifiers).
 * Handles both legacy (\r) and Kitty protocol.
 */
export function isEnter(data: string): boolean {
	return data === "\r" || matchesKittySequence(data, CODEPOINTS.enter, 0);
}

/**
 * Check if input matches plain Backspace key (no modifiers).
 * Handles both legacy (\x7f, \x08) and Kitty protocol.
 */
export function isBackspace(data: string): boolean {
	return data === "\x7f" || data === "\x08" || matchesKittySequence(data, CODEPOINTS.backspace, 0);
}

/**
 * Check if input matches Shift+Enter.
 * Ignores lock key bits.
 */
export function isShiftEnter(data: string): boolean {
	return data === Keys.SHIFT_ENTER || matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift);
}

/**
 * Check if input matches Alt+Enter.
 * Ignores lock key bits.
 */
export function isAltEnter(data: string): boolean {
	return data === Keys.ALT_ENTER || data === "\x1b\r" || matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt);
}

/**
 * Check if input matches Option/Alt+Left (word navigation).
 * Handles multiple formats including Kitty protocol.
 */
export function isAltLeft(data: string): boolean {
	return data === "\x1b[1;3D" || data === "\x1bb" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt);
}

/**
 * Check if input matches Option/Alt+Right (word navigation).
 * Handles multiple formats including Kitty protocol.
 */
export function isAltRight(data: string): boolean {
	return data === "\x1b[1;3C" || data === "\x1bf" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt);
}

/**
 * Check if input matches Ctrl+Left (word navigation).
 * Handles multiple formats including Kitty protocol.
 */
export function isCtrlLeft(data: string): boolean {
	return data === "\x1b[1;5D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
}

/**
 * Check if input matches Ctrl+Right (word navigation).
 * Handles multiple formats including Kitty protocol.
 */
export function isCtrlRight(data: string): boolean {
	return data === "\x1b[1;5C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
}

/**
 * Check if input matches Home key.
 * Handles legacy formats and Kitty protocol with lock key modifiers.
 */
export function isHome(data: string): boolean {
	return (
		data === "\x1b[H" ||
		data === "\x1b[1~" ||
		data === "\x1b[7~" ||
		matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0)
	);
}

/**
 * Check if input matches End key.
 * Handles legacy formats and Kitty protocol with lock key modifiers.
 */
export function isEnd(data: string): boolean {
	return (
		data === "\x1b[F" ||
		data === "\x1b[4~" ||
		data === "\x1b[8~" ||
		matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0)
	);
}

/**
 * Check if input matches Delete key (forward delete).
 * Handles legacy format and Kitty protocol with lock key modifiers.
 */
export function isDelete(data: string): boolean {
	return data === "\x1b[3~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
}
