import type { ActionResult, GameAction, GameAdapter, SimulationResult, WorldState } from "../../src/index.js";

export class MockGameAdapter<TState extends WorldState = WorldState> implements GameAdapter<TState> {
	private state: TState;
	private executedActions: GameAction[] = [];
	private actionHandler?: (action: GameAction) => ActionResult;

	constructor(initialState: TState) {
		this.state = initialState;
	}

	setWorldState(state: TState): void {
		this.state = state;
	}

	getExecutedActions(): GameAction[] {
		return [...this.executedActions];
	}

	setActionHandler(handler: (action: GameAction) => ActionResult): void {
		this.actionHandler = handler;
	}

	async getWorldState(): Promise<TState> {
		return this.state;
	}

	async executeAction(action: GameAction): Promise<ActionResult> {
		this.executedActions.push(action);
		if (this.actionHandler) return this.actionHandler(action);
		return { success: true, txHash: "0xmock" };
	}

	async simulateAction(_action: GameAction): Promise<SimulationResult> {
		return { success: true, outcome: { simulated: true } };
	}
}
