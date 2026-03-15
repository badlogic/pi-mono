import { describe, expect, test } from "vitest";
import { formatToolCall } from "../src/core/format-tool-call.js";

describe("formatToolCall", () => {
	test("shortens home directory in path-based tools", () => {
		const home = process.env.HOME || "/home/user";
		expect(formatToolCall("read", { path: `${home}/projects/file.ts` })).toBe("[read: ~/projects/file.ts]");
		expect(formatToolCall("write", { path: `${home}/out.txt`, content: "x" })).toBe("[write: ~/out.txt]");
		expect(formatToolCall("edit", { path: `${home}/code.ts`, oldText: "a", newText: "b" })).toBe("[edit: ~/code.ts]");
	});

	test("read shows line range from offset and limit", () => {
		expect(formatToolCall("read", { path: "/tmp/f.ts", offset: 10, limit: 20 })).toBe("[read: /tmp/f.ts:10-29]");
		expect(formatToolCall("read", { path: "/tmp/f.ts", offset: 5 })).toBe("[read: /tmp/f.ts:5]");
	});

	test("bash normalizes whitespace and truncates at 50 chars", () => {
		expect(formatToolCall("bash", { command: "echo hello\n\techo world" })).toBe("[bash: echo hello  echo world]");
		expect(formatToolCall("bash", { command: "a".repeat(60) })).toBe(`[bash: ${"a".repeat(50)}...]`);
		// Ellipsis based on normalized length, not raw length
		expect(formatToolCall("bash", { command: `${"\n".repeat(40)}short` })).toBe("[bash: short]");
	});

	test("grep and find show pattern and path", () => {
		expect(formatToolCall("grep", { pattern: "TODO", path: "src/" })).toBe("[grep: /TODO/ in src/]");
		expect(formatToolCall("find", { pattern: "*.py", path: "src/" })).toBe("[find: *.py in src/]");
	});

	test("ls shows path", () => {
		expect(formatToolCall("ls", { path: "src/" })).toBe("[ls: src/]");
	});

	test("unknown tools fall back to truncated JSON args", () => {
		expect(formatToolCall("custom", { key: "value" })).toBe('[custom: {"key":"value"}]');
		expect(formatToolCall("custom", {})).toBe("[custom: {}]");
		const longArgs = { key: "a".repeat(50) };
		expect(formatToolCall("custom", longArgs)).toBe(`[custom: ${JSON.stringify(longArgs).slice(0, 40)}...]`);
	});
});
