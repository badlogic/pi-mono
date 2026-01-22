/**
 * HTTP mode tests.
 *
 * Tests HTTP server functionality:
 * - Server lifecycle (start/stop)
 * - Health endpoint
 * - RPC endpoint
 * - SSE events endpoint
 * - Error handling
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { VERSION } from "../src/config.js";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";
import type { PendingExtensionRequests } from "../src/modes/http/http-mode.js";
import { createHttpServer, type HttpServerHandle, startHttpServer } from "../src/modes/http/http-server.js";

// ============================================================================
// Test Helpers
// ============================================================================

type TestContext = {
	session: AgentSession;
	tempDir: string;
	serverHandle: HttpServerHandle;
	sseConnections: Set<http.ServerResponse>;
	pendingExtensionRequests: PendingExtensionRequests;
	port: number;
	baseUrl: string;
};

function createTestSession(tempDir: string): AgentSession {
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: "You are a test assistant.",
			tools: codingTools,
		},
	});

	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authStorage = new AuthStorage(join(tempDir, "auth.json"));
	const modelRegistry = new ModelRegistry(authStorage, tempDir);

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		modelRegistry,
	});

	// Must subscribe to enable session
	session.subscribe(() => {});

	return session;
}

async function httpRequest(
	url: string,
	options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const parsedUrl = new URL(url);
		const req = http.request(
			{
				hostname: parsedUrl.hostname,
				port: parsedUrl.port,
				path: parsedUrl.pathname + parsedUrl.search,
				method: options.method ?? "GET",
				headers: {
					"Content-Type": "application/json",
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			},
		);

		req.on("error", reject);

		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

// ============================================================================
// Tests
// ============================================================================

describe("HTTP server", () => {
	let ctx: TestContext;

	beforeEach(async () => {
		const tempDir = join(tmpdir(), `pi-http-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const session = createTestSession(tempDir);
		const sseConnections = new Set<http.ServerResponse>();
		const pendingExtensionRequests: PendingExtensionRequests = new Map();
		const port = 19000 + Math.floor(Math.random() * 1000);

		const serverHandle = createHttpServer({
			port,
			bind: "127.0.0.1",
			session,
			onShutdown: () => {},
			sseConnections,
			pendingExtensionRequests,
		});

		await startHttpServer(serverHandle, port, "127.0.0.1");

		ctx = {
			session,
			tempDir,
			serverHandle,
			sseConnections,
			pendingExtensionRequests,
			port,
			baseUrl: `http://127.0.0.1:${port}`,
		};
	});

	afterEach(async () => {
		await ctx.serverHandle.close();
		ctx.session.dispose();
		if (ctx.tempDir && existsSync(ctx.tempDir)) {
			rmSync(ctx.tempDir, { recursive: true });
		}
	});

	// --------------------------------------------------------------------------
	// Server lifecycle tests
	// --------------------------------------------------------------------------

	describe("server lifecycle", () => {
		test("server starts and responds to requests", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/health`);
			expect(res.status).toBe(200);
		});

		test("server stops gracefully", async () => {
			// Server should be responding
			const res1 = await httpRequest(`${ctx.baseUrl}/health`);
			expect(res1.status).toBe(200);

			// Close the server
			await ctx.serverHandle.close();

			// Server should no longer respond (connection refused)
			await expect(httpRequest(`${ctx.baseUrl}/health`)).rejects.toThrow();
		});
	});

	// --------------------------------------------------------------------------
	// Health endpoint tests
	// --------------------------------------------------------------------------

	describe("GET /health", () => {
		test("returns 200 with correct JSON structure", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/health`);

			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toBe("application/json");

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data).toBeDefined();
			expect(data.status).toBe("ok");
			expect(data.version).toBe(VERSION);
			expect(data.sessionId).toBeDefined();
			expect(typeof data.isStreaming).toBe("boolean");
			expect(typeof data.ready).toBe("boolean");
		});

		test("readiness probe returns 200 when ready", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/health?ready=true`);
			expect(res.status).toBe(200);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.ready).toBe(true);
		});
	});

	// --------------------------------------------------------------------------
	// RPC endpoint tests
	// --------------------------------------------------------------------------

	describe("POST /rpc", () => {
		test("get_state command works", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
				body: JSON.stringify({ type: "get_state" }),
			});

			expect(res.status).toBe(200);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.type).toBe("response");
			expect(data.command).toBe("get_state");
			expect(data.success).toBe(true);
			expect(data.data).toBeDefined();

			const state = data.data as Record<string, unknown>;
			expect(state.sessionId).toBeDefined();
			expect(typeof state.isStreaming).toBe("boolean");
			expect(typeof state.messageCount).toBe("number");
		});

		test("returns 400 for missing body", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toBe("Request body required");
		});

		test("returns 400 for invalid JSON", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
				body: "not valid json {",
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toBe("Invalid JSON");
		});

		test("returns 400 for missing type field", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
				body: JSON.stringify({ message: "hello" }),
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toBe("Invalid command: missing type field");
		});

		test("returns command id in response", async () => {
			const commandId = "test-cmd-123";
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
				body: JSON.stringify({ type: "get_state", id: commandId }),
			});

			expect(res.status).toBe(200);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.id).toBe(commandId);
		});

		test("returns 400 for unknown command", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/rpc`, {
				method: "POST",
				body: JSON.stringify({ type: "unknown_command_xyz" }),
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.success).toBe(false);
			expect(data.error).toBeDefined();
		});
	});

	// --------------------------------------------------------------------------
	// SSE endpoint tests
	// --------------------------------------------------------------------------

	describe("GET /events", () => {
		test("returns correct SSE headers", async () => {
			// Use raw http request to check headers without waiting for body
			const res = await new Promise<{
				status: number;
				headers: http.IncomingHttpHeaders;
			}>((resolve, reject) => {
				const req = http.get(`${ctx.baseUrl}/events`, (res) => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
					});
					// Immediately destroy to avoid hanging
					res.destroy();
				});
				req.on("error", reject);
			});

			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toBe("text/event-stream");
			expect(res.headers["cache-control"]).toBe("no-cache");
			expect(res.headers.connection).toBe("keep-alive");
		});

		test("tracks SSE connections", async () => {
			expect(ctx.sseConnections.size).toBe(0);

			// Open an SSE connection
			const req = http.get(`${ctx.baseUrl}/events`);

			await new Promise<void>((resolve) => {
				req.on("response", (res) => {
					// Connection should be tracked
					expect(ctx.sseConnections.size).toBe(1);

					// Close the connection
					res.destroy();
					resolve();
				});
			});

			// Give time for cleanup
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Connection should be removed
			expect(ctx.sseConnections.size).toBe(0);
		});
	});

	// --------------------------------------------------------------------------
	// Shutdown endpoint tests
	// --------------------------------------------------------------------------

	describe("POST /shutdown", () => {
		test("returns 204 and triggers shutdown", async () => {
			let shutdownCalled = false;

			// Create a new server with shutdown handler
			const port2 = ctx.port + 1;
			const serverHandle2 = createHttpServer({
				port: port2,
				bind: "127.0.0.1",
				session: ctx.session,
				onShutdown: () => {
					shutdownCalled = true;
				},
				sseConnections: new Set(),
				pendingExtensionRequests: new Map(),
			});

			await startHttpServer(serverHandle2, port2, "127.0.0.1");

			const res = await httpRequest(`http://127.0.0.1:${port2}/shutdown`, {
				method: "POST",
			});

			expect(res.status).toBe(204);

			// Wait for setImmediate to fire
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(shutdownCalled).toBe(true);

			await serverHandle2.close();
		});
	});

	// --------------------------------------------------------------------------
	// Extension UI response endpoint tests
	// --------------------------------------------------------------------------

	describe("POST /extension_ui_response", () => {
		test("returns 400 for missing body", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/extension_ui_response`, {
				method: "POST",
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toBe("Request body required");
		});

		test("returns 400 for invalid JSON", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/extension_ui_response`, {
				method: "POST",
				body: "invalid json",
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toBe("Invalid JSON");
		});

		test("returns 400 for missing type or id", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/extension_ui_response`, {
				method: "POST",
				body: JSON.stringify({ confirmed: true }),
			});

			expect(res.status).toBe(400);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toContain("missing type or id");
		});

		test("returns success for non-existent request id", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/extension_ui_response`, {
				method: "POST",
				body: JSON.stringify({
					type: "extension_ui_response",
					id: "non-existent-id",
					confirmed: true,
				}),
			});

			expect(res.status).toBe(200);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.success).toBe(true);
			expect(data.message).toContain("not found");
		});

		test("resolves pending extension request", async () => {
			const requestId = "test-request-123";
			let resolvedValue: unknown = null;

			// Set up a pending request
			ctx.pendingExtensionRequests.set(requestId, {
				resolve: (value) => {
					resolvedValue = value;
				},
				reject: () => {},
			});

			const res = await httpRequest(`${ctx.baseUrl}/extension_ui_response`, {
				method: "POST",
				body: JSON.stringify({
					type: "extension_ui_response",
					id: requestId,
					confirmed: true,
				}),
			});

			expect(res.status).toBe(200);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.success).toBe(true);

			// Pending request should be resolved
			expect(resolvedValue).toEqual({
				type: "extension_ui_response",
				id: requestId,
				confirmed: true,
			});

			// Request should be removed from pending map
			expect(ctx.pendingExtensionRequests.has(requestId)).toBe(false);
		});
	});

	// --------------------------------------------------------------------------
	// Error handling tests
	// --------------------------------------------------------------------------

	describe("error handling", () => {
		test("returns 404 for unknown endpoints", async () => {
			const res = await httpRequest(`${ctx.baseUrl}/unknown/path`);

			expect(res.status).toBe(404);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toContain("Not found");
		});

		test("returns 404 for wrong HTTP method", async () => {
			// GET on POST-only endpoint
			const res = await httpRequest(`${ctx.baseUrl}/rpc`);

			expect(res.status).toBe(404);

			const data = parseJson(res.body) as Record<string, unknown>;
			expect(data.error).toContain("Not found");
		});
	});
});
