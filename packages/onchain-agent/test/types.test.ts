import { describe, expect, it } from "vitest";
import type {
	ActionResult,
	GameAction,
	GameAdapter,
	GameAgentConfig,
	SimulationResult,
	WorldState,
} from "../src/index.js";

interface TestEntity {
	id: string;
	type: "unit" | "building";
	owner: string;
	x: number;
	y: number;
	hp: number;
}

interface TestWorldState extends WorldState<TestEntity> {
	mapWidth: number;
	mapHeight: number;
}

describe("Core Types", () => {
	describe("WorldState", () => {
		it("should support generic entity types", () => {
			const state: WorldState<TestEntity> = {
				tick: 42,
				timestamp: Date.now(),
				entities: [
					{ id: "unit-1", type: "unit", owner: "player-1", x: 10, y: 20, hp: 100 },
					{ id: "building-1", type: "building", owner: "player-1", x: 5, y: 5, hp: 500 },
				],
			};

			expect(state.tick).toBe(42);
			expect(state.entities).toHaveLength(2);
			expect(state.entities[0].type).toBe("unit");
		});

		it("should support optional resources", () => {
			const state: WorldState<TestEntity> = {
				tick: 1,
				timestamp: Date.now(),
				entities: [],
				resources: new Map([
					["gold", 500],
					["wood", 200],
				]),
			};

			expect(state.resources?.get("gold")).toBe(500);
		});

		it("should support optional raw data", () => {
			const state: WorldState = {
				tick: 0,
				timestamp: Date.now(),
				entities: [],
				raw: { contractState: "0x1234" },
			};

			expect(state.raw).toBeDefined();
		});

		it("should support extended world state", () => {
			const state: TestWorldState = {
				tick: 10,
				timestamp: Date.now(),
				entities: [],
				mapWidth: 100,
				mapHeight: 100,
			};

			expect(state.mapWidth).toBe(100);
		});
	});

	describe("GameAction", () => {
		it("should have type and params", () => {
			const action: GameAction = {
				type: "move",
				params: { unitId: "unit-1", targetX: 15, targetY: 25 },
			};

			expect(action.type).toBe("move");
			expect(action.params.unitId).toBe("unit-1");
		});

		it("should allow empty params", () => {
			const action: GameAction = {
				type: "end_turn",
				params: {},
			};

			expect(action.type).toBe("end_turn");
			expect(Object.keys(action.params)).toHaveLength(0);
		});
	});

	describe("ActionResult", () => {
		it("should represent success", () => {
			const result: ActionResult = {
				success: true,
				txHash: "0xabc123",
				data: { newPosition: { x: 15, y: 25 } },
			};

			expect(result.success).toBe(true);
			expect(result.txHash).toBe("0xabc123");
		});

		it("should represent failure", () => {
			const result: ActionResult = {
				success: false,
				error: "Insufficient resources",
			};

			expect(result.success).toBe(false);
			expect(result.error).toBe("Insufficient resources");
		});
	});

	describe("SimulationResult", () => {
		it("should represent simulation outcome", () => {
			const result: SimulationResult = {
				success: true,
				outcome: { predictedDamage: 50 },
				cost: { gas: 21000 },
			};

			expect(result.success).toBe(true);
			expect(result.outcome).toBeDefined();
			expect(result.cost).toBeDefined();
		});
	});

	describe("GameAdapter", () => {
		it("should define the adapter interface", () => {
			const adapter: GameAdapter<TestWorldState> = {
				async getWorldState() {
					return {
						tick: 0,
						timestamp: Date.now(),
						entities: [],
						mapWidth: 100,
						mapHeight: 100,
					};
				},
				async executeAction(_action: GameAction) {
					return { success: true, txHash: "0x123" };
				},
				async simulateAction(_action: GameAction) {
					return { success: true, outcome: {} };
				},
			};

			expect(adapter.getWorldState).toBeDefined();
			expect(adapter.executeAction).toBeDefined();
			expect(adapter.simulateAction).toBeDefined();
		});

		it("should support optional subscribe", () => {
			const adapter: GameAdapter = {
				async getWorldState() {
					return { tick: 0, timestamp: Date.now(), entities: [] };
				},
				async executeAction() {
					return { success: true };
				},
				async simulateAction() {
					return { success: true };
				},
				subscribe(_callback) {
					return () => {};
				},
			};

			expect(adapter.subscribe).toBeDefined();
			const unsub = adapter.subscribe!(() => {});
			expect(typeof unsub).toBe("function");
		});
	});

	describe("GameAgentConfig", () => {
		it("should accept required and optional fields", () => {
			const adapter: GameAdapter = {
				async getWorldState() {
					return { tick: 0, timestamp: Date.now(), entities: [] };
				},
				async executeAction() {
					return { success: true };
				},
				async simulateAction() {
					return { success: true };
				},
			};

			const config: GameAgentConfig = {
				adapter,
				dataDir: "/tmp/agent-data",
			};

			expect(config.adapter).toBe(adapter);
			expect(config.dataDir).toBe("/tmp/agent-data");
			expect(config.model).toBeUndefined();
			expect(config.tickIntervalMs).toBeUndefined();
		});
	});
});
