import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, watch, writeFileSync } from "fs";
import { join } from "path";
import { getControlChannelsDir } from "./config.js";

/**
 * Control channel for sending events into a running pi session.
 *
 * Uses a file-based event queue:
 * - Events are written as individual JSON files to {agentDir}/control-channels/{sessionId}/events/
 * - The running session watches this directory for new files
 * - Events are queued and delivered when the session is ready or waiting
 */

export interface ControlChannelEvent {
	id: string;
	timestamp: number;
	payload: unknown;
}

/**
 * Get the control channel directory for a specific session
 */
export function getControlChannelDir(sessionId: string): string {
	return join(getControlChannelsDir(), sessionId);
}

/**
 * Get the events directory for a specific session
 */
export function getEventsDir(sessionId: string): string {
	return join(getControlChannelDir(sessionId), "events");
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
	return randomBytes(16).toString("hex");
}

/**
 * Initialize the control channel directory for a session.
 * Creates the directory structure and returns the session ID.
 */
export function initControlChannel(sessionId: string): void {
	const eventsDir = getEventsDir(sessionId);
	if (!existsSync(eventsDir)) {
		mkdirSync(eventsDir, { recursive: true });
	}
}

/**
 * Clean up the control channel directory for a session
 */
export function cleanupControlChannel(sessionId: string): void {
	const channelDir = getControlChannelDir(sessionId);
	if (existsSync(channelDir)) {
		try {
			rmSync(channelDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Send an event to a session's control channel.
 * Used by `pi --session ID --send-event '{...}'`
 */
export function sendEvent(sessionId: string, payload: unknown): void {
	const eventsDir = getEventsDir(sessionId);

	if (!existsSync(eventsDir)) {
		throw new Error(`Session ${sessionId} not found or not accepting events`);
	}

	const eventId = randomBytes(8).toString("hex");
	const timestamp = Date.now();
	const event: ControlChannelEvent = {
		id: eventId,
		timestamp,
		payload,
	};

	// Use timestamp + random ID to ensure ordering and uniqueness
	const filename = `${timestamp}-${eventId}.json`;
	const filepath = join(eventsDir, filename);

	writeFileSync(filepath, JSON.stringify(event));
}

/**
 * Callback type for when an event is received.
 */
export type EventCallback = (event: ControlChannelEvent) => void;

/**
 * Event receiver that watches for incoming events and notifies via callback.
 */
export class EventReceiver {
	private sessionId: string;
	private eventsDir: string;
	private watcher: ReturnType<typeof watch> | null = null;
	private onEvent: EventCallback | null = null;
	private waitResolvers: Array<(event: ControlChannelEvent) => void> = [];

	constructor(sessionId: string) {
		this.sessionId = sessionId;
		this.eventsDir = getEventsDir(sessionId);
	}

	/**
	 * Set the callback to be called when an event is received.
	 * The callback is called for every event, regardless of whether
	 * someone is waiting via waitForEvent().
	 */
	setEventCallback(callback: EventCallback | null): void {
		this.onEvent = callback;
	}

	/**
	 * Start watching for events
	 */
	start(): void {
		// Initialize the directory
		initControlChannel(this.sessionId);

		// Load any existing events (in case some arrived before we started watching)
		this.loadExistingEvents();

		// Start watching for new events
		this.watcher = watch(this.eventsDir, (eventType, filename) => {
			if (eventType === "rename" && filename && filename.endsWith(".json")) {
				this.handleNewEventFile(filename);
			}
		});
	}

	/**
	 * Stop watching and clean up
	 */
	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		cleanupControlChannel(this.sessionId);
	}

	/**
	 * Wait for the next event with optional timeout.
	 * Returns the event or null if timeout.
	 * Note: The event callback is still called when the event arrives.
	 */
	async waitForEvent(timeoutMs: number = 60000): Promise<ControlChannelEvent | null> {
		// Wait for a new event
		return new Promise((resolve) => {
			const timeoutHandle = setTimeout(() => {
				// Remove this resolver from the list
				const index = this.waitResolvers.indexOf(resolver);
				if (index !== -1) {
					this.waitResolvers.splice(index, 1);
				}
				resolve(null);
			}, timeoutMs);

			const resolver = (event: ControlChannelEvent) => {
				clearTimeout(timeoutHandle);
				resolve(event);
			};

			this.waitResolvers.push(resolver);
		});
	}

	private loadExistingEvents(): void {
		if (!existsSync(this.eventsDir)) return;

		const files = readdirSync(this.eventsDir)
			.filter((f) => f.endsWith(".json"))
			.sort(); // Sort by timestamp (filename prefix)

		for (const filename of files) {
			this.handleNewEventFile(filename);
		}
	}

	private handleNewEventFile(filename: string): void {
		const filepath = join(this.eventsDir, filename);

		try {
			if (!existsSync(filepath)) return;

			const content = readFileSync(filepath, "utf-8");
			const event = JSON.parse(content) as ControlChannelEvent;

			// Delete the file after reading
			try {
				unlinkSync(filepath);
			} catch {
				// Ignore deletion errors
			}

			// Always call the event callback first
			if (this.onEvent) {
				this.onEvent(event);
			}

			// Also resolve any waiters
			if (this.waitResolvers.length > 0) {
				const resolver = this.waitResolvers.shift()!;
				resolver(event);
			}
		} catch {
			// Ignore malformed event files
		}
	}
}
