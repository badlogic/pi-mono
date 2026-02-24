import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authError, ServiceError, toServiceError } from "./errors.js";
import { getOptionalBoolean, getOptionalString, getString, parseJsonObject } from "./json.js";
import type { AgentRuntimeRegistry } from "./registry.js";
import type {
	CreateSessionRequest,
	JsonObject,
	RuntimeSessionView,
	ServiceConfig,
	ServiceErrorShape,
	SetThinkingLevelRequest,
} from "./types.js";

interface RequestContext {
	request: IncomingMessage;
	response: ServerResponse;
	path: string[];
	query: URLSearchParams;
}

export interface AgentServiceHttpServer {
	server: Server;
	listen(port: number, host?: string): Promise<void>;
	close(): Promise<void>;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function parsePath(request: IncomingMessage): { path: string[]; query: URLSearchParams } {
	const origin = `http://${request.headers.host ?? "localhost"}`;
	const parsed = new URL(request.url ?? "/", origin);
	return {
		path: parsed.pathname.split("/").filter((part) => part.length > 0),
		query: parsed.searchParams,
	};
}

function getHeaderApiKey(request: IncomingMessage): string {
	const header = request.headers["x-api-key"];
	if (typeof header === "string") return header;
	if (Array.isArray(header) && header.length > 0) return header[0];
	return "";
}

function writeJson(response: ServerResponse, status: number, payload: object): void {
	response.statusCode = status;
	response.setHeader("content-type", "application/json; charset=utf-8");
	response.end(JSON.stringify(payload));
}

function writeError(response: ServerResponse, error: ServiceError): void {
	const payload: ServiceErrorShape = error.toResponse();
	writeJson(response, error.status, payload);
}

async function readBody(request: IncomingMessage): Promise<JsonObject> {
	const chunks: string[] = [];
	for await (const chunk of request) {
		chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
	}
	return parseJsonObject(chunks.join(""));
}

function asRuntimeView(
	runtimeId: string,
	state: ReturnType<ReturnType<typeof AgentRuntimeRegistry.prototype.getSession>["getState"]>,
): RuntimeSessionView {
	return {
		id: runtimeId,
		state,
	};
}

function requireThinkingLevel(payload: JsonObject): SetThinkingLevelRequest {
	const value = getString(payload.level, "level");
	if (!THINKING_LEVELS.has(value)) {
		throw new ServiceError("MODEL_ERROR", `Invalid thinking level: ${value}`, 400, false);
	}
	return { level: value as SetThinkingLevelRequest["level"] };
}

function mapCreateSessionRequest(payload: JsonObject): CreateSessionRequest {
	return {
		cwd: getOptionalString(payload.cwd),
		agentDir: getOptionalString(payload.agentDir),
		sessionDir: getOptionalString(payload.sessionDir),
		sessionPath: getOptionalString(payload.sessionPath),
		continueRecent: getOptionalBoolean(payload.continueRecent),
		provider: getOptionalString(payload.provider),
		modelId: getOptionalString(payload.modelId),
		thinkingLevel: getOptionalString(payload.thinkingLevel) as CreateSessionRequest["thinkingLevel"],
	};
}

function setSseHeaders(response: ServerResponse): void {
	response.statusCode = 200;
	response.setHeader("content-type", "text/event-stream");
	response.setHeader("cache-control", "no-cache");
	response.setHeader("connection", "keep-alive");
	response.setHeader("x-accel-buffering", "no");
}

function writeSseEvent(response: ServerResponse, eventName: string, id: string, payload: object): void {
	response.write(`id: ${id}\n`);
	response.write(`event: ${eventName}\n`);
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createAgentServiceHttpServer(
	registry: AgentRuntimeRegistry,
	config: ServiceConfig,
): AgentServiceHttpServer {
	const heartbeatMs = config.heartbeatMs ?? 10000;

	const server = createServer(async (request, response) => {
		try {
			if (getHeaderApiKey(request) !== config.apiKey) {
				throw authError();
			}

			const { path, query } = parsePath(request);
			const context: RequestContext = { request, response, path, query };
			await routeRequest(context, registry);
		} catch (error) {
			if (response.headersSent) {
				response.end();
				return;
			}
			const mapped =
				error instanceof ServiceError
					? error
					: toServiceError(error instanceof Error ? error : "INTERNAL_ERROR: unhandled failure");
			writeError(response, mapped);
		}
	});

	return {
		server,
		listen(port: number, host = "127.0.0.1"): Promise<void> {
			return new Promise((resolve, reject) => {
				server.listen(port, host, () => resolve());
				server.once("error", reject);
			});
		},
		close(): Promise<void> {
			return new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};

	async function routeRequest(context: RequestContext, runtimeRegistry: AgentRuntimeRegistry): Promise<void> {
		const { request, response, path } = context;
		if (path[0] !== "v1") {
			throw new ServiceError("INTERNAL_ERROR", "Not found", 404, false);
		}

		if (request.method === "POST" && path.length === 2 && path[1] === "sessions") {
			const payload = await readBody(request);
			const runtime = await runtimeRegistry.createSession(mapCreateSessionRequest(payload));
			writeJson(response, 201, asRuntimeView(runtime.id, runtime.getState()));
			return;
		}

		if (path.length < 3 || path[1] !== "sessions") {
			throw new ServiceError("INTERNAL_ERROR", "Not found", 404, false);
		}

		const runtime = runtimeRegistry.getSession(path[2]);

		if (request.method === "GET" && path.length === 3) {
			writeJson(response, 200, asRuntimeView(path[2], runtime.getState()));
			return;
		}

		if (request.method === "GET" && path.length === 4 && path[3] === "messages") {
			writeJson(response, 200, { sessionId: path[2], messages: runtime.getMessages() });
			return;
		}

		if (request.method === "GET" && path.length === 5 && path[3] === "events" && path[4] === "stream") {
			setSseHeaders(response);
			response.write(`: connected\n\n`);
			const unsubscribe = runtime.subscribe((event) => {
				writeSseEvent(response, "session_event", String(event.seq), event);
			});
			const heartbeat = setInterval(() => {
				writeSseEvent(response, "heartbeat", String(Date.now()), { ts: new Date().toISOString() });
			}, heartbeatMs);
			request.on("close", () => {
				clearInterval(heartbeat);
				unsubscribe();
				if (!response.writableEnded) {
					response.end();
				}
			});
			return;
		}

		if (request.method !== "POST") {
			throw new ServiceError("INTERNAL_ERROR", "Not found", 404, false);
		}

		const payload = await readBody(request);

		switch (path.slice(3).join("/")) {
			case "prompt": {
				const text = getString(payload.text, "text");
				const streamingBehavior = getOptionalString(payload.streamingBehavior);
				const promptResult = runtime.prompt(text, {
					streamingBehavior: streamingBehavior as "steer" | "followUp" | undefined,
				});
				writeJson(response, 202, promptResult);
				return;
			}
			case "steer": {
				const text = getString(payload.text, "text");
				await runtime.steer(text);
				writeJson(response, 200, { ok: true });
				return;
			}
			case "follow-up": {
				const text = getString(payload.text, "text");
				await runtime.followUp(text);
				writeJson(response, 200, { ok: true });
				return;
			}
			case "abort": {
				await runtime.abort();
				writeJson(response, 200, { ok: true });
				return;
			}
			case "model": {
				const provider = getString(payload.provider, "provider");
				const modelId = getString(payload.modelId, "modelId");
				await runtime.setModel(provider, modelId);
				writeJson(response, 200, { ok: true });
				return;
			}
			case "thinking-level": {
				const requestPayload = requireThinkingLevel(payload);
				runtime.setThinkingLevel(requestPayload.level);
				writeJson(response, 200, { ok: true });
				return;
			}
			case "fork": {
				const entryId = getString(payload.entryId, "entryId");
				const result = await runtime.fork(entryId);
				writeJson(response, 200, result);
				return;
			}
			case "tree/navigate": {
				const targetId = getString(payload.targetId, "targetId");
				const result = await runtime.navigateTree({
					targetId,
					summarize: getOptionalBoolean(payload.summarize),
					customInstructions: getOptionalString(payload.customInstructions),
					replaceInstructions: getOptionalBoolean(payload.replaceInstructions),
					label: getOptionalString(payload.label),
				});
				writeJson(response, 200, result);
				return;
			}
			case "switch": {
				const sessionPath = getString(payload.sessionPath, "sessionPath");
				const result = await runtime.switchSession(sessionPath);
				writeJson(response, 200, result);
				return;
			}
			default: {
				throw new ServiceError("INTERNAL_ERROR", "Not found", 404, false);
			}
		}
	}
}
