import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameAgent } from "../src/game-agent.js";
import { MockGameAdapter } from "./utils/mock-adapter.js";

function makeTempDir(): string {
	const dir = join(tmpdir(), `onchain-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeDefaultAdapter(): MockGameAdapter {
	return new MockGameAdapter({
		tick: 1,
		timestamp: Date.now(),
		entities: [{ id: "unit-1" }],
		resources: new Map([["gold", 100]]),
	});
}

describe("Game Agent Factory", () => {
	let dataDir: string;
	let adapter: MockGameAdapter;

	beforeEach(() => {
		dataDir = makeTempDir();
		adapter = makeDefaultAdapter();
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
	});

	describe("createGameAgent return shape", () => {
		it("should return { agent, tools, ticker, recorder, dispose }", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			expect(result).toHaveProperty("agent");
			expect(result).toHaveProperty("tools");
			expect(result).toHaveProperty("ticker");
			expect(result).toHaveProperty("recorder");
			expect(result).toHaveProperty("dispose");
			expect(typeof result.dispose).toBe("function");
		});
	});

	describe("tools", () => {
		it("should include observe_game, execute_action, simulate_action (3 tools)", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			expect(result.tools).toHaveLength(3);

			const toolNames = result.tools.map((t) => t.name);
			expect(toolNames).toContain("observe_game");
			expect(toolNames).toContain("execute_action");
			expect(toolNames).toContain("simulate_action");
		});

		it("should provide tools that are wired to the adapter", async () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const observeTool = result.tools.find((t) => t.name === "observe_game")!;
			const toolResult = await observeTool.execute("test-call-id", {});
			expect(toolResult.content[0].type).toBe("text");

			const parsed = JSON.parse((toolResult.content[0] as any).text);
			expect(parsed.tick).toBe(1);
		});
	});

	describe("system prompt", () => {
		it("should contain the soul content when soul.md exists", () => {
			writeFileSync(join(dataDir, "soul.md"), "I am a fearless warrior AI.");

			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const systemPrompt = result.agent.state.systemPrompt;
			expect(systemPrompt).toContain("I am a fearless warrior AI.");
		});

		it("should use default prompt when no soul.md exists", () => {
			// dataDir has no soul.md
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const systemPrompt = result.agent.state.systemPrompt;
			expect(systemPrompt).toContain("You are an autonomous game agent.");
		});

		it("should include task list content when tasks directory exists", () => {
			writeFileSync(join(dataDir, "soul.md"), "Base soul.");

			const taskDir = join(dataDir, "tasks");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "# Combat Tasks\n- Attack enemies");
			writeFileSync(join(taskDir, "economy.md"), "# Economy Tasks\n- Gather resources");

			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const systemPrompt = result.agent.state.systemPrompt;
			expect(systemPrompt).toContain("combat");
			expect(systemPrompt).toContain("Attack enemies");
			expect(systemPrompt).toContain("economy");
			expect(systemPrompt).toContain("Gather resources");
		});

		it("should work when tasks directory does not exist", () => {
			writeFileSync(join(dataDir, "soul.md"), "Simple soul.");

			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const systemPrompt = result.agent.state.systemPrompt;
			expect(systemPrompt).toContain("Simple soul.");
			// Should not throw or include task_lists XML
			expect(systemPrompt).not.toContain("<task_lists>");
		});

		it("should strip frontmatter from soul.md", () => {
			writeFileSync(join(dataDir, "soul.md"), "---\nname: warrior\n---\nI fight bravely.");

			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const systemPrompt = result.agent.state.systemPrompt;
			expect(systemPrompt).toContain("I fight bravely.");
			expect(systemPrompt).not.toContain("name: warrior");
		});
	});

	describe("agent configuration", () => {
		it("should configure the agent with the provided tools", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			const agentTools = result.agent.state.tools;
			expect(agentTools).toHaveLength(3);
			expect(agentTools.map((t) => t.name)).toEqual(
				expect.arrayContaining(["observe_game", "execute_action", "simulate_action"]),
			);
		});

		it("should set thinkingLevel based on model reasoning capability", () => {
			// Without model (default) - no reasoning
			const result1 = createGameAgent({
				adapter,
				dataDir,
			});
			// Default model has no reasoning, so thinkingLevel should be "off"
			expect(result1.agent.state.thinkingLevel).toBe("off");
		});
	});

	describe("ticker", () => {
		it("should be a TickLoop with start, stop, isRunning, tickCount", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			expect(result.ticker).toHaveProperty("start");
			expect(result.ticker).toHaveProperty("stop");
			expect(result.ticker).toHaveProperty("isRunning");
			expect(result.ticker).toHaveProperty("tickCount");
			expect(typeof result.ticker.start).toBe("function");
			expect(typeof result.ticker.stop).toBe("function");
			expect(typeof result.ticker.isRunning).toBe("boolean");
			expect(typeof result.ticker.tickCount).toBe("number");
		});

		it("should not be running initially", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			expect(result.ticker.isRunning).toBe(false);
			expect(result.ticker.tickCount).toBe(0);
		});
	});

	describe("recorder", () => {
		it("should be a DecisionRecorder with record and getDecisions", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			expect(result.recorder).toHaveProperty("record");
			expect(result.recorder).toHaveProperty("getDecisions");
			expect(typeof result.recorder.record).toBe("function");
			expect(typeof result.recorder.getDecisions).toBe("function");
		});

		it("should record decisions to the dataDir/decisions directory", async () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			await result.recorder.record({
				tick: 1,
				timestamp: Date.now(),
				reasoning: "Test decision",
			});

			const decisions = await result.recorder.getDecisions();
			expect(decisions).toHaveLength(1);
			expect(decisions[0].reasoning).toBe("Test decision");
		});
	});

	describe("dispose", () => {
		it("should stop the ticker when called", async () => {
			vi.useFakeTimers();

			try {
				const result = createGameAgent({
					adapter,
					dataDir,
					streamFn: vi.fn() as any,
				});

				result.ticker.start();
				expect(result.ticker.isRunning).toBe(true);

				await result.dispose();
				expect(result.ticker.isRunning).toBe(false);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe("custom streamFn", () => {
		it("should accept a custom streamFn option", () => {
			const mockStreamFn = vi.fn() as any;

			const result = createGameAgent({
				adapter,
				dataDir,
				streamFn: mockStreamFn,
			});

			// The agent should have been created with the custom streamFn
			expect(result.agent.streamFn).toBe(mockStreamFn);
		});
	});

	describe("custom tickIntervalMs", () => {
		it("should use the default interval when not specified", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
			});

			// Ticker exists and is valid - we can't directly inspect intervalMs
			// but we can verify it was created
			expect(result.ticker).toBeDefined();
		});

		it("should accept a custom tick interval", () => {
			const result = createGameAgent({
				adapter,
				dataDir,
				tickIntervalMs: 5000,
			});

			expect(result.ticker).toBeDefined();
		});
	});
});
