/**
 * Layer 1: Client — 外部接入层
 *
 * Responsibilities:
 * - Channel adapter architecture (iOS, macOS, WeChat, Telegram, etc.)
 * - Message normalization from any channel to unified format
 * - Session history browsing and search
 * - Audit report visualization
 * - Cognitive evolution timeline
 */

import type { Attachment, ChannelType, ClientMessage, NormalizedMessage } from "../types.js";

// ─── Channel Adapter Interface ───

export interface ChannelAdapter {
	/** Channel identifier */
	readonly channel: ChannelType;
	/** Initialize the adapter */
	initialize(): Promise<void>;
	/** Start listening for messages */
	listen(handler: (message: ClientMessage) => Promise<void>): Promise<void>;
	/** Send a response back to the channel */
	send(userId: string, content: string, attachments?: Attachment[]): Promise<void>;
	/** Shutdown the adapter */
	shutdown(): Promise<void>;
}

// ─── Message Normalizer ───

/**
 * Normalizes messages from any channel into a unified format.
 * Each channel adapter produces ClientMessage; the normalizer
 * converts it to NormalizedMessage for downstream processing.
 */
export function normalizeMessage(message: ClientMessage): NormalizedMessage {
	return {
		id: message.id,
		userId: message.userId,
		content: message.content.trim(),
		attachments: message.attachments ?? [],
		sourceChannel: message.channel,
		timestamp: message.timestamp,
		metadata: message.metadata ?? {},
	};
}

// ─── Channel Registry ───

export class ChannelRegistry {
	private adapters = new Map<ChannelType, ChannelAdapter>();

	register(adapter: ChannelAdapter): void {
		this.adapters.set(adapter.channel, adapter);
	}

	get(channel: ChannelType): ChannelAdapter | undefined {
		return this.adapters.get(channel);
	}

	all(): ChannelAdapter[] {
		return Array.from(this.adapters.values());
	}

	async initializeAll(): Promise<void> {
		await Promise.all(this.all().map((a) => a.initialize()));
	}

	async shutdownAll(): Promise<void> {
		await Promise.all(this.all().map((a) => a.shutdown()));
	}
}

// ─── Session Viewer (for client-side session browsability) ───

export interface SessionViewerQuery {
	userId?: string;
	search?: string;
	fromTimestamp?: number;
	toTimestamp?: number;
	limit?: number;
	offset?: number;
}

export interface SessionViewerEntry {
	sessionId: string;
	summary: string;
	timestamp: number;
	auditMode: string;
	cognitiveModulesUsed: string[];
	decisionTrail: string[];
}
