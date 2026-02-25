#!/usr/bin/env node

/**
 * pi-ai-server: Local HTTP bridge for @mariozechner/pi-ai
 *
 * Endpoints:
 *   GET  /providers        List supported providers and their auth status
 *   POST /auth/token       Get (and auto-refresh) an OAuth API key
 *   POST /complete         Run completeSimple() and return AssistantMessage JSON
 *   POST /stream           Stream via streamSimple() as Server-Sent Events
 *
 * Supported providers:
 *   OAuth:   openai-codex, google-gemini-cli
 *   API key: openai, google, xai, minimax, kimi-coding
 */

import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { completeSimple, getOAuthProviders, streamSimple } from "@mariozechner/pi-ai";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getAndRefreshApiKey, getAuthFile, loadAuth } from "./auth.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3456", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

// OAuth providers we support (subset of all pi-ai OAuth providers)
const OAUTH_PROVIDER_IDS = new Set(["openai-codex", "google-gemini-cli"]);

// API-key providers we support
const APIKEY_PROVIDERS = ["openai", "google", "xai", "minimax", "minimax-cn", "kimi-coding"] as const;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function json(res: ServerResponse, status: number, data: unknown): void {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(body);
}

function err(res: ServerResponse, status: number, message: string): void {
	json(res, status, { error: message });
}

async function parseBody<T>(req: IncomingMessage, res: ServerResponse): Promise<T | null> {
	try {
		const raw = await readBody(req);
		return JSON.parse(raw) as T;
	} catch {
		err(res, 400, "Invalid JSON body");
		return null;
	}
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /providers
 * Returns all supported providers with their type and auth status.
 */
async function handleProviders(res: ServerResponse): Promise<void> {
	const authFile = getAuthFile();
	const auth = loadAuth(authFile);
	const oauthProviders = getOAuthProviders().filter((p) => OAUTH_PROVIDER_IDS.has(p.id));

	const result = [
		// OAuth providers: check if credentials exist in auth.json
		...oauthProviders.map((p) => ({
			id: p.id,
			name: p.name,
			authType: "oauth",
			authenticated: p.id in auth,
		})),
		// API key providers
		...APIKEY_PROVIDERS.map((id) => ({
			id,
			name: id,
			authType: "apiKey",
			authenticated: null, // Not tracked server-side
		})),
	];

	json(res, 200, result);
}

/**
 * POST /auth/token
 * Body: { "providerId": "google-gemini-cli" }
 * Returns: { "apiKey": "...", "providerId": "..." }
 */
async function handleAuthToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await parseBody<{ providerId?: string }>(req, res);
	if (!body) return;

	const { providerId } = body;
	if (!providerId) {
		err(res, 400, 'Missing required field: "providerId"');
		return;
	}
	if (!OAUTH_PROVIDER_IDS.has(providerId)) {
		err(
			res,
			400,
			`Provider "${providerId}" is not an OAuth provider. OAuth providers: ${[...OAUTH_PROVIDER_IDS].join(", ")}`,
		);
		return;
	}

	try {
		const apiKey = await getAndRefreshApiKey(providerId);
		if (!apiKey) {
			err(res, 401, `No credentials found for "${providerId}". Run: npx @mariozechner/pi-ai login ${providerId}`);
			return;
		}
		json(res, 200, { providerId, apiKey });
	} catch (e) {
		err(res, 500, e instanceof Error ? e.message : String(e));
	}
}

/**
 * POST /complete
 * Body: {
 *   model: Model,
 *   context: Context,
 *   options?: SimpleStreamOptions   // apiKey must be set for non-OAuth providers
 * }
 * Returns: AssistantMessage
 */
async function handleComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await parseBody<{
		model?: Model<string>;
		context?: Context;
		options?: SimpleStreamOptions;
	}>(req, res);
	if (!body) return;

	const { model, context, options } = body;
	if (!model) {
		err(res, 400, 'Missing required field: "model"');
		return;
	}
	if (!context) {
		err(res, 400, 'Missing required field: "context"');
		return;
	}

	try {
		const message = await completeSimple(model, context, options);
		json(res, 200, message);
	} catch (e) {
		err(res, 500, e instanceof Error ? e.message : String(e));
	}
}

/**
 * POST /stream
 * Same body as /complete. Response is text/event-stream (SSE).
 * Each event: `data: <AssistantMessageEvent JSON>\n\n`
 * Final event on done/error: `event: done\ndata: <JSON>\n\n`
 */
async function handleStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await parseBody<{
		model?: Model<string>;
		context?: Context;
		options?: SimpleStreamOptions;
	}>(req, res);
	if (!body) return;

	const { model, context, options } = body;
	if (!model) {
		err(res, 400, 'Missing required field: "model"');
		return;
	}
	if (!context) {
		err(res, 400, 'Missing required field: "context"');
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"Access-Control-Allow-Origin": "*",
	});

	const sendEvent = (eventType: string, data: unknown): void => {
		res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
	};

	try {
		const eventStream = streamSimple(model, context, options);

		for await (const event of eventStream) {
			const isDone = event.type === "done" || event.type === "error";
			sendEvent(isDone ? event.type : "message", event);
			if (isDone) break;
		}
	} catch (e) {
		sendEvent("error", { type: "error", error: e instanceof Error ? e.message : String(e) });
	} finally {
		res.end();
	}
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const method = req.method ?? "GET";
	const url = req.url ?? "/";
	const path = url.split("?")[0];

	// CORS preflight
	if (method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		});
		res.end();
		return;
	}

	if (method === "GET" && path === "/providers") return handleProviders(res);
	if (method === "POST" && path === "/auth/token") return handleAuthToken(req, res);
	if (method === "POST" && path === "/complete") return handleComplete(req, res);
	if (method === "POST" && path === "/stream") return handleStream(req, res);

	err(res, 404, `Unknown route: ${method} ${path}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
	router(req, res).catch((e) => {
		console.error("Unhandled error:", e);
		if (!res.headersSent) {
			err(res, 500, "Internal server error");
		}
	});
});

server.listen(PORT, HOST, () => {
	console.log(`pi-ai-server listening on http://${HOST}:${PORT}`);
	console.log(`Auth file: ${getAuthFile()}`);
	console.log();
	console.log("Endpoints:");
	console.log(`  GET  http://${HOST}:${PORT}/providers`);
	console.log(`  POST http://${HOST}:${PORT}/auth/token`);
	console.log(`  POST http://${HOST}:${PORT}/complete`);
	console.log(`  POST http://${HOST}:${PORT}/stream`);
});
