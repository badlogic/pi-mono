import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getModel,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

/**
 * Overflow recovery escape hatch (2026-10-20 incident class):
 * a session whose compact-and-retry keeps failing must stop consuming LLM calls
 * instead of letting every queued/injected message re-arm recovery forever.
 *
 * Sequence per recovery cycle: first overflow response arms one attempt, the next
 * overflow response after the failed compact-and-retry hits the failure branch.
 * Two consecutive failures latch exhaustion: further runs are refused until a
 * compaction succeeds or the model is switched.
 */
describe("AgentSession overflow recovery escape hatch", () => {
	let session: AgentSession;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-overflow-escape-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model, systemPrompt: "Test", tools: [] },
		});

		sessionManager = SessionManager.inMemory();
		settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});
	});

	afterEach(() => {
		session.dispose();
		vi.restoreAllMocks();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function overflowMessage(): AssistantMessage {
		const model = session.model!;
		return {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: "prompt is too long",
			timestamp: Date.now(),
		};
	}

	async function failRecoveryCycle(times: number): Promise<string[]> {
		vi.spyOn(
			session as unknown as {
				_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
			},
			"_runAutoCompaction",
		).mockResolvedValue(false);

		const errors: string[] = [];
		session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) errors.push(event.errorMessage);
		});

		const checkCompaction = (
			session as unknown as {
				_checkCompaction: (assistantMessage: AssistantMessage) => Promise<boolean>;
			}
		)._checkCompaction.bind(session);

		let ts = Date.now();
		// Each cycle: one call arms the attempt, the next reports the failure.
		for (let i = 0; i < times; i++) {
			await checkCompaction({ ...overflowMessage(), timestamp: ts++ });
			await checkCompaction({ ...overflowMessage(), timestamp: ts++ });
		}
		return errors;
	}

	it("two consecutive recovery failures latch exhaustion and refuse further prompts", async () => {
		const errors = await failRecoveryCycle(2);

		// Cycle 1: arm + failure (plain). Cycle 2: the still-latched flag fails immediately
		// again — that second failure latches exhaustion and appends the terminal note.
		expect(errors.length).toBeGreaterThanOrEqual(2);
		expect(errors[0]).not.toContain("Recovery is exhausted");
		expect(errors[1]).toContain("Recovery is exhausted");

		await expect(session.prompt("keep going")).rejects.toThrow(/Context overflow recovery is exhausted/);
		// The queued-message path is refused too.
		await expect(
			session.sendCustomMessage(
				{ customType: "injector", content: [{ type: "text", text: "gateway blip recovered - continue" }] },
				{ triggerTurn: true },
			),
		).rejects.toThrow(/Context overflow recovery is exhausted/);
	});

	it("a single recovery failure does not latch: the session still accepts prompts", async () => {
		await failRecoveryCycle(1);
		// Arm a faux stream so the prompt can complete without network access.
		session.agent.streamFunction = (model) => {
			const stream = createAssistantMessageEventStream();
			void Promise.resolve().then(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("ok", model) });
			});
			return stream;
		};
		await expect(session.prompt("next task")).resolves.toBeUndefined();
	});

	it("a successful manual compaction clears the exhaustion latch", async () => {
		await failRecoveryCycle(2);
		expect(session.prompt("still locked")).rejects.toThrow(/Context overflow recovery is exhausted/);

		// Manual /compact: summary stream must succeed.
		session.agent.streamFunction = (model) => {
			const stream = createAssistantMessageEventStream();
			void Promise.resolve().then(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("compacted", model) });
			});
			return stream;
		};
		settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		const now = Date.now();
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "message to compact" }],
			timestamp: now - 1000,
		});
		const m = session.model!;
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "assistant response to compact" }],
			api: m.api,
			provider: m.provider,
			model: m.id,
			usage: {
				input: 100,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: now - 500,
		});
		session.agent.state.messages = sessionManager.buildSessionContext().messages;

		await expect(session.compact()).resolves.toBeDefined();
		await expect(session.prompt("unlocked")).resolves.toBeUndefined();
	});

	it("switching the model clears the exhaustion latch", async () => {
		await failRecoveryCycle(2);
		const larger = getModel("anthropic", "claude-sonnet-4-5")!;
		await session.setModel(larger);
		session.agent.streamFunction = (model) => {
			const stream = createAssistantMessageEventStream();
			void Promise.resolve().then(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("ok", model) });
			});
			return stream;
		};
		await expect(session.prompt("after model switch")).resolves.toBeUndefined();
	});
});
