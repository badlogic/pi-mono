export type MessageStatus = "queued" | "in_progress" | "acked" | "done" | "failed";

export interface IncomingMessage {
	id: string;
	to_agent: string;
	from_agent: string;
	type: string;
	payload_ref?: string;
	payload?: unknown;
	status: MessageStatus;
	correlation_id?: string;
	created_at?: string | number;
	claimed_by?: string | null;
	lease_until?: number | null;
}

export interface BackoffSettings {
	initialMs?: number;
	factor?: number;
	maxMs?: number;
	failureThreshold?: number;
}

export interface PollerOptions {
	lruDedupSize?: number;
	autoProcessNext?: boolean;
}

export interface PollerSettings {
	enabled?: boolean;
	pollIntervalMs?: number;
	agentId?: string;
	batchLimit?: number;
	leaseMs?: number;
	backoff?: BackoffSettings;
	options?: PollerOptions;
	backend?: "arangojs" | "http";
	arango?: ArangoBackendConfig;
	http?: HttpBackendConfig;
}

export interface ArangoBackendConfig {
	url: string;
	database: string;
	username?: string;
	password?: string;
	messagesCollection: string;
	batchLimit?: number;
}

export interface HttpBackendConfig {
	baseUrl: string;
	headers?: Record<string, string>;
	batchLimit?: number;
}

export interface PollerUiBridge {
	listInbox(limit?: number): Promise<IncomingMessage[]>;
	setEnabled(enabled: boolean): void;
	setIntervalMs(ms: number): void;
	updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void>;
	getInboxCount(): number;
	isEnabled(): boolean;
}
