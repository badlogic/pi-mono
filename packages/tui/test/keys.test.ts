import assert from "node:assert";
import { describe, it } from "node:test";
import { isAltUp, isAltDown } from "../src/keys.js";

describe("isAltUp", () => {
	it("detects xterm CSI sequence", () => {
		assert.strictEqual(isAltUp("\x1b[1;3A"), true);
	});

	it("detects Alt-prefix sequence", () => {
		assert.strictEqual(isAltUp("\x1b\x1b[A"), true);
	});

	it("rejects plain up arrow", () => {
		assert.strictEqual(isAltUp("\x1b[A"), false);
	});

	it("rejects Alt+Down", () => {
		assert.strictEqual(isAltUp("\x1b[1;3B"), false);
	});

	it("rejects Ctrl+Up", () => {
		assert.strictEqual(isAltUp("\x1b[1;5A"), false);
	});

	it("rejects plain down arrow", () => {
		assert.strictEqual(isAltUp("\x1b[B"), false);
	});

	it("rejects empty string", () => {
		assert.strictEqual(isAltUp(""), false);
	});

	it("rejects regular text", () => {
		assert.strictEqual(isAltUp("hello"), false);
	});
});

describe("isAltDown", () => {
	it("detects xterm CSI sequence", () => {
		assert.strictEqual(isAltDown("\x1b[1;3B"), true);
	});

	it("detects Alt-prefix sequence", () => {
		assert.strictEqual(isAltDown("\x1b\x1b[B"), true);
	});

	it("rejects plain down arrow", () => {
		assert.strictEqual(isAltDown("\x1b[B"), false);
	});

	it("rejects Alt+Up", () => {
		assert.strictEqual(isAltDown("\x1b[1;3A"), false);
	});

	it("rejects Ctrl+Down", () => {
		assert.strictEqual(isAltDown("\x1b[1;5B"), false);
	});

	it("rejects plain up arrow", () => {
		assert.strictEqual(isAltDown("\x1b[A"), false);
	});

	it("rejects empty string", () => {
		assert.strictEqual(isAltDown(""), false);
	});

	it("rejects regular text", () => {
		assert.strictEqual(isAltDown("hello"), false);
	});
});
