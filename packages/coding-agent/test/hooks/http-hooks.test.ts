/**
 * Tests for HTTP extension events (http_request / http_response).
 *
 * These tests verify the extension infrastructure for HTTP events without making real API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionRunner } from "../../src/core/extensions/runner.js";
import type {
	HttpRequestEvent,
	HttpRequestEventResult,
	HttpResponseEvent,
	LoadedExtension,
} from "../../src/core/extensions/types.js";
import type { ModelRegistry } from "../../src/core/model-registry.js";
import type { SessionManager } from "../../src/core/session-manager.js";

// Mock SessionManager (minimal interface for ExtensionRunner)
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

// Create a LoadedExtension with HTTP handlers
function createExtension(
	onHttpRequest?: (
		event: HttpRequestEvent,
	) => HttpRequestEventResult | undefined | Promise<HttpRequestEventResult | undefined>,
	onHttpResponse?: (event: HttpResponseEvent) => undefined | Promise<undefined>,
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
		setAppendEntryHandler: () => {},
		setGetActiveToolsHandler: () => {},
		setGetAllToolsHandler: () => {},
		setSetActiveToolsHandler: () => {},
		setFlagValue: () => {},
	};
}

describe("HTTP extensions", () => {
	let extensionRunner: ExtensionRunner;
	let capturedRequestEvents: HttpRequestEvent[];
	let capturedResponseEvents: HttpResponseEvent[];

	beforeEach(() => {
		capturedRequestEvents = [];
		capturedResponseEvents = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("http_request event", () => {
		it("should emit http_request event with correct fields", async () => {
			const ext = createExtension((event) => {
				capturedRequestEvents.push(event);
				return undefined;
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "[REDACTED]",
				},
				body: '{"model":"claude-sonnet-4-5"}',
			});

			expect(capturedRequestEvents).toHaveLength(1);
			const event = capturedRequestEvents[0];
			expect(event.type).toBe("http_request");
			expect(event.provider).toBe("anthropic");
			expect(event.modelId).toBe("claude-sonnet-4-5");
			expect(event.url).toBe("https://api.anthropic.com/v1/messages");
			expect(event.method).toBe("POST");
			expect(event.headers["content-type"]).toBe("application/json");
			expect(event.headers.authorization).toBe("[REDACTED]");
			expect(event.body).toBe('{"model":"claude-sonnet-4-5"}');
		});

		it("should allow extensions to add headers via result.headers", async () => {
			const ext = createExtension(() => {
				return {
					headers: {
						"x-custom-header": "custom-value",
						"x-request-id": "12345",
					},
				};
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			const result = await extensionRunner.emitHttpRequest({
				provider: "openai",
				modelId: "gpt-4o",
				url: "https://api.openai.com/v1/chat/completions",
				method: "POST",
				headers: { "content-type": "application/json" },
			});

			expect(result).toBeDefined();
			expect(result!.headers).toBeDefined();
			expect(result!.headers!["x-custom-header"]).toBe("custom-value");
			expect(result!.headers!["x-request-id"]).toBe("12345");
			expect(result!.cancel).toBe(false);
		});

		it("should allow extensions to cancel requests via result.cancel", async () => {
			const ext = createExtension(() => {
				return { cancel: true };
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(result).toBeDefined();
			expect(result!.cancel).toBe(true);
		});

		it("should merge headers from multiple extensions", async () => {
			const ext1 = createExtension(() => ({
				headers: { "x-hook1": "value1" },
			}));
			const ext2 = createExtension(() => ({
				headers: { "x-hook2": "value2" },
			}));

			extensionRunner = new ExtensionRunner(
				[ext1, ext2],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(result).toBeDefined();
			expect(result!.headers!["x-hook1"]).toBe("value1");
			expect(result!.headers!["x-hook2"]).toBe("value2");
		});

		it("should return cancel=true if any extension cancels", async () => {
			const ext1 = createExtension(() => ({
				headers: { "x-hook1": "value1" },
			}));
			const ext2 = createExtension(() => ({
				cancel: true,
			}));
			const ext3 = createExtension(() => ({
				headers: { "x-hook3": "value3" },
			}));

			extensionRunner = new ExtensionRunner(
				[ext1, ext2, ext3],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(result).toBeDefined();
			expect(result!.cancel).toBe(true);
			// Headers from all hooks should still be merged
			expect(result!.headers!["x-hook1"]).toBe("value1");
			expect(result!.headers!["x-hook3"]).toBe("value3");
		});

		it("should return undefined if no extensions are registered", async () => {
			extensionRunner = new ExtensionRunner([], "/test", createMockSessionManager(), createMockModelRegistry());

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(result).toBeUndefined();
		});

		it("should handle extension errors gracefully", async () => {
			const errorExt = createExtension(() => {
				throw new Error("Extension error");
			});

			extensionRunner = new ExtensionRunner(
				[errorExt],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);

			const errors: { extensionPath: string; event: string; error: string }[] = [];
			extensionRunner.onError((err) => errors.push(err));

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(result).toBeUndefined();
			expect(errors).toHaveLength(1);
			expect(errors[0].extensionPath).toBe("test-extension");
			expect(errors[0].event).toBe("http_request");
			expect(errors[0].error).toContain("Extension error");
		});

		it("should handle async extension handlers", async () => {
			const ext = createExtension(async (event) => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				capturedRequestEvents.push(event);
				return { headers: { "x-async": "true" } };
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			const result = await extensionRunner.emitHttpRequest({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				url: "https://api.anthropic.com/v1/messages",
				method: "POST",
				headers: {},
			});

			expect(capturedRequestEvents).toHaveLength(1);
			expect(result!.headers!["x-async"]).toBe("true");
		});
	});

	describe("http_response event", () => {
		it("should emit http_response event with correct fields", async () => {
			const ext = createExtension(undefined, (event) => {
				capturedResponseEvents.push(event);
				return undefined;
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			await extensionRunner.emitHttpResponse({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-request-id": "req-12345",
				},
				durationMs: 1500,
			});

			expect(capturedResponseEvents).toHaveLength(1);
			const event = capturedResponseEvents[0];
			expect(event.type).toBe("http_response");
			expect(event.provider).toBe("anthropic");
			expect(event.modelId).toBe("claude-sonnet-4-5");
			expect(event.status).toBe(200);
			expect(event.headers["content-type"]).toBe("application/json");
			expect(event.headers["x-request-id"]).toBe("req-12345");
			expect(event.durationMs).toBe(1500);
		});

		it("should call multiple response handlers in order", async () => {
			const callOrder: string[] = [];

			const ext1: LoadedExtension = {
				path: "ext1",
				resolvedPath: "/test/ext1.ts",
				handlers: new Map([
					[
						"http_response",
						[
							async () => {
								callOrder.push("hook1");
								return undefined;
							},
						],
					],
				]),
				tools: new Map(),
				messageRenderers: new Map(),
				commands: new Map(),
				flags: new Map(),
				flagValues: new Map(),
				shortcuts: new Map(),
				setSendMessageHandler: () => {},
				setAppendEntryHandler: () => {},
				setGetActiveToolsHandler: () => {},
				setGetAllToolsHandler: () => {},
				setSetActiveToolsHandler: () => {},
				setFlagValue: () => {},
			};

			const ext2: LoadedExtension = {
				path: "ext2",
				resolvedPath: "/test/ext2.ts",
				handlers: new Map([
					[
						"http_response",
						[
							async () => {
								callOrder.push("hook2");
								return undefined;
							},
						],
					],
				]),
				tools: new Map(),
				messageRenderers: new Map(),
				commands: new Map(),
				flags: new Map(),
				flagValues: new Map(),
				shortcuts: new Map(),
				setSendMessageHandler: () => {},
				setAppendEntryHandler: () => {},
				setGetActiveToolsHandler: () => {},
				setGetAllToolsHandler: () => {},
				setSetActiveToolsHandler: () => {},
				setFlagValue: () => {},
			};

			extensionRunner = new ExtensionRunner(
				[ext1, ext2],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);

			await extensionRunner.emitHttpResponse({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				status: 200,
				headers: {},
				durationMs: 100,
			});

			expect(callOrder).toEqual(["hook1", "hook2"]);
		});

		it("should handle response extension errors gracefully", async () => {
			const errorExt = createExtension(undefined, () => {
				throw new Error("Response extension error");
			});

			extensionRunner = new ExtensionRunner(
				[errorExt],
				"/test",
				createMockSessionManager(),
				createMockModelRegistry(),
			);

			const errors: { extensionPath: string; event: string; error: string }[] = [];
			extensionRunner.onError((err) => errors.push(err));

			// Should not throw
			await extensionRunner.emitHttpResponse({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
				status: 200,
				headers: {},
				durationMs: 100,
			});

			expect(errors).toHaveLength(1);
			expect(errors[0].extensionPath).toBe("test-extension");
			expect(errors[0].event).toBe("http_response");
			expect(errors[0].error).toContain("Response extension error");
		});

		it("should capture non-200 status codes", async () => {
			const ext = createExtension(undefined, (event) => {
				capturedResponseEvents.push(event);
				return undefined;
			});

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			await extensionRunner.emitHttpResponse({
				provider: "openai",
				modelId: "gpt-4o",
				status: 429,
				headers: { "retry-after": "60" },
				durationMs: 50,
			});

			expect(capturedResponseEvents).toHaveLength(1);
			expect(capturedResponseEvents[0].status).toBe(429);
			expect(capturedResponseEvents[0].headers["retry-after"]).toBe("60");
		});
	});

	describe("hasHandlers", () => {
		it("should return true when http_request handlers exist", () => {
			const ext = createExtension(() => undefined);

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			expect(extensionRunner.hasHandlers("http_request")).toBe(true);
			expect(extensionRunner.hasHandlers("http_response")).toBe(false);
		});

		it("should return true when http_response handlers exist", () => {
			const ext = createExtension(undefined, () => undefined);

			extensionRunner = new ExtensionRunner([ext], "/test", createMockSessionManager(), createMockModelRegistry());

			expect(extensionRunner.hasHandlers("http_request")).toBe(false);
			expect(extensionRunner.hasHandlers("http_response")).toBe(true);
		});

		it("should return false when no HTTP handlers exist", () => {
			extensionRunner = new ExtensionRunner([], "/test", createMockSessionManager(), createMockModelRegistry());

			expect(extensionRunner.hasHandlers("http_request")).toBe(false);
			expect(extensionRunner.hasHandlers("http_response")).toBe(false);
		});
	});
});
