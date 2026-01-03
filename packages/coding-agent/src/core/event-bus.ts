import { EventEmitter } from "node:events";

export interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface EventBusController extends EventBus {
	clear(): void;
}

export function createEventBus(): EventBusController {
	const emitter = new EventEmitter();
	return {
		emit: (channel, data) => {
			try {
				emitter.emit(channel, data);
			} catch (err) {
				console.error(`Event handler error (${channel}):`, err);
			}
		},
		on: (channel, handler) => {
			emitter.on(channel, handler);
			return () => emitter.off(channel, handler);
		},
		clear: () => {
			emitter.removeAllListeners();
		},
	};
}
