import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import type { HttpBackendConfig, IncomingMessage } from "../types.js";
import type { DatabaseAdapter } from "./database-adapter.js";

const DEFAULT_BATCH_LIMIT = 25;

interface HttpInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
}

interface JsonResponse<T> {
	status: number;
	headers: IncomingHttpHeaders;
	body: T;
}

function sendRequest<T>(rawUrl: string, init: HttpInit = {}): Promise<JsonResponse<T>> {
	return new Promise((resolve, reject) => {
		const url = new URL(rawUrl);
		const isHttps = url.protocol === "https:";
		const client = isHttps ? httpsRequest : httpRequest;

		const req = client(
			{
				method: init.method ?? "GET",
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				headers: init.headers,
				timeout: init.timeoutMs ?? 10000,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				res.on("end", () => {
					const bodyBuffer = Buffer.concat(chunks);
					const text = bodyBuffer.toString("utf-8");
					let parsed: unknown;
					try {
						parsed = text.length > 0 ? JSON.parse(text) : null;
					} catch (error) {
						reject(error);
						return;
					}
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed as T });
				});
			},
		);

		req.on("error", reject);
		req.on("timeout", () => {
			req.destroy(new Error("Request timed out"));
		});

		if (init.body) {
			req.write(init.body);
		}

		req.end();
	});
}

export class HttpAdapter implements DatabaseAdapter {
	private readonly cfg: HttpBackendConfig;

	constructor(cfg: HttpBackendConfig) {
		this.cfg = cfg;
	}

	async init(): Promise<void> {
		await this.ping();
	}

	async fetchQueued(agentId: string, limit: number): Promise<IncomingMessage[]> {
		const max = this.cfg.batchLimit ?? limit ?? DEFAULT_BATCH_LIMIT;
		const url = `${this.cfg.baseUrl}/messages/queued?agentId=${encodeURIComponent(agentId)}&limit=${max}`;
		const res = await sendRequest<IncomingMessage[]>(url, { headers: this.cfg.headers });
		this.ensureOk(res);
		return res.body;
	}

	async claimMessage(id: string, agentId: string, leaseUntilMs: number): Promise<void> {
		const url = `${this.cfg.baseUrl}/messages/${encodeURIComponent(id)}/claim`;
		const res = await sendRequest<unknown>(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.cfg.headers ?? {}),
			},
			body: JSON.stringify({ agentId, leaseUntilMs }),
		});
		this.ensureOk(res);
	}

	async updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void> {
		const url = `${this.cfg.baseUrl}/messages/${encodeURIComponent(id)}/status`;
		const res = await sendRequest<unknown>(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(this.cfg.headers ?? {}),
			},
			body: JSON.stringify({ status }),
		});
		this.ensureOk(res);
	}

	async listInbox(agentId: string, limit: number): Promise<IncomingMessage[]> {
		const max = limit ?? DEFAULT_BATCH_LIMIT;
		const url = `${this.cfg.baseUrl}/messages/inbox?agentId=${encodeURIComponent(agentId)}&limit=${max}`;
		const res = await sendRequest<IncomingMessage[]>(url, { headers: this.cfg.headers });
		this.ensureOk(res);
		return res.body;
	}

	private async ping(): Promise<void> {
		const res = await sendRequest<unknown>(`${this.cfg.baseUrl}/health`, { headers: this.cfg.headers });
		this.ensureOk(res);
	}

	private ensureOk<T>(res: JsonResponse<T>): void {
		if (res.status >= 200 && res.status < 300) {
			return;
		}
		throw new Error(`HTTP ${res.status}`);
	}
}
