import { describe, expect, it, vi } from "vitest";
import { runCommitCommand } from "../src/cli/commit-command.js";

describe("commit command", () => {
	it("shows a dry-run preview for staged files", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runCommitCommand(["--dry-run"], {
				runner: {
					run(command, args) {
						if (command === "git" && args.join(" ") === "diff --cached --name-only") {
							return {
								status: 0,
								stdout:
									"packages/coding-agent/src/cli/command-router.ts\npackages/coding-agent/src/cli/args.ts\n",
								stderr: "",
							};
						}
						throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
					},
				},
			});
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Commit preview:");
			expect(output).toContain("chore(coding-agent): update staged files");
			expect(output).toContain("staged files: 2");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("commits and pushes when requested", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const calls: string[] = [];
		try {
			await runCommitCommand(["--message", "feat: test", "--push"], {
				runner: {
					run(command, args) {
						calls.push(`${command} ${args.join(" ")}`);
						if (command === "git" && args.join(" ") === "diff --cached --name-only") {
							return { status: 0, stdout: "README.md\n", stderr: "" };
						}
						if (command === "git" && args.join(" ") === "commit -m feat: test") {
							return { status: 0, stdout: "", stderr: "" };
						}
						if (command === "git" && args.join(" ") === "push") {
							return { status: 0, stdout: "", stderr: "" };
						}
						throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
					},
				},
			});

			expect(calls).toEqual(["git diff --cached --name-only", "git commit -m feat: test", "git push"]);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Committed staged changes");
			expect(output).toContain("Pushed current branch");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("fails when nothing is staged", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		process.exitCode = undefined;
		try {
			await runCommitCommand([], {
				runner: {
					run(command, args) {
						if (command === "git" && args.join(" ") === "diff --cached --name-only") {
							return { status: 0, stdout: "", stderr: "" };
						}
						throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
					},
				},
			});
			const output = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("No staged changes to commit");
			expect(process.exitCode).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
