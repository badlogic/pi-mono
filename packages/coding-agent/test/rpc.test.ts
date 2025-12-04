import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CompactionEntry } from "../src/session-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * RPC mode tests.
 * Regression test for issue #83: https://github.com/badlogic/pi-mono/issues/83
 */
describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_OAUTH_TOKEN)("RPC mode", () => {
	let agent: ChildProcess;
	let sessionDir: string;

	beforeEach(() => {
		// Create a unique temp directory for sessions
		sessionDir = join(tmpdir(), `pi-rpc-test-${Date.now()}`);
	});

	afterEach(() => {
		// Kill the agent if still running
		if (agent && !agent.killed) {
			agent.kill("SIGKILL");
		}
		// Clean up session directory
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	test("should save messages to session file", async () => {
		// Spawn agent in RPC mode with custom session directory
		agent = spawn(
			"node",
			["dist/cli.js", "--mode", "rpc", "--provider", "anthropic", "--model", "claude-sonnet-4-5"],
			{
				cwd: join(__dirname, ".."),
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: sessionDir,
				},
			},
		);

		const events: AgentEvent[] = [];

		// Parse agent events
		const rl = readline.createInterface({ input: agent.stdout!, terminal: false });

		// Collect stderr for debugging
		let stderr = "";
		agent.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		// Wait for agent_end which signals the full prompt/response cycle is complete
		const waitForAgentEnd = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Timeout waiting for agent_end")), 60000);

			rl.on("line", (line: string) => {
				try {
					const event = JSON.parse(line) as AgentEvent;
					events.push(event);

					// agent_end means the full prompt cycle completed (user msg + assistant response)
					if (event.type === "agent_end") {
						clearTimeout(timeout);
						resolve();
					}
				} catch {
					// Ignore non-JSON lines
				}
			});

			rl.on("close", () => {
				clearTimeout(timeout);
				reject(new Error("Agent stdout closed before agent_end"));
			});
		});

		// Send a simple prompt - the LLM will respond
		agent.stdin!.write(JSON.stringify({ type: "prompt", message: "Reply with just the word 'hello'" }) + "\n");

		// Wait for full prompt/response cycle to complete
		await waitForAgentEnd;

		// Check that message_end events were emitted
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBeGreaterThanOrEqual(2); // user + assistant

		// Wait a bit for file writes to complete
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Kill the agent gracefully
		agent.kill("SIGTERM");

		// Find and verify the session file
		const sessionsPath = join(sessionDir, "sessions");
		expect(existsSync(sessionsPath), `Sessions path should exist: ${sessionsPath}. Stderr: ${stderr}`).toBe(true);

		// Find the session directory (it's based on cwd)
		const sessionDirs = readdirSync(sessionsPath);
		expect(sessionDirs.length, `Should have at least one session dir. Stderr: ${stderr}`).toBeGreaterThan(0);

		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const allFiles = readdirSync(cwdSessionDir);
		const sessionFiles = allFiles.filter((f) => f.endsWith(".jsonl"));
		expect(
			sessionFiles.length,
			`Should have exactly one session file. Dir: ${cwdSessionDir}, Files: ${JSON.stringify(allFiles)}, Stderr: ${stderr}`,
		).toBe(1);

		// Read and verify session content
		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const lines = sessionContent.trim().split("\n");

		// Should have session header and at least 2 messages (user + assistant)
		expect(lines.length).toBeGreaterThanOrEqual(3);

		const entries = lines.map((line) => JSON.parse(line));

		// First entry should be session header
		expect(entries[0].type).toBe("session");

		// Should have user and assistant messages
		const messages = entries.filter((e: { type: string }) => e.type === "message");
		expect(messages.length).toBeGreaterThanOrEqual(2);

		const roles = messages.map((m: { message: { role: string } }) => m.message.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
	}, 90000);

	test("should handle manual compaction", async () => {
		// Spawn agent in RPC mode
		agent = spawn(
			"node",
			["dist/cli.js", "--mode", "rpc", "--provider", "anthropic", "--model", "claude-sonnet-4-5"],
			{
				cwd: join(__dirname, ".."),
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: sessionDir,
				},
			},
		);

		const events: (AgentEvent | CompactionEntry | { type: "error"; error: string })[] = [];

		const rl = readline.createInterface({ input: agent.stdout!, terminal: false });

		let stderr = "";
		agent.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		// Helper to wait for a specific event type
		const waitForEvent = (eventType: string, timeout = 60000) =>
			new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventType}`)), timeout);

				const checkExisting = () => {
					if (events.some((e) => e.type === eventType)) {
						clearTimeout(timer);
						resolve();
						return true;
					}
					return false;
				};

				if (checkExisting()) return;

				const handler = (line: string) => {
					try {
						const event = JSON.parse(line);
						events.push(event);
						if (event.type === eventType) {
							clearTimeout(timer);
							rl.off("line", handler);
							resolve();
						}
					} catch {
						// Ignore non-JSON
					}
				};
				rl.on("line", handler);
			});

		// First, send a prompt to have some messages to compact
		agent.stdin!.write(JSON.stringify({ type: "prompt", message: "Say hello" }) + "\n");
		await waitForEvent("agent_end");

		// Clear events to focus on compaction
		events.length = 0;

		// Send compact command
		agent.stdin!.write(JSON.stringify({ type: "compact" }) + "\n");
		await waitForEvent("compaction");

		// Verify compaction event
		const compactionEvent = events.find((e) => e.type === "compaction") as CompactionEntry | undefined;
		expect(compactionEvent).toBeDefined();
		expect(compactionEvent!.summary).toBeDefined();
		expect(compactionEvent!.tokensBefore).toBeGreaterThan(0);

		// Wait for file writes
		await new Promise((resolve) => setTimeout(resolve, 200));

		agent.kill("SIGTERM");

		// Verify compaction was saved to session file
		const sessionsPath = join(sessionDir, "sessions");
		const sessionDirs = readdirSync(sessionsPath);
		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const sessionFiles = readdirSync(cwdSessionDir).filter((f) => f.endsWith(".jsonl"));
		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const entries = sessionContent
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		// Should have a compaction entry
		const compactionEntries = entries.filter((e: { type: string }) => e.type === "compaction");
		expect(compactionEntries.length).toBe(1);
		expect(compactionEntries[0].summary).toBeDefined();
	}, 120000);
});
