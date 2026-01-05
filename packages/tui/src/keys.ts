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
 */

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

interface ParsedKittySequence {
	codepoint: number;
	modifier: number;
}

function parseKittySequence(data: string): ParsedKittySequence | null {
	// CSI u format: \x1b[<num>u or \x1b[<num>;<mod>u
	const csiUMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?u$/);
	if (csiUMatch) {
		const codepoint = parseInt(csiUMatch[1]!, 10);
		const modValue = csiUMatch[2] ? parseInt(csiUMatch[2], 10) : 1;
		return { codepoint, modifier: modValue - 1 };
	}

	// Arrow keys with modifier: \x1b[1;<mod>A/B/C/D
	const arrowMatch = data.match(/^\x1b\[1;(\d+)([ABCD])$/);
	if (arrowMatch) {
		const modValue = parseInt(arrowMatch[1]!, 10);
		const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
		return { codepoint: arrowCodes[arrowMatch[2]!]!, modifier: modValue - 1 };
	}

	// Functional keys: \x1b[<num>~ or \x1b[<num>;<mod>~
	const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?~$/);
	if (funcMatch) {
		const keyNum = parseInt(funcMatch[1]!, 10);
		const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
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
			return { codepoint, modifier: modValue - 1 };
		}
	}

	// Home/End with modifier: \x1b[1;<mod>H/F
	const homeEndMatch = data.match(/^\x1b\[1;(\d+)([HF])$/);
	if (homeEndMatch) {
		const modValue = parseInt(homeEndMatch[1]!, 10);
		const codepoint = homeEndMatch[2] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
		return { codepoint, modifier: modValue - 1 };
	}

	return null;
}

function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;
	const actualMod = parsed.modifier & ~LOCK_MASK;
	const expectedMod = expectedModifier & ~LOCK_MASK;
	return parsed.codepoint === expectedCodepoint && actualMod === expectedMod;
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
				return (
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)
				);
			}
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b\r" ||
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)
				);
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

		return data === key;
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
		const { codepoint, modifier } = kitty;
		const mods: string[] = [];
		const effectiveMod = modifier & ~LOCK_MASK;
		if (effectiveMod & MODIFIERS.shift) mods.push("shift");
		if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
		if (effectiveMod & MODIFIERS.alt) mods.push("alt");

		let keyName: string | undefined;
		if (codepoint === CODEPOINTS.escape) keyName = "escape";
		else if (codepoint === CODEPOINTS.tab) keyName = "tab";
		else if (codepoint === CODEPOINTS.enter || codepoint === CODEPOINTS.kpEnter) keyName = "enter";
		else if (codepoint === CODEPOINTS.space) keyName = "space";
		else if (codepoint === CODEPOINTS.backspace) keyName = "backspace";
		else if (codepoint === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
		else if (codepoint === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
		else if (codepoint === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
		else if (codepoint === ARROW_CODEPOINTS.up) keyName = "up";
		else if (codepoint === ARROW_CODEPOINTS.down) keyName = "down";
		else if (codepoint === ARROW_CODEPOINTS.left) keyName = "left";
		else if (codepoint === ARROW_CODEPOINTS.right) keyName = "right";
		else if (codepoint >= 97 && codepoint <= 122) keyName = String.fromCharCode(codepoint);
		else if (SYMBOL_KEYS.has(String.fromCharCode(codepoint))) keyName = String.fromCharCode(codepoint);

		if (keyName) {
			return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
		}
	}

	// Legacy sequences
	if (data === "\x1b") return "escape";
	if (data === "\t") return "tab";
	if (data === "\r" || data === "\x1bOM") return "enter";
	if (data === " ") return "space";
	if (data === "\x7f" || data === "\x08") return "backspace";
	if (data === "\x1b[Z") return "shift+tab";
	if (data === "\x1b\r") return "alt+enter";
	if (data === "\x1b\x7f") return "alt+backspace";
	if (data === "\x1b[A") return "up";
	if (data === "\x1b[B") return "down";
	if (data === "\x1b[C") return "right";
	if (data === "\x1b[D") return "left";
	if (data === "\x1b[H") return "home";
	if (data === "\x1b[F") return "end";
	if (data === "\x1b[3~") return "delete";

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
