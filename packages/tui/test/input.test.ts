import assert from "node:assert";
import { describe, it } from "node:test";
import { Input } from "../src/components/input.js";

describe("Input component", () => {
	it("treats split VS Code Shift+Enter as submit", () => {
		const input = new Input();
		let submitted: string | undefined;

		input.setValue("hello");
		input.onSubmit = (value) => {
			submitted = value;
		};

		input.handleInput("\\");
		input.handleInput("\r");

		assert.strictEqual(submitted, "hello");
		assert.strictEqual(input.getValue(), "hello");
	});

	it("inserts a literal backslash when not followed by Enter", () => {
		const input = new Input();

		input.handleInput("\\");
		input.handleInput("x");

		assert.strictEqual(input.getValue(), "\\x");
	});
});
