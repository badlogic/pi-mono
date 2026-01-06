/**
 * Integration tests for HTTP extensions with the fetch wrapper.
 *
 * Tests the full flow from extension registration through the fetch wrapper
 * that integrates with pi-ai.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Api, Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionFetchFactory, headersToRecord, redactHeaders } from "../../src/core/extensions/http.js";
import { ExtensionRunner } from "../../src/core/extensions/runner.js";
import type { HttpRequestEvent, HttpResponseEvent, LoadedExtension } from "../../src/core/extensions/types.js";
import type { ModelRegistry } from "../../src/core/model-registry.js";
import type { SessionManager } from "../../src/core/session-manager.js";

// Mock SessionManager
function createMockSessionManager(): SessionManager {
	return {
		getCwd: () => "/test",
		getSessionDir: () => "/test/.pi/sessions",
		getSessionId: () => "test-session",
		getSessionFile: () => "/test/.pi/sessions/test.jsonl",
		getLeafUuid: () => "test-uuid",
		getLeafEntry: () => undefined,
		getEntry: () => undefined,
		getLabel: () => undefined,
		getPath: () => [],
		getHeader: () => undefined,
		getEntries: () => [],
		getTree: () => ({ roots: [], currentPath: [] }),
	} as unknown as SessionManager;
}

// Mock ModelRegistry
function createMockModelRegistry(): ModelRegistry {
	return {
		getApiKey: async () => "test-key",
		find: () => undefined,
		getAll: () => [],
	} as unknown as ModelRegistry;
}

// Mock Model
function createMockModel(): Model<Api> {
	return {
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	} as Model<Api>;
}

// Create a LoadedExtension
function createExtension(
	onHttpRequest?: (event: HttpRequestEvent) => { headers?: Record<string, string>; cancel?: boolean } | undefined,
	onHttpResponse?: (event: HttpResponseEvent) => undefined,
): LoadedExtension {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]>();

	if (onHttpRequest) {
		handlers.set("http_request", [async (event: unknown) => onHttpRequest(event as HttpRequestEvent)]);
	}

	if (onHttpResponse) {
		handlers.set("http_response", [async (event: unknown) => onHttpResponse(event as HttpResponseEvent)]);
	}

	return {
		path: "test-extension",
		resolvedPath: "/test/test-extension.ts",
		handlers,
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		flagValues: new Map(),
		shortcuts: new Map(),
		setSendMessageHandler: () => {},
		setSendUserMessageHandler: () => {},
		setAppendEntryHandler: () => {},
		setGetActiveToolsHandler: () => {},
		setGetAllToolsHandler: () => {},
		setSetActiveToolsHandler: () => {},
		setFlagValue: () => {},
	};
}

/**
 * Helper to create the wrapped fetch using the real createExtensionFetchFactory.
 */
function createFetchWithExtensions(extensionRunner: ExtensionRunner, model: Model<Api>): typeof globalThis.fetch {
	const factory = createExtensionFetchFactory(extensionRunner);
	if (!factory) {
		throw new Error("Expected createExtensionFetchFactory to return a factory when extensions are registered");
	}
	return factory(model);
}

describe("HTTP extensions integration", () => {
	let server: Server;
	let serverPort: number;
	let serverUrl: string;
	let receivedHeaders: Record<string, string | string[] | undefined>;
	let _receivedBody: string;

	beforeEach(async () => {
		receivedHeaders = {};
		_receivedBody = "";

		// Create a simple test server
		server = createServer((req: IncomingMessage, res: ServerResponse) => {
			// Capture received headers
			receivedHeaders = { ...req.headers };

			// Capture body
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				_receivedBody = Buffer.concat(chunks).toString();
				res.writeHead(200, { "content-type": "application/json", "x-server-id": "test-server" });
				res.end(JSON.stringify({ success: true }));
			});
		});

		// Listen on a random available port
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				if (addr && typeof addr === "object") {
					serverPort = addr.port;
					serverUrl = `http://127.0.0.1:${serverPort}`;
				}
				resolve();
			});
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});

	it("should emit http_request and http_response events through fetch wrapper", async () => {
		const capturedRequestEvents: HttpRequestEvent[] = [];
		const capturedResponseEvents: HttpResponseEvent[] = [];

		const ext = createExtension(
			(event) => {
				capturedRequestEvents.push(event);
				return undefined;
			},
			(event) => {
				capturedResponseEvents.push(event);
				return undefined;
			},
		);

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		const response = await wrappedFetch(serverUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ test: true }),
		});

		expect(response.status).toBe(200);

		// Verify request event
		expect(capturedRequestEvents).toHaveLength(1);
		expect(capturedRequestEvents[0].provider).toBe("anthropic");
		expect(capturedRequestEvents[0].modelId).toBe("claude-sonnet-4-5");
		expect(capturedRequestEvents[0].url).toBe(serverUrl);
		expect(capturedRequestEvents[0].method).toBe("POST");

		// Verify response event
		expect(capturedResponseEvents).toHaveLength(1);
		expect(capturedResponseEvents[0].provider).toBe("anthropic");
		expect(capturedResponseEvents[0].modelId).toBe("claude-sonnet-4-5");
		expect(capturedResponseEvents[0].status).toBe(200);
		expect(capturedResponseEvents[0].durationMs).toBeGreaterThanOrEqual(0);
		expect(capturedResponseEvents[0].headers["content-type"]).toBe("application/json");
		expect(capturedResponseEvents[0].headers["x-server-id"]).toBe("test-server");
	});

	it("should allow extensions to inject custom headers", async () => {
		const ext = createExtension(() => ({
			headers: {
				"x-custom-header": "injected-value",
				"x-request-trace": "trace-123",
			},
		}));

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		// Server should receive the injected headers
		expect(receivedHeaders["x-custom-header"]).toBe("injected-value");
		expect(receivedHeaders["x-request-trace"]).toBe("trace-123");
	});

	it("should allow extensions to overwrite existing headers", async () => {
		const ext = createExtension(() => ({
			headers: {
				"x-existing-header": "hook-overwritten-value",
			},
		}));

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-existing-header": "original-value",
			},
			body: "{}",
		});

		// Server should receive the hook-overwritten value, not the original
		expect(receivedHeaders["x-existing-header"]).toBe("hook-overwritten-value");
	});

	it("should throw error when extension cancels request", async () => {
		const ext = createExtension(() => ({
			cancel: true,
		}));

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await expect(
			wrappedFetch(serverUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		).rejects.toThrow("HTTP request cancelled by extension");
	});

	it("should redact authorization header in http_request event", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer sk-secret-key-12345",
			},
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		expect(capturedEvent!.headers.authorization).toBe("[REDACTED]");

		// But actual request should have the real header
		expect(receivedHeaders.authorization).toBe("Bearer sk-secret-key-12345");
	});

	it("should redact x-api-key header in http_request event", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": "anthropic-key-abc123",
			},
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		expect(capturedEvent!.headers["x-api-key"]).toBe("[REDACTED]");

		// But actual request should have the real header
		expect(receivedHeaders["x-api-key"]).toBe("anthropic-key-abc123");
	});

	it("should redact headers matching heuristic patterns", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-auth-token": "token-value",
				"custom-secret-header": "secret-value",
				"api-key-custom": "key-value",
				"session-cookie": "cookie-value",
			},
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		// All should be redacted due to pattern matching
		expect(capturedEvent!.headers["x-auth-token"]).toBe("[REDACTED]");
		expect(capturedEvent!.headers["custom-secret-header"]).toBe("[REDACTED]");
		expect(capturedEvent!.headers["api-key-custom"]).toBe("[REDACTED]");
		expect(capturedEvent!.headers["session-cookie"]).toBe("[REDACTED]");

		// But actual request should have real values
		expect(receivedHeaders["x-auth-token"]).toBe("token-value");
		expect(receivedHeaders["custom-secret-header"]).toBe("secret-value");
		expect(receivedHeaders["api-key-custom"]).toBe("key-value");
		expect(receivedHeaders["session-cookie"]).toBe("cookie-value");
	});

	it("should not redact non-sensitive headers", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				"user-agent": "test-agent/1.0",
				"x-request-id": "12345",
			},
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		expect(capturedEvent!.headers["content-type"]).toBe("application/json");
		expect(capturedEvent!.headers.accept).toBe("application/json");
		expect(capturedEvent!.headers["user-agent"]).toBe("test-agent/1.0");
		expect(capturedEvent!.headers["x-request-id"]).toBe("12345");
	});

	it("should normalize array header values to comma-separated string", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Use Headers object which supports append for multiple values
		const headers = new Headers();
		headers.append("accept", "application/json");
		headers.append("accept", "text/plain");

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers,
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		// Headers class joins multiple values with ", "
		expect(capturedEvent!.headers.accept).toBe("application/json, text/plain");
	});

	it("should handle string array header values via type assertion", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Pass a string array value directly through init.headers using type assertion
		const headersWithArray = {
			"content-type": "application/json",
			"x-multi-value": ["value1", "value2", "value3"],
		} as unknown as RequestInit["headers"];

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: headersWithArray,
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		// Array values should be joined into a comma-separated string (with spaces, like Headers class)
		expect(capturedEvent!.headers["x-multi-value"]).toBe("value1, value2, value3");
	});

	it("should convert non-string header values to strings", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Use type assertion to force a non-string value (number) through to test normalization
		// In practice, some libraries might pass numbers which should be converted to strings
		const headersWithNumber = {
			"content-type": "application/json",
			"x-count": 42 as unknown as string, // Force a number through type assertion
		};

		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: headersWithNumber,
			body: "{}",
		});

		expect(capturedEvent).toBeDefined();
		expect(typeof capturedEvent!.headers["x-count"]).toBe("string");
		expect(capturedEvent!.headers["x-count"]).toBe("42");

		// Verify the server also received the header with the string value
		expect(receivedHeaders["x-count"]).toBe("42");
	});

	it("should measure response duration accurately", async () => {
		let capturedDurationMs = 0;

		const ext = createExtension(undefined, (event) => {
			capturedDurationMs = event.durationMs;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		const startTime = Date.now();
		await wrappedFetch(serverUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		const totalTime = Date.now() - startTime;

		// Duration should be captured and reasonably close to actual time
		expect(capturedDurationMs).toBeGreaterThanOrEqual(0);
		expect(capturedDurationMs).toBeLessThanOrEqual(totalTime + 100); // Allow some margin
	});

	it("should handle Request object input and capture its headers", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Create a Request object with headers
		const request = new Request(serverUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-custom-from-request": "request-value",
			},
			body: "{}",
		});

		const response = await wrappedFetch(request);

		expect(response.status).toBe(200);
		expect(capturedEvent).toBeDefined();
		// Verify method and url are correctly extracted from the Request object
		expect(capturedEvent!.method).toBe("POST");
		// Request object may normalize the URL (e.g., adding trailing slash)
		expect(capturedEvent!.url).toContain(serverUrl);
		expect(capturedEvent!.headers["content-type"]).toBe("application/json");
		expect(capturedEvent!.headers["x-custom-from-request"]).toBe("request-value");

		// Verify server received the headers
		expect(receivedHeaders["x-custom-from-request"]).toBe("request-value");
	});

	it("should have undefined body for non-string bodies but request still succeeds", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			return undefined;
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Use Uint8Array as body
		const binaryBody = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello" in bytes

		const response = await wrappedFetch(serverUrl, {
			method: "POST",
			headers: { "content-type": "application/octet-stream" },
			body: binaryBody,
		});

		expect(response.status).toBe(200);
		expect(capturedEvent).toBeDefined();
		// Body should be undefined since it's not a string
		expect(capturedEvent!.body).toBeUndefined();

		// Server should still receive the body
		expect(_receivedBody).toBe("hello");
	});

	it("should fire http_request but not http_response on network errors, and propagate the error", async () => {
		const capturedRequestEvents: HttpRequestEvent[] = [];
		const capturedResponseEvents: HttpResponseEvent[] = [];

		const ext = createExtension(
			(event) => {
				capturedRequestEvents.push(event);
				return undefined;
			},
			(event) => {
				capturedResponseEvents.push(event);
				return undefined;
			},
		);

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Mock globalThis.fetch to reject - vitest will restore in afterEach
		const networkError = new Error("Network error: connection refused");
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(networkError);

		await expect(
			wrappedFetch(serverUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		).rejects.toThrow("Network error: connection refused");

		// http_request should have been emitted before the fetch call
		expect(capturedRequestEvents).toHaveLength(1);
		expect(capturedRequestEvents[0].url).toBe(serverUrl);

		// http_response should NOT have been emitted due to the error
		expect(capturedResponseEvents).toHaveLength(0);
	});

	it("should not call globalThis.fetch and not emit http_response when hook cancels", async () => {
		const capturedRequestEvents: HttpRequestEvent[] = [];
		const capturedResponseEvents: HttpResponseEvent[] = [];

		const ext = createExtension(
			(event) => {
				capturedRequestEvents.push(event);
				return { cancel: true };
			},
			(event) => {
				capturedResponseEvents.push(event);
				return undefined;
			},
		);

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		// Mock globalThis.fetch to track if it's called - vitest will restore in afterEach
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(
			wrappedFetch(serverUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		).rejects.toThrow("HTTP request cancelled by extension");

		// http_request was emitted
		expect(capturedRequestEvents).toHaveLength(1);

		// globalThis.fetch was NEVER called
		expect(fetchSpy).not.toHaveBeenCalled();

		// http_response was NEVER emitted
		expect(capturedResponseEvents).toHaveLength(0);
	});

	it("should handle hook returning empty object (no headers, no cancel)", async () => {
		let capturedEvent: HttpRequestEvent | undefined;

		const ext = createExtension((event) => {
			capturedEvent = event;
			// Return empty object - should be treated as no modifications
			return {};
		});

		const extensionRunner = new ExtensionRunner(
			[ext],
			"/test",
			createMockSessionManager(),
			createMockModelRegistry(),
		);

		const model = createMockModel();
		const wrappedFetch = createFetchWithExtensions(extensionRunner, model);

		const response = await wrappedFetch(serverUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		// Request should succeed
		expect(response.status).toBe(200);
		expect(capturedEvent).toBeDefined();
	});
});

describe("exported helper functions", () => {
	describe("redactHeaders", () => {
		it("should redact sensitive headers", () => {
			const headers = {
				"content-type": "application/json",
				authorization: "Bearer secret123",
				"x-api-key": "key123",
			};

			const result = redactHeaders(headers);

			expect(result["content-type"]).toBe("application/json");
			expect(result.authorization).toBe("[REDACTED]");
			expect(result["x-api-key"]).toBe("[REDACTED]");
		});

		it("should redact headers matching patterns", () => {
			const headers = {
				"x-auth-token": "token-value",
				"custom-secret-value": "secret",
			};

			const result = redactHeaders(headers);

			expect(result["x-auth-token"]).toBe("[REDACTED]");
			expect(result["custom-secret-value"]).toBe("[REDACTED]");
		});
	});

	describe("headersToRecord", () => {
		it("should convert Headers to Record", () => {
			const headers = new Headers();
			headers.set("content-type", "application/json");
			headers.set("x-custom", "value");

			const result = headersToRecord(headers);

			expect(result["content-type"]).toBe("application/json");
			expect(result["x-custom"]).toBe("value");
		});
	});

	describe("createExtensionFetchFactory", () => {
		it("should return undefined when runner is undefined", () => {
			const result = createExtensionFetchFactory(undefined);
			expect(result).toBeUndefined();
		});

		it("should return undefined when no HTTP handlers are registered", () => {
			const ext: LoadedExtension = {
				path: "test-extension",
				resolvedPath: "/test/test-extension.ts",
				handlers: new Map(), // No handlers
				tools: new Map(),
				messageRenderers: new Map(),
				commands: new Map(),
				flags: new Map(),
				flagValues: new Map(),
				shortcuts: new Map(),
				setSendMessageHandler: () => {},
				setSendUserMessageHandler: () => {},
				setAppendEntryHandler: () => {},
				setGetActiveToolsHandler: () => {},
				setGetAllToolsHandler: () => {},
				setSetActiveToolsHandler: () => {},
				setFlagValue: () => {},
			};

			const extensionRunner = new ExtensionRunner(
				[ext],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);
			const result = createExtensionFetchFactory(extensionRunner);

			expect(result).toBeUndefined();
		});
	});
});
