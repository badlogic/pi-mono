import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type ContextEnvelope } from "@mariozechner/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	getModel,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import type { LoadedHook } from "../src/core/hooks/loader.js";
import { HookRunner } from "../src/core/hooks/runner.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-context-replay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function getUserText(message: Message): string | undefined {
	if (message.role !== "user") return undefined;
	const user = message as UserMessage;
	if (typeof user.content === "string") return user.content;
	return user.content
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("");
}

describe("context transform replay", () => {
	test("persists before_request patch and replays it on next run", async () => {
		const tempDir = createTempDir();
		try {
			const sessionManager = SessionManager.inMemory();
			const authStorage = new AuthStorage(join(tempDir, "auth.json"));
			authStorage.setRuntimeApiKey("anthropic", "test");
			const modelRegistry = new ModelRegistry(authStorage);
			const settingsManager = SettingsManager.create(tempDir, tempDir);

			const capturedContexts: Context[] = [];
			const streamFn = (_model: Model<any>, ctx: Context) => {
				capturedContexts.push(ctx);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
				});
				return stream;
			};

			const model = getModel("anthropic", "claude-sonnet-4-5")!;

			const handlers: LoadedHook["handlers"] = new Map();
			handlers.set("context", [
				async (event: unknown) => {
					const e = event as { reason: string; state: { envelope: ContextEnvelope } };
					if (e.reason !== "before_request") return;

					const marker: UserMessage = { role: "user", content: "MARKER", timestamp: 0 };

					return {
						transformerName: "marker",
						display: { title: "marker" },
						patch: [
							{
								op: "messages_cached_replace",
								scope: "cached",
								messages: [marker, ...e.state.envelope.messages.cached],
								invalidateCacheReason: "test",
							},
						],
					};
				},
			]);

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

			const agent = new Agent({
				initialState: {
					systemPrompt: "sys",
					model,
					thinkingLevel: "off",
					tools: [],
					messages: [],
				},
				streamFn,
			});

			const session = new AgentSession({
				agent,
				sessionManager,
				settingsManager,
				hookRunner,
				modelRegistry,
				systemPromptParts: [{ name: "base", text: "sys" }],
			});

			await session.prompt("hello");

			expect(capturedContexts).toHaveLength(1);
			expect(getUserText(capturedContexts[0].messages[0]!)).toBe("MARKER");

			const hasTransform = sessionManager.getEntries().some((e) => e.type === "context_transform");
			expect(hasTransform).toBe(true);

			// New agent+session without hooks should still replay the persisted transform.
			const capturedContexts2: Context[] = [];
			const streamFn2 = (_model: Model<any>, ctx: Context) => {
				capturedContexts2.push(ctx);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
				});
				return stream;
			};

			const agent2 = new Agent({
				initialState: {
					systemPrompt: "sys",
					model,
					thinkingLevel: "off",
					tools: [],
					messages: [],
				},
				streamFn: streamFn2,
			});

			const session2 = new AgentSession({
				agent: agent2,
				sessionManager,
				settingsManager,
				modelRegistry,
				systemPromptParts: [{ name: "base", text: "sys" }],
			});

			await session2.prompt("again");

			expect(capturedContexts2).toHaveLength(1);
			expect(getUserText(capturedContexts2[0].messages[0]!)).toBe("MARKER");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
