/**
 * Events System for Pi Discord Bot
 * Adapted from pi-mom's events system
 * Supports immediate, one-shot, and periodic events
 */

import { Cron } from "croner";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, statSync, unlinkSync, watch } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

// ============================================================================
// Event Types
// ============================================================================

export interface ImmediateEvent {
	type: "immediate";
	channelId: string;
	text: string;
}

export interface OneShotEvent {
	type: "one-shot";
	channelId: string;
	text: string;
	at: string; // ISO 8601 with timezone offset
}

export interface PeriodicEvent {
	type: "periodic";
	channelId: string;
	text: string;
	schedule: string; // cron syntax
	timezone: string; // IANA timezone
}

export type DiscordEvent = ImmediateEvent | OneShotEvent | PeriodicEvent;

// ============================================================================
// Logging helpers (simple console output)
// ============================================================================

function logInfo(message: string): void {
	console.log(`[INFO] [EVENTS] ${message}`);
}

function logWarning(message: string, detail?: string): void {
	console.warn(`[WARN] [EVENTS] ${message}${detail ? `: ${detail}` : ""}`);
}

// ============================================================================
// EventHandler Interface
// ============================================================================

export interface EventHandler {
	handleEvent(channelId: string, message: string): Promise<void>;
}

// ============================================================================
// EventsWatcher
// ============================================================================

const DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;

export class EventsWatcher {
	private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private crons: Map<string, Cron> = new Map();
	private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private startTime: number;
	private watcher: FSWatcher | null = null;
	private knownFiles: Set<string> = new Set();

	constructor(
		private eventsDir: string,
		private handler: EventHandler,
	) {
		this.startTime = Date.now();
	}

	/**
	 * Start watching for events.
	 */
	start(): void {
		// Ensure events directory exists
		if (!existsSync(this.eventsDir)) {
			mkdirSync(this.eventsDir, { recursive: true });
		}

		logInfo(`Events watcher starting, dir: ${this.eventsDir}`);

		// Scan existing files
		this.scanExisting();

		// Watch for changes
		this.watcher = watch(this.eventsDir, (_eventType, filename) => {
			if (!filename || !filename.endsWith(".json")) return;
			this.debounce(filename, () => this.handleFileChange(filename));
		});

		logInfo(`Events watcher started, tracking ${this.knownFiles.size} files`);
	}

	/**
	 * Stop watching and cancel all scheduled events.
	 */
	stop(): void {
		// Stop fs watcher
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		// Cancel all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		// Cancel all scheduled timers
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();

		// Cancel all cron jobs
		for (const cron of this.crons.values()) {
			cron.stop();
		}
		this.crons.clear();

		this.knownFiles.clear();
		logInfo("Events watcher stopped");
	}

	/**
	 * Get count of active events
	 */
	getActiveCount(): number {
		return this.timers.size + this.crons.size;
	}

	private debounce(filename: string, fn: () => void): void {
		const existing = this.debounceTimers.get(filename);
		if (existing) {
			clearTimeout(existing);
		}

		this.debounceTimers.set(
			filename,
			setTimeout(() => {
				this.debounceTimers.delete(filename);
				fn();
			}, DEBOUNCE_MS),
		);
	}

	private scanExisting(): void {
		let files: string[];
		try {
			files = readdirSync(this.eventsDir).filter((f) => f.endsWith(".json"));
		} catch (err) {
			logWarning("Failed to read events directory", String(err));
			return;
		}

		for (const filename of files) {
			this.handleFile(filename);
		}
	}

	private handleFileChange(filename: string): void {
		const filePath = join(this.eventsDir, filename);

		if (!existsSync(filePath)) {
			// File was deleted
			this.handleDelete(filename);
		} else if (this.knownFiles.has(filename)) {
			// File was modified - cancel existing and re-schedule
			this.cancelScheduled(filename);
			this.handleFile(filename);
		} else {
			// New file
			this.handleFile(filename);
		}
	}

	private handleDelete(filename: string): void {
		if (!this.knownFiles.has(filename)) return;
		logInfo(`Event file deleted: ${filename}`);
		this.cancelScheduled(filename);
		this.knownFiles.delete(filename);
	}

	private cancelScheduled(filename: string): void {
		const timer = this.timers.get(filename);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(filename);
		}

		const cron = this.crons.get(filename);
		if (cron) {
			cron.stop();
			this.crons.delete(filename);
		}
	}

	private async handleFile(filename: string): Promise<void> {
		const filePath = join(this.eventsDir, filename);

		// Parse with retries
		let event: DiscordEvent | null = null;
		let lastError: Error | null = null;

		for (let i = 0; i < MAX_RETRIES; i++) {
			try {
				const content = await readFile(filePath, "utf-8");
				event = this.parseEvent(content, filename);
				break;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (i < MAX_RETRIES - 1) {
					await this.sleep(RETRY_BASE_MS * 2 ** i);
				}
			}
		}

		if (!event) {
			logWarning(`Failed to parse event file after ${MAX_RETRIES} retries: ${filename}`, lastError?.message);
			this.deleteFile(filename);
			return;
		}

		this.knownFiles.add(filename);

		// Schedule based on type
		switch (event.type) {
			case "immediate":
				this.handleImmediate(filename, event);
				break;
			case "one-shot":
				this.handleOneShot(filename, event);
				break;
			case "periodic":
				this.handlePeriodic(filename, event);
				break;
		}
	}

	private parseEvent(content: string, filename: string): DiscordEvent | null {
		const data = JSON.parse(content);

		if (!data.type || !data.channelId || !data.text) {
			throw new Error(`Missing required fields (type, channelId, text) in ${filename}`);
		}

		switch (data.type) {
			case "immediate":
				return { type: "immediate", channelId: data.channelId, text: data.text };
			case "one-shot":
				if (!data.at) {
					throw new Error(`Missing 'at' field for one-shot event in ${filename}`);
				}
				return { type: "one-shot", channelId: data.channelId, text: data.text, at: data.at };
			case "periodic":
				if (!data.schedule) {
					throw new Error(`Missing 'schedule' field for periodic event in ${filename}`);
				}
				if (!data.timezone) {
					throw new Error(`Missing 'timezone' field for periodic event in ${filename}`);
				}
				return {
					type: "periodic",
					channelId: data.channelId,
					text: data.text,
					schedule: data.schedule,
					timezone: data.timezone,
				};
			default:
				throw new Error(`Unknown event type '${data.type}' in ${filename}`);
		}
	}

	private handleImmediate(filename: string, event: ImmediateEvent): void {
		const filePath = join(this.eventsDir, filename);

		// Check if stale (created before watcher started)
		try {
			const stat = statSync(filePath);
			if (stat.mtimeMs < this.startTime) {
				logInfo(`Stale immediate event, deleting: ${filename}`);
				this.deleteFile(filename);
				return;
			}
		} catch {
			// File may have been deleted
			return;
		}

		logInfo(`Executing immediate event: ${filename}`);
		this.execute(filename, event);
	}

	private handleOneShot(filename: string, event: OneShotEvent): void {
		const atTime = new Date(event.at).getTime();
		const now = Date.now();

		if (atTime <= now) {
			// Past - delete without executing
			logInfo(`One-shot event in the past, deleting: ${filename}`);
			this.deleteFile(filename);
			return;
		}

		const delay = atTime - now;
		logInfo(`Scheduling one-shot event: ${filename} in ${Math.round(delay / 1000)}s`);

		const timer = setTimeout(() => {
			this.timers.delete(filename);
			logInfo(`Executing one-shot event: ${filename}`);
			this.execute(filename, event);
		}, delay);

		this.timers.set(filename, timer);
	}

	private handlePeriodic(filename: string, event: PeriodicEvent): void {
		try {
			const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
				logInfo(`Executing periodic event: ${filename}`);
				this.execute(filename, event, false); // Don't delete periodic events
			});

			this.crons.set(filename, cron);
			const next = cron.nextRun();
			logInfo(`Scheduled periodic event: ${filename}, next run: ${next?.toISOString() ?? "unknown"}`);
		} catch (err) {
			logWarning(`Invalid cron schedule for ${filename}: ${event.schedule}`, String(err));
			this.deleteFile(filename);
		}
	}

	private execute(filename: string, event: DiscordEvent, deleteAfter: boolean = true): void {
		// Format the message
		let scheduleInfo: string;
		switch (event.type) {
			case "immediate":
				scheduleInfo = "immediate";
				break;
			case "one-shot":
				scheduleInfo = event.at;
				break;
			case "periodic":
				scheduleInfo = event.schedule;
				break;
		}

		const message = `[EVENT:${filename}:${event.type}:${scheduleInfo}] ${event.text}`;

		// Execute via handler
		this.handler
			.handleEvent(event.channelId, message)
			.then(() => {
				if (deleteAfter) {
					this.deleteFile(filename);
				}
			})
			.catch((err) => {
				logWarning(`Failed to execute event ${filename}`, String(err));
				if (deleteAfter) {
					this.deleteFile(filename);
				}
			});
	}

	private deleteFile(filename: string): void {
		const filePath = join(this.eventsDir, filename);
		try {
			unlinkSync(filePath);
		} catch (err) {
			// ENOENT is fine (file already deleted), other errors are warnings
			if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
				logWarning(`Failed to delete event file: ${filename}`, String(err));
			}
		}
		this.knownFiles.delete(filename);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Create and start an events watcher.
 */
export function createEventsWatcher(workspaceDir: string, handler: EventHandler): EventsWatcher {
	const eventsDir = join(workspaceDir, "events");
	return new EventsWatcher(eventsDir, handler);
}
