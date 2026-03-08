import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentsCommand } from "../src/cli/agents-command.js";
import { ENV_AGENT_DIR } from "../src/config.js";

describe("agents command", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;
	let originalCwd: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-agents-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		mkdirSync(join(projectDir, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "agents", "reviewer.md"),
			`---
name: reviewer
description: Project reviewer
---
Review files carefully.
`,
		);
		originalCwd = process.cwd();
		originalAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = agentDir;
		process.chdir(projectDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
	});

	it("prints discovered agents as json", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runAgentsCommand(["--json"]);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain('"name": "reviewer"');
			expect(output).toContain('"source": "project"');
		} finally {
			logSpy.mockRestore();
		}
	});
});
