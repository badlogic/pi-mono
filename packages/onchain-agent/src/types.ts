import type { Model } from "@mariozechner/pi-ai";

/**
 * Generic world state representation for any game.
 * TEntity is game-specific (units, buildings, cards, pieces, etc.)
 */
export interface WorldState<TEntity = unknown> {
	tick: number;
	timestamp: number;
	entities: TEntity[];
	resources?: Map<string, number>;
	raw?: unknown;
}

/**
 * Adapter pattern for connecting to any game.
 * Implement this per-game (Dojo, EVM, etc.)
 */
export interface GameAdapter<TState extends WorldState = WorldState> {
	getWorldState(): Promise<TState>;
	executeAction(action: GameAction): Promise<ActionResult>;
	simulateAction(action: GameAction): Promise<SimulationResult>;
	subscribe?(callback: (state: TState) => void): () => void;
}

/**
 * An action the agent can take in the game.
 */
export interface GameAction {
	type: string;
	params: Record<string, unknown>;
}

/**
 * Result of executing an action on chain.
 */
export interface ActionResult {
	success: boolean;
	txHash?: string;
	data?: unknown;
	error?: string;
}

/**
 * Result of simulating an action (dry run).
 */
export interface SimulationResult {
	success: boolean;
	outcome?: unknown;
	cost?: unknown;
	error?: string;
}

/**
 * Configuration for creating a game agent.
 */
export interface GameAgentConfig<TState extends WorldState = WorldState> {
	adapter: GameAdapter<TState>;
	dataDir: string;
	model?: Model<any>;
	tickIntervalMs?: number;
}
