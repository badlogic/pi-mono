import { beforeEach, describe, expect, it } from "vitest";
import type { GameAction, WorldState } from "../src/index.js";
import { MockGameAdapter } from "./utils/mock-adapter.js";

interface TestEntity {
	id: string;
	type: string;
}

interface TestWorldState extends WorldState<TestEntity> {
	mapSize: number;
}

describe("MockGameAdapter", () => {
	let adapter: MockGameAdapter<TestWorldState>;
	const initialState: TestWorldState = {
		tick: 0,
		timestamp: 1000,
		entities: [{ id: "unit-1", type: "warrior" }],
		mapSize: 64,
	};

	beforeEach(() => {
		adapter = new MockGameAdapter<TestWorldState>(initialState);
	});

	describe("getWorldState", () => {
		it("should return the initial state", async () => {
			const state = await adapter.getWorldState();
			expect(state).toBe(initialState);
			expect(state.tick).toBe(0);
			expect(state.entities).toHaveLength(1);
			expect(state.mapSize).toBe(64);
		});
	});

	describe("setWorldState", () => {
		it("should update what getWorldState returns", async () => {
			const newState: TestWorldState = {
				tick: 5,
				timestamp: 2000,
				entities: [],
				mapSize: 128,
			};

			adapter.setWorldState(newState);
			const state = await adapter.getWorldState();
			expect(state).toBe(newState);
			expect(state.tick).toBe(5);
			expect(state.mapSize).toBe(128);
		});
	});

	describe("executeAction", () => {
		it("should record executed actions and return success", async () => {
			const action: GameAction = { type: "move", params: { x: 10, y: 20 } };
			const result = await adapter.executeAction(action);

			expect(result.success).toBe(true);
			expect(result.txHash).toBe("0xmock");
		});

		it("should record multiple actions in order", async () => {
			const action1: GameAction = { type: "move", params: { x: 1 } };
			const action2: GameAction = { type: "attack", params: { targetId: "enemy-1" } };

			await adapter.executeAction(action1);
			await adapter.executeAction(action2);

			const executed = adapter.getExecutedActions();
			expect(executed).toHaveLength(2);
			expect(executed[0].type).toBe("move");
			expect(executed[1].type).toBe("attack");
		});
	});

	describe("setActionHandler", () => {
		it("should override default behavior with custom handler", async () => {
			adapter.setActionHandler((action) => ({
				success: false,
				error: `Cannot execute ${action.type}`,
			}));

			const action: GameAction = { type: "build", params: { building: "barracks" } };
			const result = await adapter.executeAction(action);

			expect(result.success).toBe(false);
			expect(result.error).toBe("Cannot execute build");
		});

		it("should still record actions when using custom handler", async () => {
			adapter.setActionHandler(() => ({ success: true, data: { custom: true } }));

			const action: GameAction = { type: "heal", params: {} };
			await adapter.executeAction(action);

			expect(adapter.getExecutedActions()).toHaveLength(1);
			expect(adapter.getExecutedActions()[0].type).toBe("heal");
		});
	});

	describe("getExecutedActions", () => {
		it("should return empty array initially", () => {
			expect(adapter.getExecutedActions()).toEqual([]);
		});

		it("should return a copy of the actions array", async () => {
			const action: GameAction = { type: "move", params: {} };
			await adapter.executeAction(action);

			const actions1 = adapter.getExecutedActions();
			const actions2 = adapter.getExecutedActions();
			expect(actions1).toEqual(actions2);
			expect(actions1).not.toBe(actions2);
		});
	});

	describe("simulateAction", () => {
		it("should return a simulation result", async () => {
			const action: GameAction = { type: "move", params: { x: 5, y: 10 } };
			const result = await adapter.simulateAction(action);

			expect(result.success).toBe(true);
			expect(result.outcome).toEqual({ simulated: true });
		});
	});
});
