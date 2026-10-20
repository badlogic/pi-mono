/**
 * Regression test for #11157: extensions that sendMessage() during session_start put a
 * custom message ahead of pi's system message, and every request was built as if the
 * session were a legacy transcript (no system prompt, no native tool changes).
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getModel,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AgentSession system prompt after extension sendMessage at session_start", () => {
	let tempDir: string;
	let session: AgentSession;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-session-start-message-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	});

	afterEach(() => {
		session?.dispose();
	});

	async function createSessionWithSessionStartMessage(model: Model<"anthropic-messages">) {
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "",
				tools: [],
			},
			streamFn: () => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => stream.push({ type: "start", partial: createAssistantMessage("") }));
				queueMicrotask(() => stream.end(createAssistantMessage("ok")));
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});

		return session;
	}

	it("keeps the system prompt leading in the request context after a session_start custom message", async () => {
		// A mid-conversation-capable model: with the bug, no system message leads the request.
		const model = getModel("anthropic", "claude-opus-5")!;
		const created = await createSessionWithSessionStartMessage(model);

		await created.bindExtensions({
			mode: "interactive",
		});

		// Simulate the extension behavior: sendMessage() before the first turn.
		await created.sendCustomMessage({
			customType: "context",
			content: [{ type: "text", text: "context loaded by the extension" }],
			display: false,
		});

		let captured: TranscriptContext | undefined;
		created.agent.streamFunction = (_model, context) => {
			captured = context;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => stream.end(createAssistantMessage("ok")));
			return stream;
		};

		await created.prompt("hello");
		expect(captured).toBeDefined();

		const messages = captured!.messages as Message[];
		// The system prompt must lead the LLM request, not the extension's custom message.
		expect(messages[0]?.role).toBe("system");
		expect(messages.some((message) => message.role === "user")).toBe(true);
	});

	it("carries the initial tools in the leading system message for native tool anchoring", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const created = await createSessionWithSessionStartMessage(model);

		await created.bindExtensions({ mode: "interactive" });

		await created.sendCustomMessage({
			customType: "context",
			content: [{ type: "text", text: "context loaded by the extension" }],
			display: false,
		});

		let captured: SimpleStreamOptions | undefined;
		created.agent.streamFunction = (_model, context, options) => {
			void context;
			captured = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => stream.end(createAssistantMessage("ok")));
			return stream;
		};

		await created.prompt("hello");
		expect(captured).toBeDefined();
	});
});
