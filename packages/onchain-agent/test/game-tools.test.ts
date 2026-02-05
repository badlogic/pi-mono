import { describe, expect, it, vi } from "vitest";
import {
	createExecuteActionTool,
	createGameTools,
	createObserveGameTool,
	createSimulateActionTool,
} from "../src/tools.js";
import type { GameAdapter } from "../src/types.js";

function createMockAdapter(): GameAdapter {
	return {
		getWorldState: vi.fn(async () => ({
			tick: 42,
			timestamp: 1700000000000,
			entities: [{ id: "u1", type: "warrior" }],
			resources: new Map([
				["gold", 500],
				["wood", 200],
			]),
		})),
		executeAction: vi.fn(async (_action) => ({
			success: true,
			txHash: "0xabc123",
		})),
		simulateAction: vi.fn(async (_action) => ({
			success: true,
			outcome: { damage: 50 },
			cost: { gas: 21000 },
		})),
	};
}

describe("Game Tools", () => {
	describe("createObserveGameTool", () => {
		it("should return an AgentTool with name 'observe_game'", () => {
			const adapter = createMockAdapter();
			const tool = createObserveGameTool(adapter);

			expect(tool.name).toBe("observe_game");
			expect(tool.label).toBe("Observe Game");
			expect(tool.description).toBeDefined();
			expect(tool.parameters).toBeDefined();
			expect(typeof tool.execute).toBe("function");
		});

		it("should call adapter.getWorldState() and return JSON text", async () => {
			const adapter = createMockAdapter();
			const tool = createObserveGameTool(adapter);

			const result = await tool.execute("call-1", {});

			expect(adapter.getWorldState).toHaveBeenCalledOnce();
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");

			const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
			expect(parsed.tick).toBe(42);
			expect(parsed.timestamp).toBe(1700000000000);
			expect(parsed.entities).toEqual([{ id: "u1", type: "warrior" }]);
			// Map should be serialized to an object
			expect(parsed.resources).toEqual({ gold: 500, wood: 200 });
		});

		it("should include tick in details", async () => {
			const adapter = createMockAdapter();
			const tool = createObserveGameTool(adapter);

			const result = await tool.execute("call-1", {});

			expect(result.details).toBeDefined();
			expect(result.details.tick).toBe(42);
		});

		it("should handle world state without resources", async () => {
			const adapter = createMockAdapter();
			(adapter.getWorldState as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				tick: 1,
				timestamp: 1700000000000,
				entities: [],
			});
			const tool = createObserveGameTool(adapter);

			const result = await tool.execute("call-1", {});
			const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);

			expect(parsed.resources).toBeUndefined();
		});
	});

	describe("createExecuteActionTool", () => {
		it("should return an AgentTool with name 'execute_action'", () => {
			const adapter = createMockAdapter();
			const tool = createExecuteActionTool(adapter);

			expect(tool.name).toBe("execute_action");
			expect(tool.label).toBe("Execute Action");
			expect(tool.description).toBeDefined();
			expect(tool.parameters).toBeDefined();
			expect(typeof tool.execute).toBe("function");
		});

		it("should call adapter.executeAction() with correct action shape", async () => {
			const adapter = createMockAdapter();
			const tool = createExecuteActionTool(adapter);

			const result = await tool.execute("call-2", {
				actionType: "move",
				params: { unitId: "u1", targetX: 10, targetY: 20 },
			});

			expect(adapter.executeAction).toHaveBeenCalledOnce();
			expect(adapter.executeAction).toHaveBeenCalledWith({
				type: "move",
				params: { unitId: "u1", targetX: 10, targetY: 20 },
			});

			const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
			expect(parsed.success).toBe(true);
			expect(parsed.txHash).toBe("0xabc123");
		});

		it("should return error content when adapter returns failure", async () => {
			const adapter = createMockAdapter();
			(adapter.executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				success: false,
				error: "Insufficient resources",
			});
			const tool = createExecuteActionTool(adapter);

			const result = await tool.execute("call-2", {
				actionType: "build",
				params: { building: "barracks" },
			});

			const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
			expect(parsed.success).toBe(false);
			expect(parsed.error).toBe("Insufficient resources");
		});

		it("should default params to empty object when not provided", async () => {
			const adapter = createMockAdapter();
			const tool = createExecuteActionTool(adapter);

			await tool.execute("call-2", { actionType: "end_turn" });

			expect(adapter.executeAction).toHaveBeenCalledWith({
				type: "end_turn",
				params: {},
			});
		});
	});

	describe("createSimulateActionTool", () => {
		it("should return an AgentTool with name 'simulate_action'", () => {
			const adapter = createMockAdapter();
			const tool = createSimulateActionTool(adapter);

			expect(tool.name).toBe("simulate_action");
			expect(tool.label).toBe("Simulate Action");
			expect(tool.description).toBeDefined();
			expect(tool.parameters).toBeDefined();
			expect(typeof tool.execute).toBe("function");
		});

		it("should call adapter.simulateAction() with correct action shape", async () => {
			const adapter = createMockAdapter();
			const tool = createSimulateActionTool(adapter);

			const result = await tool.execute("call-3", {
				actionType: "attack",
				params: { targetId: "enemy-1" },
			});

			expect(adapter.simulateAction).toHaveBeenCalledOnce();
			expect(adapter.simulateAction).toHaveBeenCalledWith({
				type: "attack",
				params: { targetId: "enemy-1" },
			});

			const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
			expect(parsed.success).toBe(true);
			expect(parsed.outcome).toEqual({ damage: 50 });
			expect(parsed.cost).toEqual({ gas: 21000 });
		});

		it("should default params to empty object when not provided", async () => {
			const adapter = createMockAdapter();
			const tool = createSimulateActionTool(adapter);

			await tool.execute("call-3", { actionType: "scout" });

			expect(adapter.simulateAction).toHaveBeenCalledWith({
				type: "scout",
				params: {},
			});
		});
	});

	describe("createGameTools", () => {
		it("should return array of all 3 tools", () => {
			const adapter = createMockAdapter();
			const tools = createGameTools(adapter);

			expect(tools).toHaveLength(3);
			expect(tools[0].name).toBe("observe_game");
			expect(tools[1].name).toBe("execute_action");
			expect(tools[2].name).toBe("simulate_action");
		});
	});
});
