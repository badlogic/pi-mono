import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bashTool } from "../src/tools/bash.js";
import { editTool } from "../src/tools/edit.js";
import { readTool } from "../src/tools/read.js";
import { writeTool } from "../src/tools/write.js";

// Helper to extract text from content blocks
function getTextOutput(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

describe("Coding Agent Tools", () => {
	let testDir: string;

	beforeEach(() => {
		// Create a unique temporary directory for each test
		testDir = join(tmpdir(), `coding-agent-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("read tool", () => {
		it("should read file contents", async () => {
			const testFile = join(testDir, "test.txt");
			const content = "Hello, world!";
			writeFileSync(testFile, content);

			const result = await readTool.execute("test-call-1", { path: testFile });

			expect(getTextOutput(result)).toBe(content);
			expect(result.details).toBeUndefined();
		});

		it("should handle non-existent files", async () => {
			const testFile = join(testDir, "nonexistent.txt");

			const result = await readTool.execute("test-call-2", { path: testFile });

			expect(getTextOutput(result)).toContain("Error");
			expect(getTextOutput(result)).toContain("File not found");
		});
	});

	describe("write tool", () => {
		it("should write file contents", async () => {
			const testFile = join(testDir, "write-test.txt");
			const content = "Test content";

			const result = await writeTool.execute("test-call-3", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(getTextOutput(result)).toContain(testFile);
			expect(result.details).toBeUndefined();
		});

		it("should create parent directories", async () => {
			const testFile = join(testDir, "nested", "dir", "test.txt");
			const content = "Nested content";

			const result = await writeTool.execute("test-call-4", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
		});
	});

	describe("edit tool", () => {
		it("should replace text in file", async () => {
			const testFile = join(testDir, "edit-test.txt");
			const originalContent = "Hello, world!";
			writeFileSync(testFile, originalContent);

			const result = await editTool.execute("test-call-5", {
				path: testFile,
				oldText: "world",
				newText: "testing",
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			expect(result.details).toBeUndefined();
		});

		it("should fail if text not found", async () => {
			const testFile = join(testDir, "edit-test.txt");
			const originalContent = "Hello, world!";
			writeFileSync(testFile, originalContent);

			const result = await editTool.execute("test-call-6", {
				path: testFile,
				oldText: "nonexistent",
				newText: "testing",
			});

			expect(getTextOutput(result)).toContain("Could not find the exact text");
		});

		it("should fail if text appears multiple times", async () => {
			const testFile = join(testDir, "edit-test.txt");
			const originalContent = "foo foo foo";
			writeFileSync(testFile, originalContent);

			const result = await editTool.execute("test-call-7", {
				path: testFile,
				oldText: "foo",
				newText: "bar",
			});

			expect(getTextOutput(result)).toContain("Found 3 occurrences");
		});
	});

	describe("bash tool", () => {
		it("should execute simple commands", async () => {
			const result = await bashTool.execute("test-call-8", { command: "echo 'test output'" });

			expect(getTextOutput(result)).toContain("test output");
			expect(result.details).toBeUndefined();
		});

		it("should handle command errors", async () => {
			const result = await bashTool.execute("test-call-9", { command: "exit 1" });

			expect(getTextOutput(result)).toContain("Command failed");
		});

		it("should respect timeout", async () => {
			const result = await bashTool.execute("test-call-10", { command: "sleep 35" });

			expect(getTextOutput(result)).toContain("Command failed");
		}, 35000);
	});
});
