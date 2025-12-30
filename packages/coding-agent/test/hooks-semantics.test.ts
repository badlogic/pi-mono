import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, ContextEnvelope } from "@mariozechner/pi-agent-core";
import { getModel, type Message } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import type { LoadedHook } from "../src/core/hooks/loader.js";
import { HookRunner } from "../src/core/hooks/runner.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";

type PromptMessage = { role: string };

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function createHookRunner(
	tempDir: string,
	options: {
		beforeAgentStartMessage?: string;
		contextMutateInPlace?: boolean;
	},
): {
	hookRunner: HookRunner;
	sessionManager: SessionManager;
	modelRegistry: ModelRegistry;
} {
	const sessionManager = SessionManager.inMemory();
	const authStorage = new AuthStorage(join(tempDir, "auth.json"));
	authStorage.setRuntimeApiKey("anthropic", "test");
	const modelRegistry = new ModelRegistry(authStorage);

	const handlers: LoadedHook["handlers"] = new Map();

	if (options.beforeAgentStartMessage) {
		handlers.set("before_agent_start", [
			async () => ({
				message: {
					customType: "test",
					content: options.beforeAgentStartMessage,
					display: true,
					details: { source: "test" },
				},
			}),
		]);
	}

	if (options.contextMutateInPlace) {
		handlers.set("context", [
			async (event: unknown) => {
				// Mutate the envelope in-place and return nothing.
				const e = event as { state: { envelope: ContextEnvelope } };
				e.state.envelope.messages.cached.push({
					role: "user",
					content: [{ type: "text", text: "mutated" }],
					timestamp: 0,
				});
				return undefined;
			},
		]);
	}

	const hook: LoadedHook = {
		path: "<inline>",
		resolvedPath: "<inline>",
		handlers,
		messageRenderers: new Map(),
		contextTransformRenderers: new Map(),
		commands: new Map(),
		setSendMessageHandler: () => {},
		setAppendEntryHandler: () => {},
	};

	const hookRunner = new HookRunner([hook], tempDir, sessionManager, modelRegistry);
	return { hookRunner, sessionManager, modelRegistry };
}

describe("hooks semantics", () => {
	test("before_agent_start injected message is passed to Agent.prompt before the user prompt", async () => {
		const tempDir = createTempDir();
		try {
			const { hookRunner, sessionManager, modelRegistry } = createHookRunner(tempDir, {
				beforeAgentStartMessage: "injected",
			});

			const model = getModel("anthropic", "claude-sonnet-4-5")!;

			let capturedPrompts: unknown;
			const agentStub = {
				state: {
					systemPrompt: "test",
					model,
					thinkingLevel: "off",
					tools: codingTools,
					messages: [],
					isStreaming: false,
					streamMessage: null,
					pendingToolCalls: new Set<string>(),
					error: undefined,
				},
				subscribe: () => () => {},
				setBeforeRequest: () => {},
				setEphemeral: () => {},
				setOnTurnEnd: () => {},
				setMessageInterceptor: () => {},
				prompt: async (input: unknown) => {
					capturedPrompts = input;
				},
				getQueueMode: () => "one-at-a-time" as const,
			} satisfies Partial<Agent>;
			const agent = agentStub as unknown as Agent;

			const settingsManager = SettingsManager.create(tempDir, tempDir);
			const session = new AgentSession({
				agent,
				sessionManager,
				settingsManager,
				hookRunner,
				modelRegistry,
			});

			await session.prompt("hello");

			const prompts = capturedPrompts as PromptMessage[];
			expect(prompts[0]?.role).toBe("hookMessage");
			expect(prompts[1]?.role).toBe("user");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("context hook receives a defensive copy (in-place mutation does not affect input)", async () => {
		const tempDir = createTempDir();
		try {
			const { hookRunner } = createHookRunner(tempDir, { contextMutateInPlace: true });

			const model = getModel("anthropic", "claude-sonnet-4-5")!;
			const originalMessages: Message[] = [{ role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 }];

			const originalEnvelope: ContextEnvelope = {
				system: { parts: [{ name: "base", text: "sys" }], compiled: "sys" },
				tools: [],
				messages: { cached: originalMessages, uncached: [] },
				options: {},
				meta: {
					model,
					limit: 8192,
					turnIndex: 0,
					requestIndex: 0,
					signal: new AbortController().signal,
				},
			};

			const result = await hookRunner.emitContext({
				type: "context",
				reason: "before_request",
				state: { envelope: originalEnvelope },
			});

			expect(originalMessages).toHaveLength(1);
			expect(originalEnvelope.messages.cached).toHaveLength(1);
			expect(result.envelope.messages.cached).toHaveLength(1);
			expect(result.results).toHaveLength(0);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
