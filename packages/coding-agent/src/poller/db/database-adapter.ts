import type { IncomingMessage } from "../types.js";

export interface DatabaseAdapter {
	init(): Promise<void>;
	fetchQueued(agentId: string, limit: number): Promise<IncomingMessage[]>;
	claimMessage(id: string, agentId: string, leaseUntilMs: number): Promise<void>;
	updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void>;
	listInbox(agentId: string, limit: number): Promise<IncomingMessage[]>;
}
