import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runShellCommand } from "../src/cli/shell-command.js";

describe("shell command", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-shell-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tempDir, "subdir"), { recursive: true });
		process.exitCode = undefined;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("fails when no interactive tty is available", async () => {
		const stderr: string[] = [];
		await runShellCommand([], {
			isTTY: false,
			stderrWrite: (text) => stderr.push(text),
		});

		expect(stderr.join("")).toContain("requires an interactive TTY");
		expect(process.exitCode).toBe(1);
	});

	it("updates cwd when cd is used before the next command", async () => {
		const commands: Array<{ command: string; cwd: string }> = [];
		const stdout: string[] = [];
		const prompt = {
			lines: ["cd subdir", "pwd", "exit"],
			async question(): Promise<string> {
				return this.lines.shift() ?? "exit";
			},
			close() {},
		};

		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			await runShellCommand([], {
				isTTY: true,
				createPrompt: () => prompt,
				stdoutWrite: (text) => stdout.push(text),
				stderrWrite: () => {},
				onSigint: () => {},
				offSigint: () => {},
				runner: {
					async run({ command, cwd, onChunk }) {
						commands.push({ command, cwd });
						onChunk(`${cwd}\n`);
						return { exitCode: 0, cancelled: false, timedOut: false };
					},
				},
			});
		} finally {
			process.chdir(originalCwd);
		}

		expect(commands).toEqual([{ command: "pwd", cwd: join(tempDir, "subdir") }]);
		expect(stdout.join("")).toContain("Type .help for commands.");
	});

	it("shows command exit codes from the runner", async () => {
		const stderr: string[] = [];
		const prompt = {
			lines: ["false", "exit"],
			async question(): Promise<string> {
				return this.lines.shift() ?? "exit";
			},
			close() {},
		};

		await runShellCommand([], {
			isTTY: true,
			createPrompt: () => prompt,
			stdoutWrite: () => {},
			stderrWrite: (text) => stderr.push(text),
			onSigint: () => {},
			offSigint: () => {},
			runner: {
				async run() {
					return { exitCode: 7, cancelled: false, timedOut: false };
				},
			},
		});

		expect(stderr.join("")).toContain("Exit code: 7");
	});
});
