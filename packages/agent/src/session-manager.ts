import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import type { AgentConfig, AgentEvent, AgentEventReceiver } from "./agent.js";

// Simple UUID v4 generator
function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	config: AgentConfig;
}

export interface SessionEvent {
	type: "event";
	timestamp: string;
	event: AgentEvent;
}

export interface SessionData {
	config: AgentConfig;
	events: SessionEvent[];
	totalUsage: Extract<AgentEvent, { type: "token_usage" }>;
}

export class SessionManager implements AgentEventReceiver {
	private sessionId!: string;
	private sessionFile!: string;
	private sessionDir: string;

	constructor(continueSession: boolean = false) {
		this.sessionDir = this.getSessionDirectory();

		if (continueSession) {
			const mostRecent = this.findMostRecentlyModifiedSession();
			if (mostRecent) {
				this.sessionFile = mostRecent;
				// Load session ID from file
				this.loadSessionId();
			} else {
				// No existing session, create new
				this.initNewSession();
			}
		} else {
			this.initNewSession();
		}
	}

	private getSessionDirectory(): string {
		const cwd = process.cwd();
		const safePath = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";

		const piConfigDir = resolve(process.env.PI_CONFIG_DIR || join(homedir(), ".pi"));
		const sessionDir = join(piConfigDir, "sessions", safePath);
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		return sessionDir;
	}

	private initNewSession(): void {
		this.sessionId = uuidv4();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.sessionFile = join(this.sessionDir, `${timestamp}_${this.sessionId}.jsonl`);
	}

	private findMostRecentlyModifiedSession(): string | null {
		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => ({
					name: f,
					path: join(this.sessionDir, f),
					mtime: statSync(join(this.sessionDir, f)).mtime,
				}))
				.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			return files[0]?.path || null;
		} catch {
			return null;
		}
	}

	private loadSessionId(): void {
		if (!existsSync(this.sessionFile)) return;

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session") {
					this.sessionId = entry.id;
					return;
				}
			} catch {
				// Skip malformed lines
			}
		}
		// If no session entry found, create new ID
		this.sessionId = uuidv4();
	}

	startSession(config: AgentConfig): void {
		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			config,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	async on(event: AgentEvent): Promise<void> {
		const entry: SessionEvent = {
			type: "event",
			timestamp: new Date().toISOString(),
			event: event,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	getSessionData(): SessionData | null {
		if (!existsSync(this.sessionFile)) return null;

		let config: AgentConfig | null = null;
		const events: SessionEvent[] = [];
		let totalUsage: Extract<AgentEvent, { type: "token_usage" }> = {
			type: "token_usage",
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session") {
					config = entry.config;
					this.sessionId = entry.id;
				} else if (entry.type === "event") {
					const eventEntry: SessionEvent = entry as SessionEvent;
					events.push(eventEntry);
					if (eventEntry.event.type === "token_usage") {
						totalUsage = entry.event as Extract<AgentEvent, { type: "token_usage" }>;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return config ? { config, events, totalUsage } : null;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}
}
