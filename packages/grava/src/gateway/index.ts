/**
 * Layer 2: Gateway — 入口整合
 *
 * Responsibilities:
 * - Authentication (Token, Device pair, Allowlist)
 * - Session routing (create/resume, agent dispatch, lane queue)
 * - File endpoint (upload, download, media)
 * - Event bus (SSE stream, heartbeat, state broadcast)
 *
 * The gateway does NOT perform inference — it only routes and queues.
 */

import type { AuthConfig, GatewayConfig, NormalizedMessage, Session, SessionRouterConfig } from "../types.js";

// ─── Auth ───

export interface AuthProvider {
	/** Validate an incoming request */
	validate(token: string, userId: string): Promise<AuthResult>;
}

export interface AuthResult {
	valid: boolean;
	userId?: string;
	reason?: string;
}

export function createAuthProvider(config: AuthConfig): AuthProvider {
	switch (config.mode) {
		case "token":
			return new TokenAuthProvider();
		case "device-pair":
			return new DevicePairAuthProvider();
		case "allowlist":
			return new AllowlistAuthProvider(config.allowedUsers ?? []);
	}
}

class TokenAuthProvider implements AuthProvider {
	async validate(token: string, _userId: string): Promise<AuthResult> {
		// TODO: Implement token validation
		return { valid: token.length > 0, userId: _userId };
	}
}

class DevicePairAuthProvider implements AuthProvider {
	async validate(token: string, userId: string): Promise<AuthResult> {
		// TODO: Implement device pair validation
		return { valid: token.length > 0, userId };
	}
}

class AllowlistAuthProvider implements AuthProvider {
	constructor(private allowedUsers: string[]) {}

	async validate(_token: string, userId: string): Promise<AuthResult> {
		return {
			valid: this.allowedUsers.includes(userId),
			userId,
			reason: this.allowedUsers.includes(userId) ? undefined : "User not in allowlist",
		};
	}
}

// ─── Session Router ───

export class SessionRouter {
	private sessions = new Map<string, Session>();

	constructor(private config: SessionRouterConfig) {}

	/** Get or create a session for a user */
	getOrCreate(userId: string, agentId?: string): Session {
		// Find existing active session
		for (const session of this.sessions.values()) {
			if (session.userId === userId && session.state === "active") {
				session.lastActiveAt = Date.now();
				return session;
			}
		}

		// Create new session
		const session: Session = {
			id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			userId,
			agentId: agentId ?? this.config.defaultAgent ?? "default",
			createdAt: Date.now(),
			lastActiveAt: Date.now(),
			state: "active",
		};
		this.sessions.set(session.id, session);
		return session;
	}

	/** Resume a specific session */
	resume(sessionId: string): Session | undefined {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.state = "active";
			session.lastActiveAt = Date.now();
		}
		return session;
	}

	/** Suspend a session */
	suspend(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.state = "suspended";
		}
	}

	/** Archive a session */
	archive(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.state = "archived";
		}
	}
}

// ─── Event Bus ───

export type GatewayEventType = "session_created" | "session_resumed" | "message_routed" | "file_uploaded" | "heartbeat";

export interface GatewayEvent {
	type: GatewayEventType;
	sessionId: string;
	data: unknown;
	timestamp: number;
}

export class EventBus {
	private listeners = new Map<string, Set<(event: GatewayEvent) => void>>();

	on(type: GatewayEventType | "*", handler: (event: GatewayEvent) => void): () => void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)!.add(handler);
		return () => this.listeners.get(type)?.delete(handler);
	}

	emit(event: GatewayEvent): void {
		this.listeners.get(event.type)?.forEach((h) => h(event));
		this.listeners.get("*")?.forEach((h) => h(event));
	}
}

// ─── Gateway ───

export class Gateway {
	readonly auth: AuthProvider;
	readonly router: SessionRouter;
	readonly eventBus: EventBus;

	constructor(config: GatewayConfig) {
		this.auth = createAuthProvider(config.auth);
		this.router = new SessionRouter(config.sessionRouter);
		this.eventBus = new EventBus();
	}

	/** Process an incoming normalized message through the gateway */
	async process(
		message: NormalizedMessage,
		token: string,
	): Promise<{ session: Session; message: NormalizedMessage } | { error: string }> {
		const authResult = await this.auth.validate(token, message.userId);
		if (!authResult.valid) {
			return { error: authResult.reason ?? "Authentication failed" };
		}

		const session = this.router.getOrCreate(message.userId);

		this.eventBus.emit({
			type: "message_routed",
			sessionId: session.id,
			data: { messageId: message.id },
			timestamp: Date.now(),
		});

		return { session, message };
	}
}
