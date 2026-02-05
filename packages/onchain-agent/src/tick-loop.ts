import type { WorldState } from "./types.js";

export interface TickLoop {
	start(): void;
	stop(): void;
	readonly isRunning: boolean;
	readonly tickCount: number;
}

export function createTickLoop(options: {
	intervalMs: number;
	onTick: () => Promise<void>;
	onError?: (error: Error) => void;
}): TickLoop {
	let timer: ReturnType<typeof setInterval> | null = null;
	let running = false;
	let ticking = false; // mutex
	let count = 0;

	async function tick() {
		if (ticking) return; // skip if previous tick still running
		ticking = true;
		try {
			await options.onTick();
			count++;
		} catch (err) {
			options.onError?.(err instanceof Error ? err : new Error(String(err)));
		} finally {
			ticking = false;
		}
	}

	return {
		start() {
			if (running) return;
			running = true;
			tick(); // immediate first tick
			timer = setInterval(tick, options.intervalMs);
		},
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			running = false;
		},
		get isRunning() {
			return running;
		},
		get tickCount() {
			return count;
		},
	};
}

export function formatTickPrompt(state: WorldState): string {
	const resourceStr = state.resources
		? Array.from(state.resources.entries())
				.map(([k, v]) => `- ${k}: ${v}`)
				.join("\n")
		: "None tracked";

	return `## Tick ${state.tick} - Think Cycle

Current world state snapshot:
- Tick: ${state.tick}
- Entities: ${state.entities.length}
- Resources:
${resourceStr}

Review your soul, task lists, and priorities. Then:

1. Use \`observe_game\` if you need more detail on specific areas
2. Load any relevant skills by reading their SKILL.md files
3. Decide on your action(s) for this tick
4. Use \`execute_action\` to submit your chosen action(s)
5. Use \`write\` to update your task files, priorities, reflection, or soul as needed
6. Explain your reasoning briefly`;
}
