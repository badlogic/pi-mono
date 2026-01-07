import assert from "node:assert";
import { describe, it } from "node:test";
import {
	filterKeyReleases,
	isKeyRelease,
	isKeyRepeat,
	matchesKey,
	parseKey,
} from "../src/keys.js";

describe("Kitty keyboard protocol event detection", () => {
	describe("isKeyRelease", () => {
		it("returns false for plain characters", () => {
			assert.strictEqual(isKeyRelease("a"), false);
			assert.strictEqual(isKeyRelease("abc"), false);
		});

		it("returns false for press events (CSI u format)", () => {
			// Press event with no event type (default is press)
			assert.strictEqual(isKeyRelease("\x1b[97u"), false);
			// Press event with explicit :1 suffix
			assert.strictEqual(isKeyRelease("\x1b[97;1:1u"), false);
		});

		it("returns false for repeat events", () => {
			assert.strictEqual(isKeyRelease("\x1b[97;1:2u"), false);
		});

		it("returns true for release events (CSI u format)", () => {
			// Simple key release
			assert.strictEqual(isKeyRelease("\x1b[97;1:3u"), true);
			// Key release without modifier value (just codepoint)
			assert.strictEqual(isKeyRelease("\x1b[97:3u"), true);
			// Key release with ctrl modifier (5 = 1 + ctrl)
			assert.strictEqual(isKeyRelease("\x1b[97;5:3u"), true);
		});

		it("returns true for functional key releases (tilde format)", () => {
			// Delete key release
			assert.strictEqual(isKeyRelease("\x1b[3;1:3~"), true);
			// Page up release
			assert.strictEqual(isKeyRelease("\x1b[5;1:3~"), true);
		});

		it("returns true for arrow key releases", () => {
			assert.strictEqual(isKeyRelease("\x1b[1;1:3A"), true); // Up
			assert.strictEqual(isKeyRelease("\x1b[1;1:3B"), true); // Down
			assert.strictEqual(isKeyRelease("\x1b[1;1:3C"), true); // Right
			assert.strictEqual(isKeyRelease("\x1b[1;1:3D"), true); // Left
		});

		it("returns true for Home/End releases", () => {
			assert.strictEqual(isKeyRelease("\x1b[1;1:3H"), true); // Home
			assert.strictEqual(isKeyRelease("\x1b[1;1:3F"), true); // End
		});

		it("returns true when release event is part of batched input", () => {
			// This is the bug case - batch contains both press and release
			const batch = "\x1b[97u\x1b[97;1:3u";
			assert.strictEqual(isKeyRelease(batch), true);
		});
	});

	describe("isKeyRepeat", () => {
		it("returns false for plain characters", () => {
			assert.strictEqual(isKeyRepeat("a"), false);
		});

		it("returns false for press events", () => {
			assert.strictEqual(isKeyRepeat("\x1b[97u"), false);
			assert.strictEqual(isKeyRepeat("\x1b[97;1:1u"), false);
		});

		it("returns false for release events", () => {
			assert.strictEqual(isKeyRepeat("\x1b[97;1:3u"), false);
		});

		it("returns true for repeat events (CSI u format)", () => {
			assert.strictEqual(isKeyRepeat("\x1b[97;1:2u"), true);
			assert.strictEqual(isKeyRepeat("\x1b[97:2u"), true);
		});

		it("returns true for functional key repeats", () => {
			assert.strictEqual(isKeyRepeat("\x1b[3;1:2~"), true);
		});

		it("returns true for arrow key repeats", () => {
			assert.strictEqual(isKeyRepeat("\x1b[1;1:2A"), true);
			assert.strictEqual(isKeyRepeat("\x1b[1;1:2D"), true);
		});
	});

	describe("filterKeyReleases", () => {
		it("preserves plain characters", () => {
			assert.strictEqual(filterKeyReleases("a"), "a");
			assert.strictEqual(filterKeyReleases("abc"), "abc");
			assert.strictEqual(filterKeyReleases("hello world"), "hello world");
		});

		it("preserves press events", () => {
			// CSI u press (no event type)
			assert.strictEqual(filterKeyReleases("\x1b[97u"), "\x1b[97u");
			// CSI u press (explicit :1)
			assert.strictEqual(filterKeyReleases("\x1b[97;1:1u"), "\x1b[97;1:1u");
		});

		it("preserves repeat events", () => {
			assert.strictEqual(filterKeyReleases("\x1b[97;1:2u"), "\x1b[97;1:2u");
		});

		it("removes CSI u release events", () => {
			assert.strictEqual(filterKeyReleases("\x1b[97;1:3u"), "");
			assert.strictEqual(filterKeyReleases("\x1b[97:3u"), "");
			assert.strictEqual(filterKeyReleases("\x1b[97;5:3u"), "");
		});

		it("removes functional key release events (tilde format)", () => {
			assert.strictEqual(filterKeyReleases("\x1b[3;1:3~"), "");
			assert.strictEqual(filterKeyReleases("\x1b[5;1:3~"), "");
			assert.strictEqual(filterKeyReleases("\x1b[3:3~"), "");
		});

		it("removes arrow key release events", () => {
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3A"), "");
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3B"), "");
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3C"), "");
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3D"), "");
			assert.strictEqual(filterKeyReleases("\x1b[1;5:3A"), ""); // ctrl+up release
		});

		it("removes Home/End release events", () => {
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3H"), "");
			assert.strictEqual(filterKeyReleases("\x1b[1;1:3F"), "");
		});

		describe("batched input handling (SSH scenarios)", () => {
			it("keeps press when batched with release", () => {
				// Press 'a' followed by release 'a'
				const batch = "\x1b[97u\x1b[97;1:3u";
				assert.strictEqual(filterKeyReleases(batch), "\x1b[97u");
			});

			it("keeps multiple presses when batched with their releases", () => {
				// Press 'a', release 'a', press 'b', release 'b'
				const batch = "\x1b[97u\x1b[97;1:3u\x1b[98u\x1b[98;1:3u";
				assert.strictEqual(filterKeyReleases(batch), "\x1b[97u\x1b[98u");
			});

			it("handles plain text followed by release event", () => {
				const batch = "a\x1b[97;1:3u";
				assert.strictEqual(filterKeyReleases(batch), "a");
			});

			it("handles mixed plain text and escape sequences", () => {
				// Plain 'a', then Kitty press 'b', then release 'b'
				const batch = "a\x1b[98u\x1b[98;1:3u";
				assert.strictEqual(filterKeyReleases(batch), "a\x1b[98u");
			});

			it("handles rapid typing simulation", () => {
				// Simulates typing "hi" quickly with releases interleaved
				const batch = "\x1b[104u\x1b[104;1:3u\x1b[105u\x1b[105;1:3u";
				assert.strictEqual(filterKeyReleases(batch), "\x1b[104u\x1b[105u");
			});

			it("preserves arrow key presses while removing releases", () => {
				// Press up, release up
				const batch = "\x1b[1;1A\x1b[1;1:3A";
				// Note: press without event type is \x1b[1;1A, release is \x1b[1;1:3A
				assert.strictEqual(filterKeyReleases(batch), "\x1b[1;1A");
			});
		});
	});

	describe("matchesKey with Kitty protocol sequences", () => {
		it("matches press events", () => {
			assert.strictEqual(matchesKey("\x1b[97u", "a"), true);
			assert.strictEqual(matchesKey("\x1b[97;1:1u", "a"), true);
		});

		it("matches repeat events", () => {
			assert.strictEqual(matchesKey("\x1b[97;1:2u", "a"), true);
		});

		it("matches release events", () => {
			// matchesKey should still match the key identity regardless of event type
			assert.strictEqual(matchesKey("\x1b[97;1:3u", "a"), true);
		});

		it("matches ctrl combinations", () => {
			assert.strictEqual(matchesKey("\x1b[99;5u", "ctrl+c"), true);
			assert.strictEqual(matchesKey("\x1b[99;5:1u", "ctrl+c"), true);
			assert.strictEqual(matchesKey("\x1b[99;5:3u", "ctrl+c"), true);
		});

		it("matches arrow keys with modifiers", () => {
			assert.strictEqual(matchesKey("\x1b[1;5A", "ctrl+up"), true);
			assert.strictEqual(matchesKey("\x1b[1;5:3A", "ctrl+up"), true);
		});
	});

	describe("parseKey with Kitty protocol sequences", () => {
		it("parses press events", () => {
			assert.strictEqual(parseKey("\x1b[97u"), "a");
			assert.strictEqual(parseKey("\x1b[97;1:1u"), "a");
		});

		it("parses repeat events", () => {
			assert.strictEqual(parseKey("\x1b[97;1:2u"), "a");
		});

		it("parses release events", () => {
			assert.strictEqual(parseKey("\x1b[97;1:3u"), "a");
		});

		it("parses special keys", () => {
			assert.strictEqual(parseKey("\x1b[27u"), "escape");
			assert.strictEqual(parseKey("\x1b[13u"), "enter");
			assert.strictEqual(parseKey("\x1b[9u"), "tab");
			assert.strictEqual(parseKey("\x1b[127u"), "backspace");
		});

		it("parses arrow keys", () => {
			assert.strictEqual(parseKey("\x1b[1;1A"), "up");
			assert.strictEqual(parseKey("\x1b[1;1:3A"), "up");
		});

		it("parses keys with modifiers", () => {
			assert.strictEqual(parseKey("\x1b[97;5u"), "ctrl+a");
			assert.strictEqual(parseKey("\x1b[97;3u"), "alt+a");
			assert.strictEqual(parseKey("\x1b[97;2u"), "shift+a");
		});
	});
});

describe("Legacy terminal input handling", () => {
	describe("filterKeyReleases with legacy sequences", () => {
		it("preserves legacy escape sequences (no event type)", () => {
			// Legacy arrow keys
			assert.strictEqual(filterKeyReleases("\x1b[A"), "\x1b[A");
			assert.strictEqual(filterKeyReleases("\x1b[B"), "\x1b[B");
			// Legacy functional keys
			assert.strictEqual(filterKeyReleases("\x1b[3~"), "\x1b[3~");
			// Legacy ctrl sequences
			assert.strictEqual(filterKeyReleases("\x03"), "\x03"); // ctrl+c
		});
	});

	describe("matchesKey with legacy sequences", () => {
		it("matches legacy arrow keys", () => {
			assert.strictEqual(matchesKey("\x1b[A", "up"), true);
			assert.strictEqual(matchesKey("\x1b[B", "down"), true);
			assert.strictEqual(matchesKey("\x1b[C", "right"), true);
			assert.strictEqual(matchesKey("\x1b[D", "left"), true);
		});

		it("matches legacy ctrl combinations", () => {
			assert.strictEqual(matchesKey("\x03", "ctrl+c"), true);
			assert.strictEqual(matchesKey("\x01", "ctrl+a"), true);
		});

		it("matches plain characters", () => {
			assert.strictEqual(matchesKey("a", "a"), true);
			assert.strictEqual(matchesKey("A", "shift+a"), true);
		});
	});
});
