import type { AgentEvent, AgentState } from "@mariozechner/pi-agent";
import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

function uuidv4(): string {
	const bytes = randomBytes(16);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	systemPrompt: string;
	model: string;
	thinkingLevel: string;
}

export interface SessionMessageEntry {
	type: "message";
	timestamp: string;
	message: any; // AppMessage from agent state
}

export interface SessionEventEntry {
	type: "event";
	timestamp: string;
	event: AgentEvent;
}

export interface ThinkingLevelChangeEntry {
	type: "thinking_level_change";
	timestamp: string;
	thinkingLevel: string;
}

export interface ModelChangeEntry {
	type: "model_change";
	timestamp: string;
	model: string;
}

export class SessionManager {
	private sessionId!: string;
	private sessionFile!: string;
	private sessionDir: string;

	constructor(continueSession: boolean = false) {
		this.sessionDir = this.getSessionDirectory();

		if (continueSession) {
			const mostRecent = this.findMostRecentlyModifiedSession();
			if (mostRecent) {
				this.sessionFile = mostRecent;
				this.loadSessionId();
			} else {
				this.initNewSession();
			}
		} else {
			this.initNewSession();
		}
	}

	private getSessionDirectory(): string {
		const cwd = process.cwd();
		const safePath = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";

		const configDir = resolve(process.env.CODING_AGENT_DIR || join(homedir(), ".pi/agent/"));
		const sessionDir = join(configDir, "sessions", safePath);
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
		this.sessionId = uuidv4();
	}

	startSession(state: AgentState): void {
		const entry: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
			systemPrompt: state.systemPrompt,
			model: `${state.model.provider}/${state.model.id}`,
			thinkingLevel: state.thinkingLevel,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	saveMessage(message: any): void {
		const entry: SessionMessageEntry = {
			type: "message",
			timestamp: new Date().toISOString(),
			message,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	saveEvent(event: AgentEvent): void {
		const entry: SessionEventEntry = {
			type: "event",
			timestamp: new Date().toISOString(),
			event,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	saveThinkingLevelChange(thinkingLevel: string): void {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	saveModelChange(model: string): void {
		const entry: ModelChangeEntry = {
			type: "model_change",
			timestamp: new Date().toISOString(),
			model,
		};
		appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
	}

	loadMessages(): any[] {
		if (!existsSync(this.sessionFile)) return [];

		const messages: any[] = [];
		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message") {
					messages.push(entry.message);
				}
			} catch {
				// Skip malformed lines
			}
		}

		return messages;
	}

	loadThinkingLevel(): string {
		if (!existsSync(this.sessionFile)) return "off";

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");

		// Find the most recent thinking level (from session header or change event)
		let lastThinkingLevel = "off";
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session" && entry.thinkingLevel) {
					lastThinkingLevel = entry.thinkingLevel;
				} else if (entry.type === "thinking_level_change" && entry.thinkingLevel) {
					lastThinkingLevel = entry.thinkingLevel;
				}
			} catch {
				// Skip malformed lines
			}
		}

		return lastThinkingLevel;
	}

	loadModel(): string | null {
		if (!existsSync(this.sessionFile)) return null;

		const lines = readFileSync(this.sessionFile, "utf8").trim().split("\n");

		// Find the most recent model (from session header or change event)
		let lastModel: string | null = null;
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session" && entry.model) {
					lastModel = entry.model;
				} else if (entry.type === "model_change" && entry.model) {
					lastModel = entry.model;
				}
			} catch {
				// Skip malformed lines
			}
		}

		return lastModel;
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}

	/**
	 * Load all sessions for the current directory with metadata
	 */
	loadAllSessions(): Array<{
		path: string;
		id: string;
		created: Date;
		modified: Date;
		messageCount: number;
		firstMessage: string;
	}> {
		const sessions: Array<{
			path: string;
			id: string;
			created: Date;
			modified: Date;
			messageCount: number;
			firstMessage: string;
		}> = [];

		try {
			const files = readdirSync(this.sessionDir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => join(this.sessionDir, f));

			for (const file of files) {
				try {
					const stats = statSync(file);
					const content = readFileSync(file, "utf8");
					const lines = content.trim().split("\n");

					let sessionId = "";
					let created = stats.birthtime;
					let messageCount = 0;
					let firstMessage = "";

					for (const line of lines) {
						try {
							const entry = JSON.parse(line);

							// Extract session ID from first session entry
							if (entry.type === "session" && !sessionId) {
								sessionId = entry.id;
								created = new Date(entry.timestamp);
							}

							// Count messages
							if (entry.type === "message") {
								messageCount++;

								// Get first user message
								if (!firstMessage && entry.message.role === "user") {
									const textContent = entry.message.content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
										.join(" ");
									firstMessage = textContent || "";
								}
							}
						} catch {
							// Skip malformed lines
						}
					}

					sessions.push({
						path: file,
						id: sessionId || "unknown",
						created,
						modified: stats.mtime,
						messageCount,
						firstMessage: firstMessage || "(no messages)",
					});
				} catch (error) {
					// Skip files that can't be read
					console.error(`Failed to read session file ${file}:`, error);
				}
			}

			// Sort by modified date (most recent first)
			sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
		} catch (error) {
			console.error("Failed to load sessions:", error);
		}

		return sessions;
	}

	/**
	 * Set the session file to an existing session
	 */
	setSessionFile(path: string): void {
		this.sessionFile = path;
		this.loadSessionId();
	}
}
