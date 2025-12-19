/**
 * ACP Session Manager - Tracks ACP sessions and their corresponding AgentSessions.
 */

import type { AgentSession } from "../../core/agent-session.js";

export interface AcpSessionState {
	id: string;
	cwd: string;
	createdAt: Date;
	agentSession: AgentSession;
}

/**
 * Manages mapping between ACP session IDs and AgentSession instances.
 */
export class AcpSessionManager {
	private sessions = new Map<string, AcpSessionState>();

	/**
	 * Create a new ACP session.
	 */
	create(sessionId: string, cwd: string, agentSession: AgentSession): AcpSessionState {
		const state: AcpSessionState = {
			id: sessionId,
			cwd,
			createdAt: new Date(),
			agentSession,
		};
		this.sessions.set(sessionId, state);
		return state;
	}

	/**
	 * Get an existing session by ID.
	 * @throws Error if session not found
	 */
	get(sessionId: string): AcpSessionState {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return session;
	}

	/**
	 * Check if a session exists.
	 */
	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	/**
	 * Remove a session.
	 */
	remove(sessionId: string): boolean {
		return this.sessions.delete(sessionId);
	}

	/**
	 * Get all session IDs.
	 */
	getAllIds(): string[] {
		return Array.from(this.sessions.keys());
	}
}
