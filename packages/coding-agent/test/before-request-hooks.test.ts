/**
 * Tests for the before_request hook event.
 * This hook fires before each LLM request, allowing dynamic context modification.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel, type Message } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import {
	type BeforeRequestEvent,
	type BeforeRequestEventResult,
	HookRunner,
	type LoadedHook,
} from "../src/core/hooks/index.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN;

describe.skipIf(!API_KEY)("before_request hooks", () => {
	let session: AgentSession;
	let tempDir: string;
	let hookRunner: HookRunner;
	let capturedEvents: BeforeRequestEvent[];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-before-request-hooks-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		capturedEvents = [];
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createHook(
		onBeforeRequest?: (event: BeforeRequestEvent) => BeforeRequestEventResult | undefined,
	): LoadedHook {
		const handlers = new Map<string, ((event: any, ctx: any) => Promise<any>)[]>();

		handlers.set("before_request", [
			async (event: BeforeRequestEvent) => {
				capturedEvents.push({ ...event });
				if (onBeforeRequest) {
					return onBeforeRequest(event);
				}
				return undefined;
			},
		]);

		return {
			path: "test-hook",
			resolvedPath: "/test/test-hook.ts",
			handlers,
			setSendHandler: () => {},
		};
	}

	function createSession(hooks: LoadedHook[]) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		hookRunner = new HookRunner(hooks, tempDir);
		hookRunner.setUIContext(
			{
				select: async () => null,
				confirm: async () => false,
				input: async () => null,
				notify: () => {},
			},
			false,
		);

		const transport = new ProviderTransport({
			getApiKey: () => API_KEY,
		});

		const agent = new Agent({
			transport,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be very concise, respond in 10 words or less.",
				tools: codingTools,
			},
		});

		// Wire up the beforeRequest callback to emit hook events
		agent.setBeforeRequest(async (context) => {
			if (!hookRunner.hasHandlers("before_request")) {
				return undefined;
			}
			const result = await hookRunner.emit({
				type: "before_request",
				systemPrompt: context.systemPrompt,
				messages: context.messages,
				tools: context.tools,
				model: context.model,
				reasoning: context.reasoning,
				turnIndex: context.turnIndex,
			});
			return result as BeforeRequestEventResult | undefined;
		});

		const sessionManager = SessionManager.create(tempDir);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		const modelRegistry = new ModelRegistry(authStorage);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			hookRunner,
			modelRegistry,
		});

		// Subscribe to events (required for session persistence)
		session.subscribe(() => {});
	}

	it("should emit before_request event before LLM call", async () => {
		createSession([createHook()]);

		await session.prompt("Say hello");

		// Should have captured at least one before_request event
		expect(capturedEvents.length).toBeGreaterThanOrEqual(1);

		// Event should have the expected properties
		const event = capturedEvents[0];
		expect(event.type).toBe("before_request");
		expect(event.systemPrompt).toBeDefined();
		expect(event.messages).toBeDefined();
		expect(event.model).toBeDefined();
		expect(event.turnIndex).toBe(0);
	});

	it("should allow modifying system prompt via hook", async () => {
		const customMemory = "IMPORTANT: Always respond with exactly the word 'MEMORY_INJECTED' and nothing else.";
		let modifiedPromptUsed = false;

		createSession([
			createHook((_event) => {
				modifiedPromptUsed = true;
				return {
					systemPrompt: customMemory,
				};
			}),
		]);

		await session.prompt("Say something");

		// The hook should have been called and modified the prompt
		expect(capturedEvents.length).toBeGreaterThanOrEqual(1);
		expect(modifiedPromptUsed).toBe(true);

		// Verify the hook received the original prompt
		expect(capturedEvents[0].systemPrompt).toContain("helpful assistant");
	});

	it("should increment turnIndex across multi-turn conversations", async () => {
		createSession([createHook()]);

		// Force a multi-turn by asking for tool use
		await session.prompt("List the files in the current directory");

		// Should have multiple events if tools were called
		if (capturedEvents.length > 1) {
			// Turn indices should be sequential
			for (let i = 0; i < capturedEvents.length; i++) {
				expect(capturedEvents[i].turnIndex).toBe(i);
			}
		}
	});

	it("should pass current messages in the event", async () => {
		createSession([createHook()]);

		await session.prompt("Hello");

		expect(capturedEvents.length).toBeGreaterThanOrEqual(1);

		// First event should have the user message in the messages array
		const event = capturedEvents[0];
		expect(event.messages.length).toBeGreaterThan(0);

		// The last message should be from the user
		const userMessages = event.messages.filter((m: Message) => m.role === "user");
		expect(userMessages.length).toBeGreaterThan(0);
	});

	it("should pass tools in the event", async () => {
		createSession([createHook()]);

		await session.prompt("Hi");

		expect(capturedEvents.length).toBeGreaterThanOrEqual(1);

		// Should have tools
		const event = capturedEvents[0];
		expect(event.tools).toBeDefined();
		expect(event.tools.length).toBeGreaterThan(0);

		// Should include coding tools
		const toolNames = event.tools.map((t) => t.name);
		expect(toolNames).toContain("read");
		expect(toolNames).toContain("bash");
	});

	it("should handle async hook operations", async () => {
		let asyncOperationCompleted = false;

		createSession([
			createHook((event) => {
				// Simulate async operation inline - the handler itself is already async in createHook
				asyncOperationCompleted = true;
				return {
					systemPrompt: `${event.systemPrompt}\n[Memory loaded]`,
				};
			}),
		]);

		await session.prompt("Hi");

		expect(asyncOperationCompleted).toBe(true);
	});

	it("should not block on hooks returning undefined", async () => {
		createSession([
			createHook(() => undefined), // Hook that does nothing
		]);

		// Should complete without errors
		await session.prompt("Say hi");

		expect(capturedEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("should support multiple hooks", async () => {
		const hook1Calls: number[] = [];
		const hook2Calls: number[] = [];

		const hook1: LoadedHook = {
			path: "hook1",
			resolvedPath: "/test/hook1.ts",
			handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
				[
					"before_request",
					[
						async (event: BeforeRequestEvent) => {
							hook1Calls.push(event.turnIndex);
							return undefined;
						},
					],
				],
			]),
			setSendHandler: () => {},
		};

		const hook2: LoadedHook = {
			path: "hook2",
			resolvedPath: "/test/hook2.ts",
			handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
				[
					"before_request",
					[
						async (event: BeforeRequestEvent) => {
							hook2Calls.push(event.turnIndex);
							return undefined;
						},
					],
				],
			]),
			setSendHandler: () => {},
		};

		createSession([hook1, hook2]);

		await session.prompt("Hi");

		// Both hooks should have been called
		expect(hook1Calls.length).toBeGreaterThanOrEqual(1);
		expect(hook2Calls.length).toBeGreaterThanOrEqual(1);
	});
});

describe("before_request hook types", () => {
	it("should have correct event structure", () => {
		const event: BeforeRequestEvent = {
			type: "before_request",
			systemPrompt: "test",
			messages: [],
			tools: [],
			model: { id: "test", provider: "test" } as any,
			reasoning: "low",
			turnIndex: 0,
		};

		expect(event.type).toBe("before_request");
		expect(event.turnIndex).toBe(0);
	});

	it("should have correct result structure", () => {
		const result: BeforeRequestEventResult = {
			systemPrompt: "modified",
			messages: [],
		};

		expect(result.systemPrompt).toBe("modified");
	});

	it("should allow partial results", () => {
		// Only modifying system prompt
		const result1: BeforeRequestEventResult = {
			systemPrompt: "new prompt",
		};
		expect(result1.systemPrompt).toBe("new prompt");
		expect(result1.messages).toBeUndefined();

		// Only modifying messages
		const result2: BeforeRequestEventResult = {
			messages: [],
		};
		expect(result2.systemPrompt).toBeUndefined();
		expect(result2.messages).toEqual([]);
	});
});
