import type { HttpBackendConfig, IncomingMessage, Logger } from "../types.js";
import type { DatabaseAdapter } from "./database-adapter.js";

const DEFAULT_BATCH_LIMIT = 25;

function validateHttpConfig(cfg: HttpBackendConfig): void {
	if (!cfg.baseUrl) {
		throw new Error("[poller] Http config missing: baseUrl");
	}
}

export class HttpAdapter implements DatabaseAdapter {
	private readonly cfg: HttpBackendConfig;
	private readonly logger: Logger;

	constructor(cfg: HttpBackendConfig, logger: Logger) {
		validateHttpConfig(cfg);
		this.cfg = cfg;
		this.logger = logger;
	}

	async init(): Promise<void> {
		const url = `${this.cfg.baseUrl}/health`;
		const controller = new AbortController();
		const timeout = this.cfg.timeoutMs ?? 5000;
		const timer = setTimeout(() => controller.abort(), timeout);
		try {
			const res = await fetch(url, {
				method: "GET",
				headers: this.cfg.headers ?? {},
				signal: controller.signal,
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
			}
			const contentType = res.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				await res.json();
			} else {
				await res.text();
			}
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				throw new Error(`[poller] HTTP request timeout after ${timeout}ms: ${url}`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
		this.logger.info("[poller] HTTP adapter ready");
	}

	async fetchQueued(agentId: string, limit: number): Promise<IncomingMessage[]> {
		const max = this.cfg.batchLimit ?? limit ?? DEFAULT_BATCH_LIMIT;
		return this.request<IncomingMessage[]>(`/messages/queued?agentId=${encodeURIComponent(agentId)}&limit=${max}`);
	}

	async claimMessage(id: string, agentId: string, leaseUntilMs: number): Promise<void> {
		await this.request(`/messages/${encodeURIComponent(id)}/claim`, "POST", { agentId, leaseUntilMs });
	}

	async updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void> {
		await this.request(`/messages/${encodeURIComponent(id)}/status`, "POST", { status });
	}

	async listInbox(agentId: string, limit: number): Promise<IncomingMessage[]> {
		return this.request<IncomingMessage[]>(
			`/messages/inbox?agentId=${encodeURIComponent(agentId)}&limit=${limit ?? DEFAULT_BATCH_LIMIT}`,
		);
	}

	private async request<T = unknown>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
		const url = `${this.cfg.baseUrl}${path}`;
		const controller = new AbortController();
		const timeout = this.cfg.timeoutMs ?? 5000;
		const timer = setTimeout(() => controller.abort(), timeout);
		try {
			const res = await fetch(url, {
				method,
				headers: {
					...(this.cfg.headers ?? {}),
					...(method === "POST" ? { "Content-Type": "application/json" } : {}),
				},
				body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
				signal: controller.signal,
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
			}
			return (await res.json()) as T;
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				throw new Error(`[poller] HTTP request timeout after ${timeout}ms: ${url}`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}
