/**
 * Tests for mouse input handling (SGR mouse protocol)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { isMouseEvent, parseMouseEvent } from "../src/mouse.js";

describe("isMouseEvent", () => {
	it("should detect SGR mouse press events", () => {
		assert.strictEqual(isMouseEvent("\x1b[<0;10;5M"), true);
		assert.strictEqual(isMouseEvent("\x1b[<1;20;10M"), true);
		assert.strictEqual(isMouseEvent("\x1b[<2;1;1M"), true);
	});

	it("should detect SGR mouse release events", () => {
		assert.strictEqual(isMouseEvent("\x1b[<0;10;5m"), true);
		assert.strictEqual(isMouseEvent("\x1b[<1;20;10m"), true);
		assert.strictEqual(isMouseEvent("\x1b[<2;1;1m"), true);
	});

	it("should reject non-mouse sequences", () => {
		assert.strictEqual(isMouseEvent("hello"), false);
		assert.strictEqual(isMouseEvent("\x1b[A"), false); // Up arrow
		assert.strictEqual(isMouseEvent("\x1b[1;5u"), false); // Kitty keyboard
		assert.strictEqual(isMouseEvent("\x1b[<0;10;5"), false); // Incomplete
	});
});

describe("parseMouseEvent", () => {
	describe("button detection", () => {
		it("should parse left button press", () => {
			const event = parseMouseEvent("\x1b[<0;10;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "left");
			assert.strictEqual(event.type, "press");
			assert.strictEqual(event.col, 10);
			assert.strictEqual(event.row, 5);
		});

		it("should parse middle button press", () => {
			const event = parseMouseEvent("\x1b[<1;15;8M");
			assert.ok(event);
			assert.strictEqual(event.button, "middle");
			assert.strictEqual(event.type, "press");
			assert.strictEqual(event.col, 15);
			assert.strictEqual(event.row, 8);
		});

		it("should parse right button press", () => {
			const event = parseMouseEvent("\x1b[<2;20;10M");
			assert.ok(event);
			assert.strictEqual(event.button, "right");
			assert.strictEqual(event.type, "press");
			assert.strictEqual(event.col, 20);
			assert.strictEqual(event.row, 10);
		});

		it("should parse scroll up", () => {
			const event = parseMouseEvent("\x1b[<64;5;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "scroll-up");
			assert.strictEqual(event.type, "press");
		});

		it("should parse scroll down", () => {
			const event = parseMouseEvent("\x1b[<65;5;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "scroll-down");
			assert.strictEqual(event.type, "press");
		});
	});

	describe("event type detection", () => {
		it("should distinguish press from release", () => {
			const press = parseMouseEvent("\x1b[<0;10;5M");
			const release = parseMouseEvent("\x1b[<0;10;5m");

			assert.ok(press);
			assert.ok(release);
			assert.strictEqual(press.type, "press");
			assert.strictEqual(release.type, "release");
		});
	});

	describe("coordinate parsing", () => {
		it("should parse single-digit coordinates", () => {
			const event = parseMouseEvent("\x1b[<0;1;1M");
			assert.ok(event);
			assert.strictEqual(event.col, 1);
			assert.strictEqual(event.row, 1);
		});

		it("should parse multi-digit coordinates", () => {
			const event = parseMouseEvent("\x1b[<0;123;456M");
			assert.ok(event);
			assert.strictEqual(event.col, 123);
			assert.strictEqual(event.row, 456);
		});

		it("should handle large coordinates", () => {
			const event = parseMouseEvent("\x1b[<0;9999;9999M");
			assert.ok(event);
			assert.strictEqual(event.col, 9999);
			assert.strictEqual(event.row, 9999);
		});
	});

	describe("button modifiers", () => {
		it("should parse left button with shift modifier", () => {
			// Shift adds 4 to button code: 0 + 4 = 4
			const event = parseMouseEvent("\x1b[<4;10;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "left");
		});

		it("should parse left button with ctrl modifier", () => {
			// Ctrl adds 16 to button code: 0 + 16 = 16
			const event = parseMouseEvent("\x1b[<16;10;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "left");
		});

		it("should parse left button with alt modifier", () => {
			// Alt adds 8 to button code: 0 + 8 = 8
			const event = parseMouseEvent("\x1b[<8;10;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "left");
		});

		it("should parse right button with modifiers", () => {
			// Right (2) + Shift (4) + Ctrl (16) = 22
			const event = parseMouseEvent("\x1b[<22;10;5M");
			assert.ok(event);
			assert.strictEqual(event.button, "right");
		});
	});

	describe("invalid input", () => {
		it("should return null for non-mouse sequences", () => {
			assert.strictEqual(parseMouseEvent("hello"), null);
			assert.strictEqual(parseMouseEvent("\x1b[A"), null);
			assert.strictEqual(parseMouseEvent("\x1b[1;5u"), null);
		});

		it("should return null for incomplete sequences", () => {
			assert.strictEqual(parseMouseEvent("\x1b[<0;10;5"), null);
			assert.strictEqual(parseMouseEvent("\x1b[<0;10M"), null);
			assert.strictEqual(parseMouseEvent("\x1b[<0M"), null);
		});

		it("should return null for malformed sequences", () => {
			assert.strictEqual(parseMouseEvent("\x1b[<;10;5M"), null);
			assert.strictEqual(parseMouseEvent("\x1b[<0;;5M"), null);
			assert.strictEqual(parseMouseEvent("\x1b[<0;10;M"), null);
		});
	});
});
