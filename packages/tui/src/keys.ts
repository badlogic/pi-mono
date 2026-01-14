/**
 * Keyboard input handling for terminal applications.
 *
 * Supports both legacy terminal sequences and Kitty keyboard protocol.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 *
 * Symbol keys are also supported, however some ctrl+symbol combos
 * overlap with ASCII codes, e.g. ctrl+[ = ESC.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-ctrl-mapping-of-ascii-keys
 * Those can still be * used for ctrl+shift combos
 *
 * API:
 * - matchesKey(data, keyId) - Check if input matches a key identifier
 * - parseKey(data) - Parse input and return the key identifier
 * - Key - Helper object for creating typed key identifiers
 * - setKittyProtocolActive(active) - Set global Kitty protocol state
 * - isKittyProtocolActive() - Query global Kitty protocol state
 */

// =============================================================================
// Global Kitty Protocol State
// =============================================================================

let _kittyProtocolActive = false;

/**
 * Set the global Kitty keyboard protocol state.
 * Called by ProcessTerminal after detecting protocol support.
 */
export function setKittyProtocolActive(active: boolean): void {
	_kittyProtocolActive = active;
}

/**
 * Query whether Kitty keyboard protocol is currently active.
 */
export function isKittyProtocolActive(): boolean {
	return _kittyProtocolActive;
}

// =============================================================================
// Type-Safe Key Identifiers
// =============================================================================

type Letter =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "h"
	| "i"
	| "j"
	| "k"
	| "l"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

type SymbolKey =
	| "`"
	| "-"
	| "="
	| "["
	| "]"
	| "\\"
	| ";"
	| "'"
	| ","
	| "."
	| "/"
	| "!"
	| "@"
	| "#"
	| "$"
	| "%"
	| "^"
	| "&"
	| "*"
	| "("
	| ")"
	| "_"
	| "+"
	| "|"
	| "~"
	| "{"
	| "}"
	| ":"
	| "<"
	| ">"
	| "?";

type SpecialKey =
	| "escape"
	| "esc"
	| "enter"
	| "return"
	| "tab"
	| "space"
	| "backspace"
	| "delete"
	| "home"
	| "end"
	| "pageUp"
	| "pageDown"
	| "up"
	| "down"
	| "left"
	| "right";

type BaseKey = Letter | SymbolKey | SpecialKey;

/**
 * Union type of all valid key identifiers.
 * Provides autocomplete and catches typos at compile time.
 */
export type KeyId =
	| BaseKey
	| `ctrl+${BaseKey}`
	| `shift+${BaseKey}`
	| `alt+${BaseKey}`
	| `ctrl+shift+${BaseKey}`
	| `shift+ctrl+${BaseKey}`
	| `ctrl+alt+${BaseKey}`
	| `alt+ctrl+${BaseKey}`
	| `shift+alt+${BaseKey}`
	| `alt+shift+${BaseKey}`
	| `ctrl+shift+alt+${BaseKey}`
	| `ctrl+alt+shift+${BaseKey}`
	| `shift+ctrl+alt+${BaseKey}`
	| `shift+alt+ctrl+${BaseKey}`
	| `alt+ctrl+shift+${BaseKey}`
	| `alt+shift+ctrl+${BaseKey}`;

/**
 * Helper object for creating typed key identifiers with autocomplete.
 *
 * Usage:
 * - Key.escape, Key.enter, Key.tab, etc. for special keys
 * - Key.backtick, Key.comma, Key.period, etc. for symbol keys
 * - Key.ctrl("c"), Key.alt("x") for single modifier
 * - Key.ctrlShift("p"), Key.ctrlAlt("x") for combined modifiers
 */
export const Key = {
	// Special keys
	escape: "escape" as const,
	esc: "esc" as const,
	enter: "enter" as const,
	return: "return" as const,
	tab: "tab" as const,
	space: "space" as const,
	backspace: "backspace" as const,
	delete: "delete" as const,
	home: "home" as const,
	end: "end" as const,
	pageUp: "pageUp" as const,
	pageDown: "pageDown" as const,
	up: "up" as const,
	down: "down" as const,
	left: "left" as const,
	right: "right" as const,

	// Symbol keys
	backtick: "`" as const,
	hyphen: "-" as const,
	equals: "=" as const,
	leftbracket: "[" as const,
	rightbracket: "]" as const,
	backslash: "\\" as const,
	semicolon: ";" as const,
	quote: "'" as const,
	comma: "," as const,
	period: "." as const,
	slash: "/" as const,
	exclamation: "!" as const,
	at: "@" as const,
	hash: "#" as const,
	dollar: "$" as const,
	percent: "%" as const,
	caret: "^" as const,
	ampersand: "&" as const,
	asterisk: "*" as const,
	leftparen: "(" as const,
	rightparen: ")" as const,
	underscore: "_" as const,
	plus: "+" as const,
	pipe: "|" as const,
	tilde: "~" as const,
	leftbrace: "{" as const,
	rightbrace: "}" as const,
	colon: ":" as const,
	lessthan: "<" as const,
	greaterthan: ">" as const,
	question: "?" as const,

	// Single modifiers
	ctrl: <K extends BaseKey>(key: K): `ctrl+${K}` => `ctrl+${key}`,
	shift: <K extends BaseKey>(key: K): `shift+${K}` => `shift+${key}`,
	alt: <K extends BaseKey>(key: K): `alt+${K}` => `alt+${key}`,

	// Combined modifiers
	ctrlShift: <K extends BaseKey>(key: K): `ctrl+shift+${K}` => `ctrl+shift+${key}`,
	shiftCtrl: <K extends BaseKey>(key: K): `shift+ctrl+${K}` => `shift+ctrl+${key}`,
	ctrlAlt: <K extends BaseKey>(key: K): `ctrl+alt+${K}` => `ctrl+alt+${key}`,
	altCtrl: <K extends BaseKey>(key: K): `alt+ctrl+${K}` => `alt+ctrl+${key}`,
	shiftAlt: <K extends BaseKey>(key: K): `shift+alt+${K}` => `shift+alt+${key}`,
	altShift: <K extends BaseKey>(key: K): `alt+shift+${K}` => `alt+shift+${key}`,

	// Triple modifiers
	ctrlShiftAlt: <K extends BaseKey>(key: K): `ctrl+shift+alt+${K}` => `ctrl+shift+alt+${key}`,
} as const;

// =============================================================================
// Constants
// =============================================================================

const SYMBOL_KEYS = new Set([
	"`",
	"-",
	"=",
	"[",
	"]",
	"\\",
	";",
	"'",
	",",
	".",
	"/",
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"+",
	"|",
	"~",
	"{",
	"}",
	":",
	"<",
	">",
	"?",
]);

const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
} as const;

const LOCK_MASK = 64 + 128; // Caps Lock + Num Lock

const CODEPOINTS = {
	escape: 27,
	tab: 9,
	enter: 13,
	space: 32,
	backspace: 127,
	kpEnter: 57414, // Numpad Enter (Kitty protocol)
} as const;

const ARROW_CODEPOINTS = {
	up: -1,
	down: -2,
	right: -3,
	left: -4,
} as const;

const FUNCTIONAL_CODEPOINTS = {
	delete: -10,
	insert: -11,
	pageUp: -12,
	pageDown: -13,
	home: -14,
	end: -15,
} as const;

// =============================================================================
// Kitty Protocol Parsing
// =============================================================================

/**
 * Event types from Kitty keyboard protocol (flag 2)
 * 1 = key press, 2 = key repeat, 3 = key release
 */
export type KeyEventType = "press" | "repeat" | "release";

interface ParsedKittySequence {
	codepoint: number;
	shiftedKey?: number; // Shifted version of the key (when shift is pressed)
	baseLayoutKey?: number; // Key in standard PC-101 layout (for non-Latin layouts)
	modifier: number;
	eventType: KeyEventType;
}

// Store the last parsed event type for isKeyRelease() to query
let _lastEventType: KeyEventType = "press";

/**
 * Check if the last parsed key event was a key release.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 */
export function isKeyRelease(data: string): boolean {
	// Don't treat bracketed paste content as key release, even if it contains
	// patterns like ":3F" (e.g., bluetooth MAC addresses like "90:62:3F:A5").
	// Terminal.ts re-wraps paste content with bracketed paste markers before
	// passing to TUI, so pasted data will always contain \x1b[200~.
	if (data.includes("\x1b[200~")) {
		return false;
	}

	// Quick check: release events with flag 2 contain ":3"
	// Format: \x1b[<codepoint>;<modifier>:3u
	if (
		data.includes(":3u") ||
		data.includes(":3~") ||
		data.includes(":3A") ||
		data.includes(":3B") ||
		data.includes(":3C") ||
		data.includes(":3D") ||
		data.includes(":3H") ||
		data.includes(":3F")
	) {
		return true;
	}
	return false;
}

/**
 * Check if the last parsed key event was a key repeat.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 */
export function isKeyRepeat(data: string): boolean {
	// Don't treat bracketed paste content as key repeat, even if it contains
	// patterns like ":2F". See isKeyRelease() for details.
	if (data.includes("\x1b[200~")) {
		return false;
	}

	if (
		data.includes(":2u") ||
		data.includes(":2~") ||
		data.includes(":2A") ||
		data.includes(":2B") ||
		data.includes(":2C") ||
		data.includes(":2D") ||
		data.includes(":2H") ||
		data.includes(":2F")
	) {
		return true;
	}
	return false;
}

function parseEventType(eventTypeStr: string | undefined): KeyEventType {
	if (!eventTypeStr) return "press";
	const eventType = parseInt(eventTypeStr, 10);
	if (eventType === 2) return "repeat";
	if (eventType === 3) return "release";
	return "press";
}

function parseKittySequence(data: string): ParsedKittySequence | null {
	// CSI u format with alternate keys (flag 4):
	// \x1b[<codepoint>u
	// \x1b[<codepoint>;<mod>u
	// \x1b[<codepoint>;<mod>:<event>u
	// \x1b[<codepoint>:<shifted>;<mod>u
	// \x1b[<codepoint>:<shifted>:<base>;<mod>u
	// \x1b[<codepoint>::<base>;<mod>u (no shifted key, only base)
	//
	// With flag 2, event type is appended after modifier colon: 1=press, 2=repeat, 3=release
	// With flag 4, alternate keys are appended after codepoint with colons
	const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
	if (csiUMatch) {
		const codepoint = parseInt(csiUMatch[1]!, 10);
		const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : undefined;
		const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : undefined;
		const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
		const eventType = parseEventType(csiUMatch[5]);
		_lastEventType = eventType;
		return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
	}

	// Arrow keys with modifier: \x1b[1;<mod>A/B/C/D or \x1b[1;<mod>:<event>A/B/C/D
	const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
	if (arrowMatch) {
		const modValue = parseInt(arrowMatch[1]!, 10);
		const eventType = parseEventType(arrowMatch[2]);
		const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
		_lastEventType = eventType;
		return { codepoint: arrowCodes[arrowMatch[3]!]!, modifier: modValue - 1, eventType };
	}

	// Functional keys: \x1b[<num>~ or \x1b[<num>;<mod>~ or \x1b[<num>;<mod>:<event>~
	const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
	if (funcMatch) {
		const keyNum = parseInt(funcMatch[1]!, 10);
		const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
		const eventType = parseEventType(funcMatch[3]);
		const funcCodes: Record<number, number> = {
			2: FUNCTIONAL_CODEPOINTS.insert,
			3: FUNCTIONAL_CODEPOINTS.delete,
			5: FUNCTIONAL_CODEPOINTS.pageUp,
			6: FUNCTIONAL_CODEPOINTS.pageDown,
			7: FUNCTIONAL_CODEPOINTS.home,
			8: FUNCTIONAL_CODEPOINTS.end,
		};
		const codepoint = funcCodes[keyNum];
		if (codepoint !== undefined) {
			_lastEventType = eventType;
			return { codepoint, modifier: modValue - 1, eventType };
		}
	}

	// Home/End with modifier: \x1b[1;<mod>H/F or \x1b[1;<mod>:<event>H/F
	const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
	if (homeEndMatch) {
		const modValue = parseInt(homeEndMatch[1]!, 10);
		const eventType = parseEventType(homeEndMatch[2]);
		const codepoint = homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
		_lastEventType = eventType;
		return { codepoint, modifier: modValue - 1, eventType };
	}

	return null;
}

function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;
	const actualMod = parsed.modifier & ~LOCK_MASK;
	const expectedMod = expectedModifier & ~LOCK_MASK;

	// Check if modifiers match
	if (actualMod !== expectedMod) return false;

	// Primary match: codepoint matches directly
	if (parsed.codepoint === expectedCodepoint) return true;

	// Alternate match: use base layout key for non-Latin keyboard layouts
	// This allows Ctrl+С (Cyrillic) to match Ctrl+c (Latin) when terminal reports
	// the base layout key (the key in standard PC-101 layout)
	if (parsed.baseLayoutKey !== undefined && parsed.baseLayoutKey === expectedCodepoint) return true;

	return false;
}

/**
 * Match xterm modifyOtherKeys format: CSI 27 ; modifiers ; keycode ~
 * This is used by terminals when Kitty protocol is not enabled.
 * Modifier values are 1-indexed: 2=shift, 3=alt, 5=ctrl, etc.
 */
function matchesModifyOtherKeys(data: string, expectedKeycode: number, expectedModifier: number): boolean {
	const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
	if (!match) return false;
	const modValue = parseInt(match[1]!, 10);
	const keycode = parseInt(match[2]!, 10);
	// Convert from 1-indexed xterm format to our 0-indexed format
	const actualMod = modValue - 1;
	return keycode === expectedKeycode && actualMod === expectedModifier;
}

// =============================================================================
// Generic Key Matching
// =============================================================================

function rawCtrlChar(letter: string): string {
	const code = letter.toLowerCase().charCodeAt(0) - 96;
	return String.fromCharCode(code);
}

function parseKeyId(keyId: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
	const parts = keyId.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (!key) return null;
	return {
		key,
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
	};
}

/**
 * Match input data against a key identifier string.
 *
 * Supported key identifiers:
 * - Single keys: "escape", "tab", "enter", "backspace", "delete", "home", "end", "space"
 * - Arrow keys: "up", "down", "left", "right"
 * - Ctrl combinations: "ctrl+c", "ctrl+z", etc.
 * - Shift combinations: "shift+tab", "shift+enter"
 * - Alt combinations: "alt+enter", "alt+backspace"
 * - Combined modifiers: "shift+ctrl+p", "ctrl+alt+x"
 *
 * Use the Key helper for autocomplete: Key.ctrl("c"), Key.escape, Key.ctrlShift("p")
 *
 * @param data - Raw input data from terminal
 * @param keyId - Key identifier (e.g., "ctrl+c", "escape", Key.ctrl("c"))
 */
export function matchesKey(data: string, keyId: KeyId): boolean {
	const parsed = parseKeyId(keyId);
	if (!parsed) return false;

	const { key, ctrl, shift, alt } = parsed;
	let modifier = 0;
	if (shift) modifier |= MODIFIERS.shift;
	if (alt) modifier |= MODIFIERS.alt;
	if (ctrl) modifier |= MODIFIERS.ctrl;

	switch (key) {
		case "escape":
		case "esc":
			if (modifier !== 0) return false;
			return data === "\x1b" || matchesKittySequence(data, CODEPOINTS.escape, 0);

		case "space":
			if (modifier === 0) {
				return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0);
			}
			return matchesKittySequence(data, CODEPOINTS.space, modifier);

		case "tab":
			if (shift && !ctrl && !alt) {
				return data === "\x1b[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift);
			}
			if (modifier === 0) {
				return data === "\t" || matchesKittySequence(data, CODEPOINTS.tab, 0);
			}
			return matchesKittySequence(data, CODEPOINTS.tab, modifier);

		case "enter":
		case "return":
			if (shift && !ctrl && !alt) {
				// CSI u sequences (standard Kitty protocol)
				if (
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)
				) {
					return true;
				}
				// xterm modifyOtherKeys format (fallback when Kitty protocol not enabled)
				if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) {
					return true;
				}
				// When Kitty protocol is active, legacy sequences are custom terminal mappings
				// \x1b\r = Kitty's "map shift+enter send_text all \e\r"
				// \n = Ghostty's "keybind = shift+enter=text:\n"
				if (_kittyProtocolActive) {
					return data === "\x1b\r" || data === "\n";
				}
				return false;
			}
			if (alt && !ctrl && !shift) {
				// CSI u sequences (standard Kitty protocol)
				if (
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)
				) {
					return true;
				}
				// xterm modifyOtherKeys format (fallback when Kitty protocol not enabled)
				if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) {
					return true;
				}
				// \x1b\r is alt+enter only in legacy mode (no Kitty protocol)
				// When Kitty protocol is active, alt+enter comes as CSI u sequence
				if (!_kittyProtocolActive) {
					return data === "\x1b\r";
				}
				return false;
			}
			if (modifier === 0) {
				return (
					data === "\r" ||
					data === "\x1bOM" || // SS3 M (numpad enter in some terminals)
					matchesKittySequence(data, CODEPOINTS.enter, 0) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, 0)
				);
			}
			return (
				matchesKittySequence(data, CODEPOINTS.enter, modifier) ||
				matchesKittySequence(data, CODEPOINTS.kpEnter, modifier)
			);

		case "backspace":
			if (alt && !ctrl && !shift) {
				return data === "\x1b\x7f" || matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt);
			}
			if (modifier === 0) {
				return data === "\x7f" || data === "\x08" || matchesKittySequence(data, CODEPOINTS.backspace, 0);
			}
			return matchesKittySequence(data, CODEPOINTS.backspace, modifier);

		case "delete":
			if (modifier === 0) {
				return data === "\x1b[3~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);

		case "home":
			if (modifier === 0) {
				return (
					data === "\x1b[H" ||
					data === "\x1b[1~" ||
					data === "\x1b[7~" ||
					matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0)
				);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);

		case "end":
			if (modifier === 0) {
				return (
					data === "\x1b[F" ||
					data === "\x1b[4~" ||
					data === "\x1b[8~" ||
					matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0)
				);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);

		case "pageUp":
			if (modifier === 0) {
				return data === "\x1b[5~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);

		case "pageDown":
			if (modifier === 0) {
				return data === "\x1b[6~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);

		case "up":
			if (modifier === 0) {
				return data === "\x1b[A" || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);

		case "down":
			if (modifier === 0) {
				return data === "\x1b[B" || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);

		case "left":
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b[1;3D" ||
					data === "\x1bb" ||
					matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt)
				);
			}
			if (ctrl && !alt && !shift) {
				return data === "\x1b[1;5D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
			}
			if (modifier === 0) {
				return data === "\x1b[D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);

		case "right":
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b[1;3C" ||
					data === "\x1bf" ||
					matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt)
				);
			}
			if (ctrl && !alt && !shift) {
				return data === "\x1b[1;5C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
			}
			if (modifier === 0) {
				return data === "\x1b[C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);
	}

	// Handle single letter keys (a-z) and some symbols
	if (key.length === 1 && ((key >= "a" && key <= "z") || SYMBOL_KEYS.has(key))) {
		const codepoint = key.charCodeAt(0);

		if (ctrl && !shift && !alt) {
			const raw = rawCtrlChar(key);
			if (data === raw) return true;
			if (data.length > 0 && data.charCodeAt(0) === raw.charCodeAt(0)) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.ctrl);
		}

		if (ctrl && shift && !alt) {
			return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
		}

		if (shift && !ctrl && !alt) {
			// Legacy: shift+letter produces uppercase
			if (data === key.toUpperCase()) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.shift);
		}

		if (modifier !== 0) {
			return matchesKittySequence(data, codepoint, modifier);
		}

		// Check both raw char and Kitty sequence (needed for release events)
		return data === key || matchesKittySequence(data, codepoint, 0);
	}

	return false;
}

/**
 * Parse input data and return the key identifier if recognized.
 *
 * @param data - Raw input data from terminal
 * @returns Key identifier string (e.g., "ctrl+c") or undefined
 */
export function parseKey(data: string): string | undefined {
	const kitty = parseKittySequence(data);
	if (kitty) {
		const { codepoint, baseLayoutKey, modifier } = kitty;
		const mods: string[] = [];
		const effectiveMod = modifier & ~LOCK_MASK;
		if (effectiveMod & MODIFIERS.shift) mods.push("shift");
		if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
		if (effectiveMod & MODIFIERS.alt) mods.push("alt");

		// Prefer base layout key for consistent shortcut naming across keyboard layouts
		// This ensures Ctrl+С (Cyrillic) is reported as "ctrl+c" (Latin)
		const effectiveCodepoint = baseLayoutKey ?? codepoint;

		let keyName: string | undefined;
		if (effectiveCodepoint === CODEPOINTS.escape) keyName = "escape";
		else if (effectiveCodepoint === CODEPOINTS.tab) keyName = "tab";
		else if (effectiveCodepoint === CODEPOINTS.enter || effectiveCodepoint === CODEPOINTS.kpEnter) keyName = "enter";
		else if (effectiveCodepoint === CODEPOINTS.space) keyName = "space";
		else if (effectiveCodepoint === CODEPOINTS.backspace) keyName = "backspace";
		else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
		else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
		else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
		else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageUp) keyName = "pageUp";
		else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageDown) keyName = "pageDown";
		else if (effectiveCodepoint === ARROW_CODEPOINTS.up) keyName = "up";
		else if (effectiveCodepoint === ARROW_CODEPOINTS.down) keyName = "down";
		else if (effectiveCodepoint === ARROW_CODEPOINTS.left) keyName = "left";
		else if (effectiveCodepoint === ARROW_CODEPOINTS.right) keyName = "right";
		else if (effectiveCodepoint >= 97 && effectiveCodepoint <= 122) keyName = String.fromCharCode(effectiveCodepoint);
		else if (SYMBOL_KEYS.has(String.fromCharCode(effectiveCodepoint)))
			keyName = String.fromCharCode(effectiveCodepoint);

		if (keyName) {
			return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
		}
	}

	// Mode-aware legacy sequences
	// When Kitty protocol is active, ambiguous sequences are interpreted as custom terminal mappings:
	// - \x1b\r = shift+enter (Kitty mapping), not alt+enter
	// - \n = shift+enter (Ghostty mapping)
	if (_kittyProtocolActive) {
		if (data === "\x1b\r" || data === "\n") return "shift+enter";
	}

	// Legacy sequences (used when Kitty protocol is not active, or for unambiguous sequences)
	if (data === "\x1b") return "escape";
	if (data === "\t") return "tab";
	if (data === "\r" || data === "\x1bOM") return "enter";
	if (data === " ") return "space";
	if (data === "\x7f" || data === "\x08") return "backspace";
	if (data === "\x1b[Z") return "shift+tab";
	if (!_kittyProtocolActive && data === "\x1b\r") return "alt+enter";
	if (data === "\x1b\x7f") return "alt+backspace";
	if (data === "\x1b[A") return "up";
	if (data === "\x1b[B") return "down";
	if (data === "\x1b[C") return "right";
	if (data === "\x1b[D") return "left";
	if (data === "\x1b[H") return "home";
	if (data === "\x1b[F") return "end";
	if (data === "\x1b[3~") return "delete";
	if (data === "\x1b[5~") return "pageUp";
	if (data === "\x1b[6~") return "pageDown";

	// Raw Ctrl+letter
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (code >= 1 && code <= 26) {
			return `ctrl+${String.fromCharCode(code + 96)}`;
		}
		if (code >= 32 && code <= 126) {
			return data;
		}
	}

	return undefined;
}
