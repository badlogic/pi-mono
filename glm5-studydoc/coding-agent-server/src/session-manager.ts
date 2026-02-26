import { AgentService, type AgentConfig } from "./agent-service.js";

export interface SessionInfo {
	id: string;
	agentService: AgentService;
	createdAt: Date;
	lastAccessedAt: Date;
	requestCount: number;
}

export interface SessionManagerOptions {
	/** Maximum number of concurrent sessions */
	maxSessions?: number;
	/** Session idle timeout in milliseconds (default: 30 minutes) */
	idleTimeoutMs?: number;
	/** Session maximum lifetime in milliseconds (default: 2 hours) */
	maxLifetimeMs?: number;
}

/**
 * Manages multiple agent sessions with LRU eviction and lifecycle management
 */
export class AgentSessionManager {
	private sessions = new Map<string, SessionInfo>();
	private readonly maxSessions: number;
	private readonly idleTimeoutMs: number;
	private readonly maxLifetimeMs: number;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(options: SessionManagerOptions = {}) {
		this.maxSessions = options.maxSessions ?? 10;
		this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
		this.maxLifetimeMs = options.maxLifetimeMs ?? 2 * 60 * 60 * 1000; // 2 hours

		// Start cleanup interval
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, 60 * 1000); // Run every minute
	}

	/**
	 * Get or create a session
	 */
	async getSession(sessionId: string, config: AgentConfig): Promise<AgentService> {
		const existing = this.sessions.get(sessionId);

		if (existing) {
			// Update access time
			existing.lastAccessedAt = new Date();
			existing.requestCount++;
			return existing.agentService;
		}

		// Check if we need to evict
		if (this.sessions.size >= this.maxSessions) {
			this.evictLRU();
		}

		// Create new session
		const agentService = new AgentService(config);
		await agentService.initialize();

		const sessionInfo: SessionInfo = {
			id: sessionId,
			agentService,
			createdAt: new Date(),
			lastAccessedAt: new Date(),
			requestCount: 1,
		};

		this.sessions.set(sessionId, sessionInfo);
		console.log(`[SessionManager] Created session ${sessionId}, total: ${this.sessions.size}`);

		return agentService;
	}

	/**
	 * Get session info without creating
	 */
	getSessionInfo(sessionId: string): SessionInfo | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * List all active sessions
	 */
	listSessions(): Array<{
		id: string;
		createdAt: Date;
		lastAccessedAt: Date;
		requestCount: number;
		ageMs: number;
		idleMs: number;
	}> {
		const now = Date.now();
		return Array.from(this.sessions.values()).map((s) => ({
			id: s.id,
			createdAt: s.createdAt,
			lastAccessedAt: s.lastAccessedAt,
			requestCount: s.requestCount,
			ageMs: now - s.createdAt.getTime(),
			idleMs: now - s.lastAccessedAt.getTime(),
		}));
	}

	/**
	 * Destroy a specific session
	 */
	async destroySession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		await session.agentService.dispose();
		this.sessions.delete(sessionId);
		console.log(`[SessionManager] Destroyed session ${sessionId}, remaining: ${this.sessions.size}`);
		return true;
	}

	/**
	 * Destroy all sessions
	 */
	async destroyAllSessions(): Promise<void> {
		const promises = Array.from(this.sessions.values()).map((s) =>
			s.agentService.dispose().catch((err) => {
				console.error(`[SessionManager] Error disposing session ${s.id}:`, err);
			}),
		);
		await Promise.all(promises);
		this.sessions.clear();
		console.log("[SessionManager] All sessions destroyed");
	}

	/**
	 * Get session statistics
	 */
	getStats(): {
		totalSessions: number;
		maxSessions: number;
		oldestSessionAgeMs: number;
		longestIdleMs: number;
	} {
		const now = Date.now();
		let oldestAge = 0;
		let longestIdle = 0;

		for (const s of this.sessions.values()) {
			const age = now - s.createdAt.getTime();
			const idle = now - s.lastAccessedAt.getTime();
			oldestAge = Math.max(oldestAge, age);
			longestIdle = Math.max(longestIdle, idle);
		}

		return {
			totalSessions: this.sessions.size,
			maxSessions: this.maxSessions,
			oldestSessionAgeMs: oldestAge,
			longestIdleMs: longestIdle,
		};
	}

	/**
	 * Clean up expired sessions
	 */
	private cleanup(): void {
		const now = Date.now();
		const toDelete: string[] = [];

		for (const [id, session] of this.sessions) {
			const age = now - session.createdAt.getTime();
			const idle = now - session.lastAccessedAt.getTime();

			if (age > this.maxLifetimeMs || idle > this.idleTimeoutMs) {
				toDelete.push(id);
			}
		}

		for (const id of toDelete) {
			const session = this.sessions.get(id);
			if (session) {
				session.agentService.dispose().catch((err) => {
					console.error(`[SessionManager] Error disposing session ${id}:`, err);
				});
				this.sessions.delete(id);
			}
		}

		if (toDelete.length > 0) {
			console.log(`[SessionManager] Cleaned up ${toDelete.length} expired sessions, remaining: ${this.sessions.size}`);
		}
	}

	/**
	 * Evict least recently used session
	 */
	private evictLRU(): void {
		let lruId: string | null = null;
		let lruTime = Infinity;

		for (const [id, session] of this.sessions) {
			if (session.lastAccessedAt.getTime() < lruTime) {
				lruTime = session.lastAccessedAt.getTime();
				lruId = id;
			}
		}

		if (lruId) {
			const session = this.sessions.get(lruId);
			if (session) {
				session.agentService.dispose().catch((err) => {
					console.error(`[SessionManager] Error evicting session ${lruId}:`, err);
				});
				this.sessions.delete(lruId);
				console.log(`[SessionManager] Evicted LRU session ${lruId}`);
			}
		}
	}

	/**
	 * Dispose the manager and clean up all sessions
	 */
	async dispose(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		await this.destroyAllSessions();
	}
}
