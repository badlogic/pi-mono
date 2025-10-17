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

		const configDir = resolve(process.env.CODING_AGENT_DIR || join(homedir(), ".coding-agent"));
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

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string {
		return this.sessionFile;
	}
}
