import assert from "node:assert";
import * as os from "node:os";
import { describe, it } from "node:test";
import {
	buildEditorFileUrl,
	createTerminalHyperlink,
	lineMayContainFileReference,
	linkFileDisplayText,
	parseFileReference,
} from "../src/file-links.js";

describe("file-links", () => {
	describe("lineMayContainFileReference", () => {
		it("should return true for lines with path separators", () => {
			assert.ok(lineMayContainFileReference("src/main.ts"));
			assert.ok(lineMayContainFileReference("src\\main.ts"));
		});

		it("should return false for plain text with only a dot", () => {
			assert.ok(!lineMayContainFileReference("This is a sentence."));
			assert.ok(!lineMayContainFileReference("Hello world."));
		});

		it("should return false for empty lines", () => {
			assert.ok(!lineMayContainFileReference(""));
		});
	});

	describe("parseFileReference", () => {
		it("should parse path with line number", () => {
			const ref = parseFileReference("src/main.ts:42");
			assert.deepStrictEqual(ref, { path: "src/main.ts", line: 42, column: undefined });
		});

		it("should parse path with line and column", () => {
			const ref = parseFileReference("src/main.ts:42:10");
			assert.deepStrictEqual(ref, { path: "src/main.ts", line: 42, column: 10 });
		});

		it("should parse path with line range and use start line only", () => {
			const ref = parseFileReference("src/main.ts:12-40");
			assert.deepStrictEqual(ref, { path: "src/main.ts", line: 12, column: undefined });
		});

		it("should reject URLs", () => {
			assert.strictEqual(parseFileReference("https://example.com"), undefined);
		});

		it("should reject paths with whitespace", () => {
			assert.strictEqual(parseFileReference("src/ main.ts"), undefined);
		});

		it("should reject wildcard paths", () => {
			assert.strictEqual(parseFileReference("src/*"), undefined);
		});

		it("should reject bare filenames without explicit path", () => {
			assert.strictEqual(parseFileReference("main.ts"), undefined);
		});

		it("should accept home-relative paths", () => {
			const ref = parseFileReference("~/config/settings.json");
			assert.deepStrictEqual(ref, { path: "~/config/settings.json", line: undefined, column: undefined });
		});
	});

	describe("buildEditorFileUrl", () => {
		it("should build a file:// URL by default", () => {
			const url = buildEditorFileUrl({ path: "/Users/test/src/main.ts" });
			assert.ok(url.startsWith("file:///"));
			assert.ok(url.includes("main.ts"));
		});

		it("should resolve relative paths with cwd", () => {
			const url = buildEditorFileUrl("src/main.ts", { cwd: "/Users/test/project" });
			assert.strictEqual(url, "file:///Users/test/project/src/main.ts");
		});

		it("should expand ~ to home directory", () => {
			const url = buildEditorFileUrl("~/config.json");
			assert.ok(url.startsWith("file://"));
			assert.ok(url.includes("config.json"));
			assert.ok(url.includes(os.homedir().replace(/\\/g, "/")));
		});

		it("should build a vscode:// URL with line and column", () => {
			const url = buildEditorFileUrl(
				{ path: "/Users/test/src/main.ts", line: 42, column: 10 },
				{ scheme: "vscode" },
			);
			assert.strictEqual(url, "vscode://file/Users/test/src/main.ts:42:10");
		});

		it("should default line and column to 1 for vscode scheme", () => {
			const url = buildEditorFileUrl({ path: "/Users/test/src/main.ts" }, { scheme: "vscode" });
			assert.strictEqual(url, "vscode://file/Users/test/src/main.ts:1:1");
		});

		it("should build a cursor:// URL", () => {
			const url = buildEditorFileUrl({ path: "/Users/test/src/main.ts", line: 10, column: 3 }, { scheme: "cursor" });
			assert.strictEqual(url, "cursor://file/Users/test/src/main.ts:10:3");
		});

		it("should build a windsurf:// URL", () => {
			const url = buildEditorFileUrl({ path: "/Users/test/src/main.ts", line: 7 }, { scheme: "windsurf" });
			assert.strictEqual(url, "windsurf://file/Users/test/src/main.ts:7:1");
		});
	});

	describe("linkFileDisplayText", () => {
		it("should create a terminal hyperlink with file:// URL", () => {
			const result = linkFileDisplayText("main.ts", { path: "/Users/test/main.ts" });
			assert.ok(result.includes("\x1b]8;;file:///Users/test/main.ts\x07"));
			assert.ok(result.includes("main.ts"));
			assert.ok(result.endsWith("\x1b]8;;\x07"));
		});

		it("should create a terminal hyperlink with vscode scheme", () => {
			const result = linkFileDisplayText("main.ts", { path: "/Users/test/main.ts", line: 10 }, { scheme: "vscode" });
			assert.ok(result.includes("\x1b]8;;vscode://file/Users/test/main.ts:10:1\x07"));
		});
	});

	describe("createTerminalHyperlink", () => {
		it("should wrap text in OSC 8 sequences", () => {
			const result = createTerminalHyperlink("click me", "https://example.com");
			assert.strictEqual(result, "\x1b]8;;https://example.com\x07click me\x1b]8;;\x07");
		});
	});
});
