/** Unit tests for formatToolCall. */

import { describe, expect, test } from "vitest";
import { formatToolCall } from "../src/core/format-tool-call.js";

describe("formatToolCall", () => {
	// =========================================================================
	// read
	// =========================================================================

	test("read with path only", () => {
		expect(formatToolCall("read", { path: "/tmp/test.ts" })).toBe("[read: /tmp/test.ts]");
	});

	test("read with offset and limit", () => {
		expect(formatToolCall("read", { path: "/tmp/test.ts", offset: 10, limit: 21 })).toBe(
			"[read: /tmp/test.ts:10-30]",
		);
	});

	test("read with offset only", () => {
		expect(formatToolCall("read", { path: "/tmp/test.ts", offset: 10 })).toBe("[read: /tmp/test.ts:10]");
	});

	test("read with limit only defaults start to 1", () => {
		expect(formatToolCall("read", { path: "/tmp/test.ts", limit: 20 })).toBe("[read: /tmp/test.ts:1-20]");
	});

	test("read shortens HOME prefix to ~", () => {
		const home = (process.env.HOME || process.env.USERPROFILE)!;
		expect(formatToolCall("read", { path: `${home}/subfolder/file.ts` })).toBe("[read: ~/subfolder/file.ts]");
	});

	// =========================================================================
	// write
	// =========================================================================

	test("write with path", () => {
		expect(formatToolCall("write", { path: "/tmp/out.ts" })).toBe("[write: /tmp/out.ts]");
	});

	// =========================================================================
	// edit
	// =========================================================================

	test("edit with path", () => {
		expect(formatToolCall("edit", { path: "/tmp/out.ts" })).toBe("[edit: /tmp/out.ts]");
	});

	// =========================================================================
	// bash
	// =========================================================================

	test("bash with short command", () => {
		expect(formatToolCall("bash", { command: "ls -la" })).toBe("[bash: ls -la]");
	});

	test("bash truncates long commands at 50 chars with ellipsis", () => {
		const longCmd = "a".repeat(60);
		const result = formatToolCall("bash", { command: longCmd });
		expect(result).toBe(`[bash: ${"a".repeat(50)}...]`);
	});

	test("bash normalizes newlines and tabs to spaces", () => {
		expect(formatToolCall("bash", { command: "echo hello\n\techo world" })).toBe("[bash: echo hello  echo world]");
	});

	test("bash ellipsis is based on normalized command length", () => {
		// Raw length is 51 (>50 limit), but after normalizing tabs to spaces and
		// trimming, the normalized string is only 45 chars — no truncation, no ellipsis.
		const rawCmd = `${"x".repeat(45)}\t\t\t\t\t\t`;
		expect(rawCmd.length).toBe(51);
		const result = formatToolCall("bash", { command: rawCmd });
		expect(result).toBe(`[bash: ${"x".repeat(45)}]`);
	});

	test("bash ellipsis appears when normalized command exceeds limit", () => {
		const rawCmd = "x".repeat(55);
		const result = formatToolCall("bash", { command: rawCmd });
		expect(result).toContain("...");
		expect(result).toBe(`[bash: ${"x".repeat(50)}...]`);
	});

	// =========================================================================
	// grep
	// =========================================================================

	test("grep with pattern and path", () => {
		expect(formatToolCall("grep", { pattern: "TODO", path: "/src" })).toBe("[grep: /TODO/ in /src]");
	});

	test("grep defaults path to .", () => {
		expect(formatToolCall("grep", { pattern: "TODO" })).toBe("[grep: /TODO/ in .]");
	});

	// =========================================================================
	// find
	// =========================================================================

	test("find with pattern and path", () => {
		expect(formatToolCall("find", { pattern: "*.ts", path: "/src" })).toBe("[find: *.ts in /src]");
	});

	test("find defaults path to .", () => {
		expect(formatToolCall("find", { pattern: "*.ts" })).toBe("[find: *.ts in .]");
	});

	// =========================================================================
	// ls
	// =========================================================================

	test("ls with path", () => {
		expect(formatToolCall("ls", { path: "/tmp" })).toBe("[ls: /tmp]");
	});

	test("ls defaults path to .", () => {
		expect(formatToolCall("ls", {})).toBe("[ls: .]");
	});

	// =========================================================================
	// unknown tool (default case)
	// =========================================================================

	test("unknown tool shows name and JSON args", () => {
		expect(formatToolCall("mytool", { key: "val" })).toBe('[mytool: {"key":"val"}]');
	});

	test("unknown tool truncates long JSON at 40 chars with ellipsis", () => {
		const args = { longKey: "x".repeat(50) };
		const fullJson = JSON.stringify(args);
		expect(fullJson.length).toBeGreaterThan(40);
		const result = formatToolCall("mytool", args);
		expect(result).toBe(`[mytool: ${fullJson.slice(0, 40)}...]`);
	});

	test("unknown tool does not add ellipsis for short JSON", () => {
		const args = { a: 1 };
		const result = formatToolCall("mytool", args);
		expect(result).toBe('[mytool: {"a":1}]');
		expect(result).not.toContain("...");
	});
});
