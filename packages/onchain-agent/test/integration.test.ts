import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Decision } from "../src/decision-log.js";
import { createDecisionRecorder } from "../src/decision-log.js";
import { buildGamePrompt, loadSoul, loadTaskLists } from "../src/soul.js";
import { createTickLoop, formatTickPrompt } from "../src/tick-loop.js";
import { createExecuteActionTool, createGameTools, createObserveGameTool } from "../src/tools.js";
import type { ActionResult, GameAction, WorldState } from "../src/types.js";
import { MockGameAdapter } from "./utils/mock-adapter.js";

function getFirstTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
	const firstContent = result.content[0];
	if (!firstContent || firstContent.type !== "text" || typeof firstContent.text !== "string") {
		throw new Error("Expected first tool result content item to be text");
	}
	return firstContent.text;
}

describe("Integration Tests", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "onchain-agent-integration-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("Test 1: Full decision recording lifecycle", () => {
		it("should record a decision and read it back with correct content", async () => {
			// Setup: soul.md and task files (for context, though not used directly here)
			writeFileSync(join(tmpDir, "soul.md"), "You are a strategic battle commander.");
			mkdirSync(join(tmpDir, "tasks"), { recursive: true });
			writeFileSync(join(tmpDir, "tasks", "combat.md"), "# Combat\n- Attack weak enemies first");

			// Create MockGameAdapter with a test state
			new MockGameAdapter({
				tick: 10,
				timestamp: Date.now(),
				entities: [{ id: "unit-1", type: "warrior" }],
				resources: new Map([["gold", 100]]),
			});

			// Create a DecisionRecorder
			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);

			// Record a decision
			const decision: Decision = {
				tick: 10,
				timestamp: 1700000010000,
				reasoning: "Enemy base is undefended. Sending warrior to attack.",
				actionTaken: { type: "attack", params: { targetId: "enemy-base-1" } },
				result: { success: true, txHash: "0xabc123" },
			};

			await recorder.record(decision);

			// Verify the decision file exists
			expect(existsSync(logDir)).toBe(true);
			const files = readdirSync(logDir);
			expect(files).toHaveLength(1);
			expect(files[0]).toBe("10-1700000010000.md");

			// Verify file content
			const content = readFileSync(join(logDir, files[0]), "utf-8");
			expect(content).toContain("tick: 10");
			expect(content).toContain("timestamp: 1700000010000");
			expect(content).toContain("actionType: attack");
			expect(content).toContain("success: true");
			expect(content).toContain("Enemy base is undefended");
			expect(content).toContain("Type: attack");
			expect(content).toContain("TxHash: 0xabc123");

			// Read decisions back and verify
			const decisions = await recorder.getDecisions();
			expect(decisions).toHaveLength(1);
			expect(decisions[0].tick).toBe(10);
			expect(decisions[0].reasoning).toContain("Enemy base is undefended");
		});
	});

	describe("Test 2: Task list loading + prompt building flow", () => {
		it("should load soul, load tasks, and build a prompt containing both", () => {
			// Setup: Create soul.md, tasks/combat.md, tasks/economy.md
			writeFileSync(join(tmpDir, "soul.md"), "---\ntitle: Battle Soul\n---\nYou are a fearless warrior AI.");
			const taskDir = join(tmpDir, "tasks");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "# Combat Tasks\n- Defend the gate\n- Scout perimeter");
			writeFileSync(join(taskDir, "economy.md"), "# Economy Tasks\n- Gather wood\n- Mine gold");

			// Load soul and tasks
			const soul = loadSoul(join(tmpDir, "soul.md"));
			const taskLists = loadTaskLists(taskDir);

			// Verify soul loaded (frontmatter stripped)
			expect(soul).toBe("You are a fearless warrior AI.");
			expect(soul).not.toContain("title: Battle Soul");

			// Verify tasks loaded
			expect(taskLists.size).toBe(2);
			expect(taskLists.has("combat")).toBe(true);
			expect(taskLists.has("economy")).toBe(true);
			expect(taskLists.get("combat")).toContain("Defend the gate");
			expect(taskLists.get("economy")).toContain("Mine gold");

			// Build prompt
			const { systemPrompt, appendSections } = buildGamePrompt({
				soul,
				taskLists,
			});

			// Verify system prompt contains soul
			expect(systemPrompt).toBe("You are a fearless warrior AI.");

			// Verify append sections contain task list XML
			expect(appendSections.length).toBeGreaterThanOrEqual(1);
			const taskSection = appendSections.find((s) => s.includes("<task_lists>"));
			expect(taskSection).toBeDefined();
			expect(taskSection).toContain('<domain name="combat">');
			expect(taskSection).toContain('<domain name="economy">');
			expect(taskSection).toContain("Defend the gate");
			expect(taskSection).toContain("Mine gold");
			expect(taskSection).toContain("</task_lists>");
		});
	});

	describe("Test 3: Game tools + adapter integration", () => {
		it("should observe, execute, and simulate actions through adapter", async () => {
			// Setup: Create MockGameAdapter
			const adapter = new MockGameAdapter({
				tick: 5,
				timestamp: 1700000005000,
				entities: [
					{ id: "unit-1", type: "archer" },
					{ id: "unit-2", type: "knight" },
				],
				resources: new Map([
					["gold", 300],
					["wood", 150],
				]),
			});

			// Create all game tools
			const tools = createGameTools(adapter);
			expect(tools).toHaveLength(3);

			const observeTool = tools.find((t) => t.name === "observe_game")!;
			const executeTool = tools.find((t) => t.name === "execute_action")!;
			const simulateTool = tools.find((t) => t.name === "simulate_action")!;

			expect(observeTool).toBeDefined();
			expect(executeTool).toBeDefined();
			expect(simulateTool).toBeDefined();

			// Call observe tool -> verify it returns the mock state
			const observeResult = await observeTool.execute("call-1", {});
			expect(observeResult.content).toBeDefined();
			expect(observeResult.content.length).toBeGreaterThan(0);
			const observeText = getFirstTextContent(observeResult);
			const observeData = JSON.parse(observeText);
			expect(observeData.tick).toBe(5);
			expect(observeData.entities).toHaveLength(2);
			expect(observeData.resources.gold).toBe(300);
			expect(observeData.resources.wood).toBe(150);

			// Call execute tool -> verify adapter.executeAction was called
			const executeResult = await executeTool.execute("call-2", {
				actionType: "move",
				params: { unitId: "unit-1", target: { x: 10, y: 20 } },
			});
			const executeData = JSON.parse(getFirstTextContent(executeResult));
			expect(executeData.success).toBe(true);
			expect(executeData.txHash).toBe("0xmock");

			// Verify executed actions are recorded in adapter history
			const executedActions = adapter.getExecutedActions();
			expect(executedActions).toHaveLength(1);
			expect(executedActions[0].type).toBe("move");
			expect(executedActions[0].params).toEqual({ unitId: "unit-1", target: { x: 10, y: 20 } });

			// Call simulate tool -> verify adapter.simulateAction was called
			const simulateResult = await simulateTool.execute("call-3", {
				actionType: "attack",
				params: { targetId: "enemy-1" },
			});
			const simulateData = JSON.parse(getFirstTextContent(simulateResult));
			expect(simulateData.success).toBe(true);
			expect(simulateData.outcome).toEqual({ simulated: true });
		});

		it("should handle custom action handler results", async () => {
			const adapter = new MockGameAdapter({
				tick: 1,
				timestamp: Date.now(),
				entities: [],
			});

			adapter.setActionHandler((action: GameAction): ActionResult => {
				if (action.type === "build" && action.params.building === "castle") {
					return { success: false, error: "Not enough resources" };
				}
				return { success: true, txHash: "0xok" };
			});

			const executeTool = createExecuteActionTool(adapter);

			// Action that fails
			const failResult = await executeTool.execute("call-1", {
				actionType: "build",
				params: { building: "castle" },
			});
			const failData = JSON.parse(getFirstTextContent(failResult));
			expect(failData.success).toBe(false);
			expect(failData.error).toBe("Not enough resources");

			// Action that succeeds
			const okResult = await executeTool.execute("call-2", {
				actionType: "build",
				params: { building: "wall" },
			});
			const okData = JSON.parse(getFirstTextContent(okResult));
			expect(okData.success).toBe(true);
		});
	});

	describe("Test 4: Tick loop + adapter integration", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should tick multiple times and query adapter state", async () => {
			let currentTick = 0;
			const adapter = new MockGameAdapter({
				tick: currentTick,
				timestamp: Date.now(),
				entities: [{ id: "unit-1" }],
			});

			// Track onTick calls and adapter queries
			const tickStates: WorldState[] = [];

			const loop = createTickLoop({
				intervalMs: 50,
				async onTick() {
					// Query adapter on each tick (simulating what the agent would do)
					const state = await adapter.getWorldState();
					tickStates.push(state);
					// Simulate state changing between ticks
					currentTick++;
					adapter.setWorldState({
						tick: currentTick,
						timestamp: Date.now(),
						entities: [{ id: "unit-1" }],
					});
				},
			});

			// Start loop, wait for 3 ticks
			loop.start();

			// First tick fires immediately
			await vi.advanceTimersByTimeAsync(0);
			expect(loop.tickCount).toBe(1);

			// Second tick at 50ms
			await vi.advanceTimersByTimeAsync(50);
			expect(loop.tickCount).toBe(2);

			// Third tick at 100ms
			await vi.advanceTimersByTimeAsync(50);
			expect(loop.tickCount).toBe(3);

			loop.stop();

			// Verify tickCount matches
			expect(loop.tickCount).toBe(3);
			expect(loop.isRunning).toBe(false);

			// Verify adapter was queried each tick
			expect(tickStates).toHaveLength(3);
			expect(tickStates[0].tick).toBe(0);
			expect(tickStates[1].tick).toBe(1);
			expect(tickStates[2].tick).toBe(2);
		});
	});

	describe("Test 5: Decision recorder + game tools together", () => {
		it("should observe, execute, and record the decision in sequence", async () => {
			// Setup: Create MockGameAdapter, DecisionRecorder
			const adapter = new MockGameAdapter({
				tick: 7,
				timestamp: 1700000007000,
				entities: [
					{ id: "hero", type: "warrior", hp: 100 },
					{ id: "goblin", type: "enemy", hp: 30 },
				],
				resources: new Map([["gold", 50]]),
			});

			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);

			// Step 1: Observe game state
			const observeTool = createObserveGameTool(adapter);
			const observeResult = await observeTool.execute("obs-1", {});
			const stateJson = JSON.parse(getFirstTextContent(observeResult));
			expect(stateJson.tick).toBe(7);
			expect(stateJson.entities).toHaveLength(2);

			// Step 2: Execute an action
			const executeTool = createExecuteActionTool(adapter);
			const executeResult = await executeTool.execute("exec-1", {
				actionType: "attack",
				params: { targetId: "goblin" },
			});
			const actionResult = JSON.parse(getFirstTextContent(executeResult));
			expect(actionResult.success).toBe(true);

			// Step 3: Record the decision
			await recorder.record({
				tick: 7,
				timestamp: 1700000007000,
				reasoning: "Goblin has low HP (30). Hero should attack to eliminate the threat.",
				actionTaken: { type: "attack", params: { targetId: "goblin" } },
				result: { success: actionResult.success, txHash: actionResult.txHash },
			});

			// Verify decision file has the action and reasoning
			const files = readdirSync(logDir);
			expect(files).toHaveLength(1);
			const content = readFileSync(join(logDir, files[0]), "utf-8");
			expect(content).toContain("Goblin has low HP");
			expect(content).toContain("Type: attack");
			expect(content).toContain("Success: true");

			// Read decisions back and verify tick ordering
			const decisions = await recorder.getDecisions();
			expect(decisions).toHaveLength(1);
			expect(decisions[0].tick).toBe(7);
			expect(decisions[0].reasoning).toContain("Goblin has low HP");

			// Verify the action is in the adapter history
			const executedActions = adapter.getExecutedActions();
			expect(executedActions).toHaveLength(1);
			expect(executedActions[0].type).toBe("attack");
		});

		it("should record multiple decisions with ordering preserved", async () => {
			const adapter = new MockGameAdapter({
				tick: 1,
				timestamp: Date.now(),
				entities: [{ id: "hero" }],
			});

			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);
			const executeTool = createExecuteActionTool(adapter);

			// Play a sequence of 3 ticks
			for (let tick = 1; tick <= 3; tick++) {
				adapter.setWorldState({
					tick,
					timestamp: 1700000000000 + tick * 1000,
					entities: [{ id: "hero" }],
				});

				await executeTool.execute(`exec-${tick}`, {
					actionType: tick === 2 ? "defend" : "scout",
					params: { area: `zone-${tick}` },
				});

				await recorder.record({
					tick,
					timestamp: 1700000000000 + tick * 1000,
					reasoning: `Tick ${tick}: Evaluating area zone-${tick}.`,
					actionTaken: { type: tick === 2 ? "defend" : "scout", params: { area: `zone-${tick}` } },
					result: { success: true, txHash: `0xtx${tick}` },
				});
			}

			// Verify ordering
			const decisions = await recorder.getDecisions();
			expect(decisions).toHaveLength(3);
			expect(decisions[0].tick).toBe(1);
			expect(decisions[1].tick).toBe(2);
			expect(decisions[2].tick).toBe(3);

			// Verify all actions recorded in adapter
			const actions = adapter.getExecutedActions();
			expect(actions).toHaveLength(3);
			expect(actions[0].type).toBe("scout");
			expect(actions[1].type).toBe("defend");
			expect(actions[2].type).toBe("scout");
		});
	});

	describe("Test 6: formatTickPrompt produces valid prompt", () => {
		it("should produce prompt with tick number, entity count, resources, and instructions", () => {
			const state: WorldState = {
				tick: 42,
				timestamp: 1700000042000,
				entities: [
					{ id: "warrior-1", type: "warrior" },
					{ id: "archer-1", type: "archer" },
					{ id: "castle", type: "building" },
				],
				resources: new Map([
					["gold", 1500],
					["wood", 800],
					["food", 200],
				]),
			};

			const prompt = formatTickPrompt(state);

			// Verify it mentions the tick number
			expect(prompt).toContain("Tick 42");
			expect(prompt).toContain("42");

			// Verify it mentions entity count
			expect(prompt).toContain("3");

			// Verify it mentions resource values
			expect(prompt).toContain("gold");
			expect(prompt).toContain("1500");
			expect(prompt).toContain("wood");
			expect(prompt).toContain("800");
			expect(prompt).toContain("food");
			expect(prompt).toContain("200");

			// Verify it includes the instructions
			expect(prompt).toContain("observe_game");
			expect(prompt).toContain("execute_action");
			expect(prompt).toContain("reasoning");
		});

		it("should handle empty entities and no resources", () => {
			const state: WorldState = {
				tick: 0,
				timestamp: 1700000000000,
				entities: [],
			};

			const prompt = formatTickPrompt(state);

			expect(prompt).toContain("Tick 0");
			expect(prompt).toContain("Entities: 0");
			expect(prompt).toContain("None tracked");
		});

		it("should handle large state gracefully", () => {
			const entities = Array.from({ length: 1000 }, (_, i) => ({ id: `entity-${i}` }));
			const resources = new Map<string, number>();
			resources.set("gold", 999999);
			resources.set("mana", 500);

			const state: WorldState = {
				tick: 9999,
				timestamp: Date.now(),
				entities,
				resources,
			};

			const prompt = formatTickPrompt(state);

			expect(prompt).toContain("Tick 9999");
			expect(prompt).toContain("1000");
			expect(prompt).toContain("999999");
		});
	});

	describe("Test 7: Multiple decisions over time", () => {
		it("should record 10 decisions and query with various filters", async () => {
			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);

			// Record 10 decisions with incrementing ticks
			for (let i = 1; i <= 10; i++) {
				await recorder.record({
					tick: i,
					timestamp: 1700000000000 + i * 1000,
					reasoning: `Decision at tick ${i}: evaluating options.`,
					actionTaken: { type: "action", params: { step: i } },
					result: { success: true, txHash: `0x${i.toString(16)}` },
				});
			}

			// getDecisions() returns all 10
			const allDecisions = await recorder.getDecisions();
			expect(allDecisions).toHaveLength(10);
			expect(allDecisions[0].tick).toBe(1);
			expect(allDecisions[9].tick).toBe(10);

			// getDecisions({ limit: 3 }) returns last 3
			const last3 = await recorder.getDecisions({ limit: 3 });
			expect(last3).toHaveLength(3);
			expect(last3[0].tick).toBe(8);
			expect(last3[1].tick).toBe(9);
			expect(last3[2].tick).toBe(10);

			// getDecisions({ since: 5 }) returns only decisions from tick 5+
			const since5 = await recorder.getDecisions({ since: 5 });
			expect(since5).toHaveLength(6);
			expect(since5[0].tick).toBe(5);
			expect(since5[5].tick).toBe(10);

			// getDecisions({ since: 5, limit: 2 }) combines both filters
			const since5limit2 = await recorder.getDecisions({ since: 5, limit: 2 });
			expect(since5limit2).toHaveLength(2);
			// since: 5 gives ticks 5-10 (6 items), limit: 2 takes last 2
			expect(since5limit2[0].tick).toBe(9);
			expect(since5limit2[1].tick).toBe(10);
		});

		it("should handle getDecisions on empty log dir", async () => {
			const logDir = join(tmpDir, "empty-decisions");
			const recorder = createDecisionRecorder(logDir);

			const decisions = await recorder.getDecisions();
			expect(decisions).toEqual([]);
		});

		it("should preserve reasoning text through record/read cycle", async () => {
			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);

			const complexReasoning = `The enemy has:
- 5 warriors at the gate
- 2 archers on the wall
- Limited gold reserves

Best strategy: flank from the east while sending a distraction force north.`;

			await recorder.record({
				tick: 1,
				timestamp: 1700000001000,
				reasoning: complexReasoning,
			});

			const decisions = await recorder.getDecisions();
			expect(decisions).toHaveLength(1);
			expect(decisions[0].reasoning).toContain("5 warriors at the gate");
			expect(decisions[0].reasoning).toContain("flank from the east");
		});
	});

	describe("Test 8: Full prompt building with world state summary", () => {
		it("should build prompt integrating soul, tasks, and world state summary", () => {
			// Setup: Create soul.md and tasks
			writeFileSync(join(tmpDir, "soul.md"), "You are an adaptive strategy AI that learns from every battle.");
			const taskDir = join(tmpDir, "tasks");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(
				join(taskDir, "combat.md"),
				"# Combat\n- Priority: Defend base\n- Secondary: Raid enemy resources",
			);
			writeFileSync(join(taskDir, "economy.md"), "# Economy\n- Build farms\n- Trade surplus wood for gold");

			const soul = loadSoul(join(tmpDir, "soul.md"));
			const taskLists = loadTaskLists(taskDir);

			// Create world state summary from formatTickPrompt
			const state: WorldState = {
				tick: 15,
				timestamp: 1700000015000,
				entities: [{ id: "base" }, { id: "farm-1" }, { id: "warrior-1" }],
				resources: new Map([
					["gold", 250],
					["wood", 400],
				]),
			};

			const worldStateSummary = formatTickPrompt(state);

			// Build the full prompt
			const { systemPrompt, appendSections } = buildGamePrompt({
				soul,
				taskLists,
				worldStateSummary,
			});

			// Verify system prompt is the soul
			expect(systemPrompt).toBe("You are an adaptive strategy AI that learns from every battle.");

			// Verify append sections contain both task lists and world state
			expect(appendSections.length).toBe(2);

			// Task list section
			const taskSection = appendSections.find((s) => s.includes("<task_lists>"))!;
			expect(taskSection).toContain("Defend base");
			expect(taskSection).toContain("Build farms");

			// World state section
			const worldSection = appendSections.find((s) => s.includes("Current World State"))!;
			expect(worldSection).toContain("Tick 15");
			expect(worldSection).toContain("gold");
			expect(worldSection).toContain("250");
		});
	});

	describe("Test 9: End-to-end agent tick simulation", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should simulate a complete agent loop: tick -> observe -> decide -> execute -> record", async () => {
			// Setup the full system
			const adapter = new MockGameAdapter({
				tick: 0,
				timestamp: 1700000000000,
				entities: [
					{ id: "hero", hp: 100 },
					{ id: "enemy", hp: 50 },
				],
				resources: new Map([["gold", 100]]),
			});

			const logDir = join(tmpDir, "decisions");
			const recorder = createDecisionRecorder(logDir);
			const observeTool = createObserveGameTool(adapter);
			const executeTool = createExecuteActionTool(adapter);

			let tickNumber = 0;

			const loop = createTickLoop({
				intervalMs: 100,
				async onTick() {
					tickNumber++;

					// Update adapter state for this tick
					adapter.setWorldState({
						tick: tickNumber,
						timestamp: 1700000000000 + tickNumber * 1000,
						entities: [
							{ id: "hero", hp: 100 - tickNumber * 5 },
							{ id: "enemy", hp: 50 - tickNumber * 15 },
						],
						resources: new Map([["gold", 100 + tickNumber * 10]]),
					});

					// 1. Observe
					const obsResult = await observeTool.execute(`obs-${tickNumber}`, {});
					const state = JSON.parse(getFirstTextContent(obsResult));

					// 2. Decide and Execute
					await executeTool.execute(`exec-${tickNumber}`, {
						actionType: "attack",
						params: { targetId: "enemy", tick: tickNumber },
					});

					// 3. Record
					await recorder.record({
						tick: tickNumber,
						timestamp: state.timestamp,
						reasoning: `Tick ${tickNumber}: Enemy HP is declining. Continuing attack.`,
						actionTaken: { type: "attack", params: { targetId: "enemy" } },
						result: { success: true, txHash: `0xtick${tickNumber}` },
					});
				},
			});

			// Run for 3 ticks
			loop.start();
			await vi.advanceTimersByTimeAsync(0); // tick 1
			await vi.advanceTimersByTimeAsync(100); // tick 2
			await vi.advanceTimersByTimeAsync(100); // tick 3
			loop.stop();

			expect(loop.tickCount).toBe(3);

			// Verify decisions were recorded
			const decisions = await recorder.getDecisions();
			expect(decisions).toHaveLength(3);
			expect(decisions[0].tick).toBe(1);
			expect(decisions[1].tick).toBe(2);
			expect(decisions[2].tick).toBe(3);

			// Verify all actions went through the adapter
			const actions = adapter.getExecutedActions();
			expect(actions).toHaveLength(3);
			expect(actions.every((a) => a.type === "attack")).toBe(true);

			// Verify decisions have correct reasoning
			expect(decisions[0].reasoning).toContain("Tick 1");
			expect(decisions[2].reasoning).toContain("Tick 3");
		});
	});
});
