/**
 * Tests for tmux image support via Kitty Unicode placeholders.
 */

import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PLACEHOLDER_DIACRITICS } from "../src/placeholder-diacritics.js";
import {
	allocatePlaceholderImageId,
	deleteAllKittyImages,
	deleteKittyImage,
	isImageLine,
	renderImage,
	renderKittyUnicodePlaceholder,
	resetCapabilitiesCache,
	wrapTmuxPassthrough,
} from "../src/terminal-image.js";

describe("wrapTmuxPassthrough", () => {
	it("should wrap a simple escape sequence", () => {
		const seq = "\x1b_Ga=d,d=A\x1b\\";
		const wrapped = wrapTmuxPassthrough(seq);
		assert.ok(wrapped.startsWith("\x1bPtmux;"));
		assert.ok(wrapped.endsWith("\x1b\\"));
	});

	it("should double all ESC characters in payload", () => {
		const seq = "\x1b_Gtest\x1b\\";
		const wrapped = wrapTmuxPassthrough(seq);
		// Original has 2 ESCs, wrapped should have 4 (doubled) + 1 for DCS start + 1 for ST
		// \x1bPtmux;\x1b\x1b_Gtest\x1b\x1b\\\x1b\\
		assert.ok(wrapped.includes("\x1b\x1b_G"));
		assert.ok(wrapped.includes("\x1b\x1b\\"));
	});

	it("should produce correct structure for kitty delete command", () => {
		const seq = "\x1b_Ga=d,d=A\x1b\\";
		const wrapped = wrapTmuxPassthrough(seq);
		// DCS start + "tmux;" + doubled payload + ST
		assert.strictEqual(wrapped, "\x1bPtmux;\x1b\x1b_Ga=d,d=A\x1b\x1b\\\x1b\\");
	});

	it("should handle sequences with no ESC in payload", () => {
		const seq = "plain text";
		const wrapped = wrapTmuxPassthrough(seq);
		assert.strictEqual(wrapped, "\x1bPtmux;plain text\x1b\\");
	});
});

describe("allocatePlaceholderImageId", () => {
	it("should return IDs within 24-bit range", () => {
		for (let i = 0; i < 100; i++) {
			const id = allocatePlaceholderImageId();
			assert.ok(id >= 1, `ID ${id} should be >= 1`);
			assert.ok(id <= 0xffffff, `ID ${id} should be <= 0xFFFFFF`);
		}
	});

	it("should return non-zero IDs", () => {
		for (let i = 0; i < 100; i++) {
			assert.notStrictEqual(allocatePlaceholderImageId(), 0);
		}
	});
});

describe("renderKittyUnicodePlaceholder", () => {
	it("should return transmit sequence, placeholder lines, and image ID", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 3,
			rows: 2,
			imageId: 42,
		});

		assert.ok(result.transmitSequence.length > 0);
		assert.strictEqual(result.placeholderLines.length, 2);
		assert.strictEqual(result.imageId, 42);
	});

	it("should wrap transmit sequence in tmux passthrough", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 2,
			rows: 1,
			imageId: 1,
		});

		assert.ok(result.transmitSequence.includes("\x1bPtmux;"));
	});

	it("should include virtual placement in transmit sequence", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 5,
			rows: 3,
			imageId: 99,
		});

		// The virtual placement should contain U=1, the image id, columns and rows
		// It's passthrough-wrapped so ESCs are doubled
		assert.ok(result.transmitSequence.includes("a=p,U=1,i=99,c=5,r=3"));
	});

	it("should encode image ID in foreground color", () => {
		// ID 42 = 0x00002A → R=0, G=0, B=42
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 2,
			rows: 1,
			imageId: 42,
		});

		assert.ok(result.placeholderLines[0].includes("\x1b[38;2;0;0;42m"));
	});

	it("should encode large image ID correctly in RGB", () => {
		// ID 0x1A2B3C → R=26, G=43, B=60
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 1,
			rows: 1,
			imageId: 0x1a2b3c,
		});

		assert.ok(result.placeholderLines[0].includes("\x1b[38;2;26;43;60m"));
	});

	it("should reset foreground color at end of each line", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 2,
			rows: 2,
			imageId: 1,
		});

		for (const line of result.placeholderLines) {
			assert.ok(line.endsWith("\x1b[39m"), "Each line should end with foreground color reset");
		}
	});

	it("should use correct number of placeholder chars per line", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 5,
			rows: 3,
			imageId: 1,
		});

		const placeholder = "\u{10EEEE}";
		for (const line of result.placeholderLines) {
			const count = [...line].filter((c) => c === placeholder).length;
			assert.strictEqual(count, 5, `Each line should have 5 placeholder chars, got ${count}`);
		}
	});

	it("should use unique row diacritics for each row", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 2,
			rows: 4,
			imageId: 1,
		});

		for (let row = 0; row < 4; row++) {
			const diacritic = String.fromCodePoint(PLACEHOLDER_DIACRITICS[row]);
			assert.ok(
				result.placeholderLines[row].includes(diacritic),
				`Row ${row} should contain diacritic U+${PLACEHOLDER_DIACRITICS[row].toString(16).toUpperCase()}`,
			);
		}
	});

	it("should use transmit-only action (a=t) not display (a=T)", () => {
		const result = renderKittyUnicodePlaceholder("AAAA", {
			columns: 1,
			rows: 1,
			imageId: 1,
		});

		// The transmit sequence should use a=t (store, no display)
		assert.ok(result.transmitSequence.includes("a=t"));
		assert.ok(!result.transmitSequence.includes("a=T"));
	});
});

describe("isImageLine with placeholder chars", () => {
	it("should detect lines containing U+10EEEE placeholder", () => {
		const line = "\x1b[38;2;0;0;42m\u{10EEEE}\u0305\u{10EEEE}\x1b[39m";
		assert.strictEqual(isImageLine(line), true);
	});

	it("should detect placeholder lines with transmit sequence prepended", () => {
		const transmit = "\x1bPtmux;\x1b\x1b_Ga=t,f=100;AAAA\x1b\x1b\\\x1b\\";
		const placeholder = "\x1b[38;2;0;0;1m\u{10EEEE}\u0305\x1b[39m";
		assert.strictEqual(isImageLine(transmit + placeholder), true);
	});

	it("should not detect lines without placeholder or image sequences", () => {
		assert.strictEqual(isImageLine("regular text"), false);
		assert.strictEqual(isImageLine("\x1b[31mcolored text\x1b[0m"), false);
	});
});

describe("tmux delete wrapping", () => {
	let originalTmux: string | undefined;

	beforeEach(() => {
		originalTmux = process.env.TMUX;
	});

	afterEach(() => {
		if (originalTmux !== undefined) {
			process.env.TMUX = originalTmux;
		} else {
			delete process.env.TMUX;
		}
	});

	it("should wrap deleteKittyImage in tmux passthrough when TMUX is set", () => {
		process.env.TMUX = "/tmp/tmux-test,1234,0";
		const result = deleteKittyImage(42);
		assert.ok(result.startsWith("\x1bPtmux;"));
		assert.ok(result.endsWith("\x1b\\"));
		assert.ok(result.includes("a=d,d=I,i=42"));
	});

	it("should not wrap deleteKittyImage when TMUX is unset", () => {
		delete process.env.TMUX;
		const result = deleteKittyImage(42);
		assert.strictEqual(result, "\x1b_Ga=d,d=I,i=42\x1b\\");
	});

	it("should wrap deleteAllKittyImages in tmux passthrough when TMUX is set", () => {
		process.env.TMUX = "/tmp/tmux-test,1234,0";
		const result = deleteAllKittyImages();
		assert.ok(result.startsWith("\x1bPtmux;"));
		assert.ok(result.includes("a=d,d=A"));
	});

	it("should not wrap deleteAllKittyImages when TMUX is unset", () => {
		delete process.env.TMUX;
		const result = deleteAllKittyImages();
		assert.strictEqual(result, "\x1b_Ga=d,d=A\x1b\\");
	});
});

describe("renderImage tmux mode", () => {
	let originalTmux: string | undefined;
	let originalGhostty: string | undefined;

	beforeEach(() => {
		originalTmux = process.env.TMUX;
		originalGhostty = process.env.GHOSTTY_RESOURCES_DIR;
		resetCapabilitiesCache();
	});

	afterEach(() => {
		if (originalTmux !== undefined) {
			process.env.TMUX = originalTmux;
		} else {
			delete process.env.TMUX;
		}
		if (originalGhostty !== undefined) {
			process.env.GHOSTTY_RESOURCES_DIR = originalGhostty;
		} else {
			delete process.env.GHOSTTY_RESOURCES_DIR;
		}
		resetCapabilitiesCache();
	});

	it("should use placeholder mode when in tmux with kitty-capable terminal", () => {
		process.env.TMUX = "/tmp/tmux-test,1234,0";
		process.env.GHOSTTY_RESOURCES_DIR = "/usr/share/ghostty";
		resetCapabilitiesCache();

		const result = renderImage("AAAA", { widthPx: 100, heightPx: 50 }, { maxWidthCells: 10 });

		assert.ok(result);
		assert.ok(result.placeholderLines, "Should return placeholder lines in tmux");
		assert.ok(result.placeholderLines.length > 0);
		assert.ok(result.imageId);
	});

	it("should not use placeholder mode outside tmux", () => {
		delete process.env.TMUX;
		process.env.GHOSTTY_RESOURCES_DIR = "/usr/share/ghostty";
		resetCapabilitiesCache();

		const result = renderImage("AAAA", { widthPx: 100, heightPx: 50 }, { maxWidthCells: 10 });

		assert.ok(result);
		assert.strictEqual(result.placeholderLines, undefined, "Should not return placeholder lines outside tmux");
	});

	it("should clamp imageId to 24 bits in tmux mode", () => {
		process.env.TMUX = "/tmp/tmux-test,1234,0";
		process.env.GHOSTTY_RESOURCES_DIR = "/usr/share/ghostty";
		resetCapabilitiesCache();

		const bigId = 0xff123456; // 32-bit ID
		const result = renderImage("AAAA", { widthPx: 100, heightPx: 50 }, { maxWidthCells: 10, imageId: bigId });

		assert.ok(result);
		assert.ok(result.imageId! <= 0xffffff, `Image ID ${result.imageId} should be clamped to 24 bits`);
		assert.strictEqual(result.imageId, 0x123456);
	});

	it("should cap rows at diacritics table length for extremely tall images", () => {
		process.env.TMUX = "/tmp/tmux-test,1234,0";
		process.env.GHOSTTY_RESOURCES_DIR = "/usr/share/ghostty";
		resetCapabilitiesCache();

		// Very tall narrow image that would need >256 rows
		const result = renderImage("AAAA", { widthPx: 50, heightPx: 50000 }, { maxWidthCells: 10 });

		assert.ok(result);
		assert.ok(result.placeholderLines);
		assert.ok(
			result.placeholderLines.length <= PLACEHOLDER_DIACRITICS.length,
			`Placeholder rows (${result.placeholderLines.length}) should not exceed diacritics table (${PLACEHOLDER_DIACRITICS.length})`,
		);
	});
});
