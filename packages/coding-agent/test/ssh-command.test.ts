import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSSHCommand } from "../src/cli/ssh-command.js";
import { ENV_AGENT_DIR } from "../src/config.js";

describe("ssh command", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;
	let originalCwd: string;
	let originalAgentDir: string | undefined;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-ssh-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		originalCwd = process.cwd();
		originalAgentDir = process.env[ENV_AGENT_DIR];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.env[ENV_AGENT_DIR] = agentDir;
		process.chdir(projectDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("adds and lists a project-scoped host", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runSSHCommand(["add", "prod", "--host", "prod.example.com", "--user", "deploy"]);
			const projectConfigPath = join(projectDir, ".pi", "ssh.json");
			expect(existsSync(projectConfigPath)).toBe(true);
			const config = JSON.parse(readFileSync(projectConfigPath, "utf-8")) as {
				hosts: Record<string, { host: string; username?: string }>;
			};
			expect(config.hosts.prod).toEqual({
				host: "prod.example.com",
				username: "deploy",
			});

			logSpy.mockClear();
			await runSSHCommand(["list", "--json"]);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('"prod"');
			expect(output).toContain('"project"');
		} finally {
			logSpy.mockRestore();
		}
	});

	it("validates port values", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await runSSHCommand(["add", "prod", "--host", "prod.example.com", "--port", "70000"]);
			const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(stderr).toContain("Port must be an integer between 1 and 65535");
			expect(process.exitCode).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
