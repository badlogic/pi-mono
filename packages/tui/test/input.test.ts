import assert from "node:assert";
import { describe, it } from "node:test";
import { Input } from "../src/components/input.js";

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
});
