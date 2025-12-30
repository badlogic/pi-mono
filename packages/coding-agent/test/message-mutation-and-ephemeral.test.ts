import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextPatchOp } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
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
import type { ContextEvent, MessageEndEvent } from "../src/core/hooks/types.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import type { SessionMessageEntry } from "../src/core/session-manager.js";
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
	const dir = join(tmpdir(), `pi-message-mutation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function getUserText(message: Message): string | undefined {
	if (message.role !== "user") return undefined;
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("");
}

describe("message mutation + ephemeral context", () => {
	test("message_end hook can mutate assistant message before persistence", async () => {
		const tempDir = createTempDir();
		try {
			const sessionManager = SessionManager.inMemory();
			const authStorage = new AuthStorage(join(tempDir, "auth.json"));
			authStorage.setRuntimeApiKey("anthropic", "test");
			const modelRegistry = new ModelRegistry(authStorage);
			const settingsManager = SettingsManager.create(tempDir, tempDir);

			const handlers: LoadedHook["handlers"] = new Map();
			handlers.set("message_end", [
				async (event: unknown) => {
					const e = event as MessageEndEvent;
					if (e.message.role !== "assistant") return;
					const assistant = e.message as AssistantMessage;
					return {
						message: {
							...assistant,
							content: [{ type: "text", text: "REDACTED" }],
						},
					};
				},
			]);

			const hook: LoadedHook = {
				path: "<inline>",
				resolvedPath: "<inline>",
				handlers,
				messageRenderers: new Map(),
				commands: new Map(),
				setSendMessageHandler: () => {},
				setAppendEntryHandler: () => {},
			};

			const hookRunner = new HookRunner([hook], tempDir, sessionManager, modelRegistry);

			const model = getModel("anthropic", "claude-sonnet-4-5")!;

			const streamFn = (_model: Model<any>, _ctx: Context) => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ORIGINAL") });
				});
				return stream;
			};

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
			});

			await session.prompt("hello");

			// Agent state should contain the mutated assistant message.
			const last = agent.state.messages.at(-1);
			expect(last?.role).toBe("assistant");
			const lastAssistant = last as AssistantMessage;
			const textBlock = lastAssistant.content.find(
				(b): b is Extract<AssistantMessage["content"][number], { type: "text" }> => b.type === "text",
			);
			expect(textBlock?.text).toBe("REDACTED");

			// Session should persist the mutated assistant message.
			const persistedAssistant = sessionManager
				.getEntries()
				.filter((e): e is SessionMessageEntry => e.type === "message")
				.map((e) => e.message)
				.find((m): m is AssistantMessage => m.role === "assistant");

			expect(persistedAssistant).toBeDefined();
			const persistedText = persistedAssistant!.content.find(
				(b): b is Extract<AssistantMessage["content"][number], { type: "text" }> => b.type === "text",
			);
			expect(persistedText?.text).toBe("REDACTED");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("context(ephemeral) appends uncached messages to provider request without persisting them", async () => {
		const tempDir = createTempDir();
		try {
			const sessionManager = SessionManager.inMemory();
			const authStorage = new AuthStorage(join(tempDir, "auth.json"));
			authStorage.setRuntimeApiKey("anthropic", "test");
			const modelRegistry = new ModelRegistry(authStorage);
			const settingsManager = SettingsManager.create(tempDir, tempDir);

			const handlers: LoadedHook["handlers"] = new Map();
			handlers.set("context", [
				async (event: unknown) => {
					const e = event as ContextEvent;
					if (e.reason !== "ephemeral") return;

					const eph: UserMessage = { role: "user", content: "EPH", timestamp: 0 };
					const patch: ContextPatchOp[] = [{ op: "messages_uncached_append", scope: "uncached", messages: [eph] }];

					return { patch };
				},
			]);

			const hook: LoadedHook = {
				path: "<inline>",
				resolvedPath: "<inline>",
				handlers,
				messageRenderers: new Map(),
				commands: new Map(),
				setSendMessageHandler: () => {},
				setAppendEntryHandler: () => {},
			};

			const hookRunner = new HookRunner([hook], tempDir, sessionManager, modelRegistry);

			const model = getModel("anthropic", "claude-sonnet-4-5")!;

			let providerContext: Context | undefined;
			const streamFn = (_model: Model<any>, ctx: Context) => {
				providerContext = ctx;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
				});
				return stream;
			};

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
			});

			await session.prompt("hello");

			expect(providerContext).toBeDefined();
			const userMessages = providerContext!.messages.filter((m): m is UserMessage => m.role === "user");
			const lastUser = userMessages.at(-1);
			expect(lastUser ? getUserText(lastUser) : undefined).toBe("EPH");

			// Ensure request-only message was not persisted into session history.
			const persistedUserTexts = sessionManager
				.getEntries()
				.filter((e): e is SessionMessageEntry => e.type === "message")
				.map((e) => e.message)
				.filter((m): m is UserMessage => m.role === "user")
				.map((m) => getUserText(m));

			expect(persistedUserTexts).toEqual(["hello"]);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
