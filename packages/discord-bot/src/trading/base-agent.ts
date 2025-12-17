/**
 * Base Trading Agent
 * Modular agent pattern inspired by Moon Dev's architecture
 */

import type { AgentConfig, AgentState, TradeSignal } from "./types.js";

export type SignalHandler = (signal: TradeSignal) => Promise<void>;

export abstract class BaseAgent {
	protected config: AgentConfig;
	protected state: AgentState;
	protected signalHandlers: SignalHandler[] = [];
	private intervalId: NodeJS.Timeout | null = null;

	constructor(config: AgentConfig) {
		this.config = config;
		this.state = {
			lastRun: 0,
			isRunning: false,
			errorCount: 0,
			signalsGenerated: 0,
		};
	}

	get name(): string {
		return this.config.name;
	}

	get isEnabled(): boolean {
		return this.config.enabled;
	}

	get stats(): AgentState {
		return { ...this.state };
	}

	onSignal(handler: SignalHandler): void {
		this.signalHandlers.push(handler);
	}

	protected async emitSignal(signal: TradeSignal): Promise<void> {
		this.state.signalsGenerated++;
		for (const handler of this.signalHandlers) {
			try {
				await handler(signal);
			} catch (error) {
				console.error(`[${this.name}] Signal handler error:`, error);
			}
		}
	}

	async start(): Promise<void> {
		if (this.intervalId) {
			console.log(`[${this.name}] Already running`);
			return;
		}

		console.log(`[${this.name}] Starting agent (interval: ${this.config.interval}ms)`);

		// Run immediately
		await this.runOnce();

		// Then run on interval
		this.intervalId = setInterval(async () => {
			await this.runOnce();
		}, this.config.interval);
	}

	async stop(): Promise<void> {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			console.log(`[${this.name}] Stopped`);
		}
	}

	private async runOnce(): Promise<void> {
		if (this.state.isRunning) {
			console.log(`[${this.name}] Skipping - already running`);
			return;
		}

		this.state.isRunning = true;
		this.state.lastRun = Date.now();

		try {
			await this.run();
			this.state.errorCount = 0;
			this.state.lastError = undefined;
		} catch (error) {
			this.state.errorCount++;
			this.state.lastError = error instanceof Error ? error.message : String(error);
			console.error(`[${this.name}] Error:`, this.state.lastError);

			// Exponential backoff on repeated errors
			if (this.state.errorCount > 3) {
				console.log(`[${this.name}] Too many errors, pausing for 60s`);
				await this.stop();
				setTimeout(() => this.start(), 60000);
			}
		} finally {
			this.state.isRunning = false;
		}
	}

	/**
	 * Main agent logic - implement in subclass
	 */
	protected abstract run(): Promise<void>;

	/**
	 * Cleanup resources - override if needed
	 */
	async cleanup(): Promise<void> {
		await this.stop();
	}
}
