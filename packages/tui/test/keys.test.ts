/**
 * Tests for keyboard input handling
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { matchesKey, parseKey, setKittyProtocolActive } from "../src/keys.js";

describe("matchesKey", () => {
	describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
		// Kitty protocol flag 4 (Report alternate keys) sends:
		// CSI codepoint:shifted:base ; modifier:event u
		// Where base is the key in standard PC-101 layout

		it("should match Ctrl+c when pressing Ctrl+С (Cyrillic) with base layout key", () => {
			setKittyProtocolActive(true);
			// Cyrillic 'с' = codepoint 1089, Latin 'c' = codepoint 99
			// Format: CSI 1089::99;5u (codepoint::base;modifier with ctrl=4, +1=5)
			const cyrillicCtrlC = "\x1b[1089::99;5u";
			assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+c"), true);
			setKittyProtocolActive(false);
		});

		it("should match Ctrl+d when pressing Ctrl+В (Cyrillic) with base layout key", () => {
			setKittyProtocolActive(true);
			// Cyrillic 'в' = codepoint 1074, Latin 'd' = codepoint 100
			const cyrillicCtrlD = "\x1b[1074::100;5u";
			assert.strictEqual(matchesKey(cyrillicCtrlD, "ctrl+d"), true);
			setKittyProtocolActive(false);
		});

		it("should match Ctrl+z when pressing Ctrl+Я (Cyrillic) with base layout key", () => {
			setKittyProtocolActive(true);
			// Cyrillic 'я' = codepoint 1103, Latin 'z' = codepoint 122
			const cyrillicCtrlZ = "\x1b[1103::122;5u";
			assert.strictEqual(matchesKey(cyrillicCtrlZ, "ctrl+z"), true);
			setKittyProtocolActive(false);
		});

		it("should match Ctrl+Shift+p with base layout key", () => {
			setKittyProtocolActive(true);
			// Cyrillic 'з' = codepoint 1079, Latin 'p' = codepoint 112
			// ctrl=4, shift=1, +1 = 6
			const cyrillicCtrlShiftP = "\x1b[1079::112;6u";
			assert.strictEqual(matchesKey(cyrillicCtrlShiftP, "ctrl+shift+p"), true);
			setKittyProtocolActive(false);
		});

		it("should still match direct codepoint when no base layout key", () => {
			setKittyProtocolActive(true);
			// Latin ctrl+c without base layout key (terminal doesn't support flag 4)
			const latinCtrlC = "\x1b[99;5u";
			assert.strictEqual(matchesKey(latinCtrlC, "ctrl+c"), true);
			setKittyProtocolActive(false);
		});

		it("should handle shifted key in format", () => {
			setKittyProtocolActive(true);
			// Format with shifted key: CSI codepoint:shifted:base;modifier u
			// Latin 'c' with shifted 'C' (67) and base 'c' (99)
			const shiftedKey = "\x1b[99:67:99;2u"; // shift modifier = 1, +1 = 2
			assert.strictEqual(matchesKey(shiftedKey, "shift+c"), true);
			setKittyProtocolActive(false);
		});

		it("should handle event type in format", () => {
			setKittyProtocolActive(true);
			// Format with event type: CSI codepoint::base;modifier:event u
			// Cyrillic ctrl+c release event (event type 3)
			const releaseEvent = "\x1b[1089::99;5:3u";
			assert.strictEqual(matchesKey(releaseEvent, "ctrl+c"), true);
			setKittyProtocolActive(false);
		});

		it("should handle full format with shifted key, base key, and event type", () => {
			setKittyProtocolActive(true);
			// Full format: CSI codepoint:shifted:base;modifier:event u
			// Cyrillic 'С' (shifted) with base 'c', Ctrl+Shift pressed, repeat event
			// Cyrillic 'с' = 1089, Cyrillic 'С' = 1057, Latin 'c' = 99
			// ctrl=4, shift=1, +1 = 6, repeat event = 2
			const fullFormat = "\x1b[1089:1057:99;6:2u";
			assert.strictEqual(matchesKey(fullFormat, "ctrl+shift+c"), true);
			setKittyProtocolActive(false);
		});

		it("should not match wrong key even with base layout", () => {
			setKittyProtocolActive(true);
			// Cyrillic ctrl+с with base 'c' should NOT match ctrl+d
			const cyrillicCtrlC = "\x1b[1089::99;5u";
			assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+d"), false);
			setKittyProtocolActive(false);
		});

		it("should not match wrong modifiers even with base layout", () => {
			setKittyProtocolActive(true);
			// Cyrillic ctrl+с should NOT match ctrl+shift+c
			const cyrillicCtrlC = "\x1b[1089::99;5u";
			assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+shift+c"), false);
			setKittyProtocolActive(false);
		});
	});

	describe("Legacy key matching", () => {
		it("should match legacy Ctrl+c", () => {
			setKittyProtocolActive(false);
			// Ctrl+c sends ASCII 3 (ETX)
			assert.strictEqual(matchesKey("\x03", "ctrl+c"), true);
		});

		it("should match legacy Ctrl+d", () => {
			setKittyProtocolActive(false);
			// Ctrl+d sends ASCII 4 (EOT)
			assert.strictEqual(matchesKey("\x04", "ctrl+d"), true);
		});

		it("should match escape key", () => {
			assert.strictEqual(matchesKey("\x1b", "escape"), true);
		});

		it("should match arrow keys", () => {
			assert.strictEqual(matchesKey("\x1b[A", "up"), true);
			assert.strictEqual(matchesKey("\x1b[B", "down"), true);
			assert.strictEqual(matchesKey("\x1b[C", "right"), true);
			assert.strictEqual(matchesKey("\x1b[D", "left"), true);
		});
	});
});

describe("parseKey", () => {
	describe("Kitty protocol with alternate keys", () => {
		it("should return Latin key name when base layout key is present", () => {
			setKittyProtocolActive(true);
			// Cyrillic ctrl+с with base layout 'c'
			const cyrillicCtrlC = "\x1b[1089::99;5u";
			assert.strictEqual(parseKey(cyrillicCtrlC), "ctrl+c");
			setKittyProtocolActive(false);
		});

		it("should return key name from codepoint when no base layout", () => {
			setKittyProtocolActive(true);
			const latinCtrlC = "\x1b[99;5u";
			assert.strictEqual(parseKey(latinCtrlC), "ctrl+c");
			setKittyProtocolActive(false);
		});
	});

	describe("Legacy key parsing", () => {
		it("should parse legacy Ctrl+letter", () => {
			setKittyProtocolActive(false);
			assert.strictEqual(parseKey("\x03"), "ctrl+c");
			assert.strictEqual(parseKey("\x04"), "ctrl+d");
		});

		it("should parse special keys", () => {
			assert.strictEqual(parseKey("\x1b"), "escape");
			assert.strictEqual(parseKey("\t"), "tab");
			assert.strictEqual(parseKey("\r"), "enter");
			assert.strictEqual(parseKey(" "), "space");
		});

		it("should parse arrow keys", () => {
			assert.strictEqual(parseKey("\x1b[A"), "up");
			assert.strictEqual(parseKey("\x1b[B"), "down");
			assert.strictEqual(parseKey("\x1b[C"), "right");
			assert.strictEqual(parseKey("\x1b[D"), "left");
		});
	});
});
