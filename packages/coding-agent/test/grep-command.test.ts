import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGrepCommand } from "../src/cli/grep-command.js";

describe("grep command", () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-grep-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(join(tempDir, "src", "one.ts"), "const value = 1;\n// TODO: fix this\n");
		writeFileSync(join(tempDir, "src", "two.ts"), "export function test() {}\n");
		originalCwd = process.cwd();
		process.chdir(tempDir);
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("prints grep matches", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runGrepCommand(["TODO", "src", "--glob", "*.ts"]);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("one.ts:2: // TODO: fix this");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints raw json when requested", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runGrepCommand(["TODO", "src", "--json"]);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('"content"');
		} finally {
			logSpy.mockRestore();
		}
	});
});
