import type { EventBus } from "@fugue/events";
import type { FugueEvent } from "@fugue/shared";
import { newId } from "@fugue/shared";

// ─── ConnectorSource ──────────────────────────────────────────────────────────

/**
 * A connector source transforms raw external payloads into FugueEvents.
 * Each connector (GitHub, Notion, etc.) implements this interface.
 */
export interface ConnectorSource {
	readonly name: string;
	/** Transform an incoming external payload to zero or more FugueEvents. */
	transform(payload: unknown): FugueEvent[];
}

// ─── EventBridge ─────────────────────────────────────────────────────────────

/**
 * Central bridge that receives raw payloads from external sources,
 * routes them to the appropriate ConnectorSource, and publishes
 * the resulting FugueEvents to the EventBus.
 *
 * Usage:
 *   const bridge = new EventBridge(bus);
 *   bridge.register(new GitHubConnector());
 *   bridge.ingest("github", webhookPayload); // → FugueEvents on bus
 */
export class EventBridge {
	private readonly sources = new Map<string, ConnectorSource>();

	constructor(private readonly bus: EventBus) {}

	register(source: ConnectorSource): void {
		this.sources.set(source.name, source);
	}

	/**
	 * Ingest a raw external payload through the named connector.
	 * Returns the number of events published.
	 * Throws if no connector is registered for the given name.
	 */
	ingest(sourceName: string, payload: unknown): number {
		const source = this.sources.get(sourceName);
		if (!source) throw new Error(`No connector registered for source: ${sourceName}`);

		const events = source.transform(payload);
		for (const event of events) this.bus.publish(event);
		return events.length;
	}

	/** Registered connector names. */
	get connectorNames(): string[] {
		return Array.from(this.sources.keys());
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeEvent(
	source: string,
	type: string,
	payload: Record<string, unknown>,
	opts: { graphNodeId?: string; correlationId?: string } = {},
): FugueEvent {
	return {
		id: newId(),
		source,
		type,
		payload,
		timestamp: new Date().toISOString(),
		...opts,
	};
}
