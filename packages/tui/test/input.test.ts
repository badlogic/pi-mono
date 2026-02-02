import assert from "node:assert";
import { describe, it } from "node:test";
import { Input } from "../src/components/input.js";
import { visibleWidth } from "../src/utils.js";

describe("Input component", () => {
	it("submits value including backslash on Enter", () => {
		const input = new Input();
		let submitted: string | undefined;

		input.onSubmit = (value) => {
			submitted = value;
		};

		// Type hello, then backslash, then Enter
		input.handleInput("h");
		input.handleInput("e");
		input.handleInput("l");
		input.handleInput("l");
		input.handleInput("o");
		input.handleInput("\\");
		input.handleInput("\r");

		// Input is single-line, no backslash+Enter workaround
		assert.strictEqual(submitted, "hello\\");
	});

	it("inserts backslash as regular character", () => {
		const input = new Input();

		input.handleInput("\\");
		input.handleInput("x");

		assert.strictEqual(input.getValue(), "\\x");
	});

	it("converts tabs to spaces in pasted text", () => {
		const input = new Input();

		// Simulate bracketed paste with tabs
		input.handleInput("\x1b[200~hello\t\tworld\x1b[201~");

		// Tabs should be converted to spaces
		assert.strictEqual(input.getValue(), "hello  world");
	});

	it("render does not exceed width even with tabs in value", () => {
		const input = new Input();
		const width = 80;

		// Directly set value with tabs (simulating edge case where tabs get in)
		input.setValue("a\t\t\t\t\t\t\t\t\t\tb");

		const lines = input.render(width);

		// Each rendered line must not exceed width
		for (const line of lines) {
			const lineWidth = visibleWidth(line);
			assert.ok(lineWidth <= width, `Rendered line width ${lineWidth} exceeds terminal width ${width}`);
		}
	});

	it("render converts tabs to spaces for display", () => {
		const input = new Input();

		// Directly set value with a tab
		input.setValue("hello\tworld");

		const lines = input.render(80);

		// The rendered output should have space instead of tab
		assert.ok(!lines[0]?.includes("\t"), "Rendered line should not contain tab character");
	});
});
