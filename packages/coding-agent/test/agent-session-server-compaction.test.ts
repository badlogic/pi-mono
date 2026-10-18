/**
 * Tests for adopting provider-side (Responses API `context_management`)
 * compaction into pi session state via AgentSession.
 *
 * The session is driven through the same hooks the live flow uses:
 * `agent.prepareRequest` (installed by AgentSession) captures the request-time
 * snapshot and sets `context_management`, then the adapter callback
 * (`agent.onServerCompaction`) adopts the server's cut point.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, ServerCompaction, SystemMessage, UserMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const COMPATIBLE_MODEL: Model<"openai-responses"> = {
	id: "test-compact-model",
	name: "Test Compact",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "http://127.0.0.1:8045/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8192,
	compat: { serverSideCompaction: true },
};

const TEXT = (text: string) => ({ type: "text" as const, text });

const user = (text: string): UserMessage => ({ role: "user", content: [TEXT(text)], timestamp: 0 });
const system = (text: string): SystemMessage => ({ role: "system", content: [TEXT(text)], timestamp: 0 });
const assistant = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [TEXT(text)],
	api: COMPATIBLE_MODEL.api,
	provider: COMPATIBLE_MODEL.provider,
	model: COMPATIBLE_MODEL.id,
	usage: {
		input: 100,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 110,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 0,
});

describe("AgentSession server-side compaction adoption", () => {
	let tempDir: string;
	let session: AgentSession;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;
	let events: AgentSessionEvent[];

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-server-compaction-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		events = [];

		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		await authStorage.modify("openai", async () => ({ type: "api_key", key: "test-key" }));
		const modelRuntime = await ModelRuntime.create({ credentials: authStorage, modelsPath: null });
		const model = modelRuntime.getModel("openai", "test-compact-model") ?? COMPATIBLE_MODEL;
		const agent = new Agent({
			streamFn: () => {
				throw new Error("unused in these tests");
			},
			initialState: { model, systemPrompt: "", tools: [] },
		});

		sessionManager = SessionManager.inMemory();
		settingsManager = SettingsManager.create(tempDir, tempDir);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime,
			resourceLoader: createTestResourceLoader(),
		});
		session.subscribe((event) => {
			events.push(event);
		});
	});

	afterEach(() => {
		session.dispose();
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	/** Seed the session: system prompt + one compacted turn + one kept turn. */
	function seedSession(): string {
		const ids: string[] = [];
		ids.push(sessionManager.appendMessage(system("You are a test assistant.")));
		ids.push(sessionManager.appendMessage(user("first question")));
		ids.push(sessionManager.appendMessage(assistant("first answer")));
		ids.push(sessionManager.appendMessage(user("second question")));
		return ids[2];
	}

	/** Run the session's installed prepareRequest hook (non-virtual model path). */
	async function runPrepareRequest(model: Model<any>): Promise<void> {
		const projection = sessionManager.buildSessionProjection();
		await session.agent.prepareRequest?.(
			{
				context: { messages: projection.messages, tools: session.agent.state.tools.slice() },
				model,
				thinkingLevel: "off",
			},
			undefined,
		);
	}

	const getServerCompactionEntry = () =>
		sessionManager
			.getBranch()
			.filter((e) => e.type === "compaction")
			.find((e) => e.type === "compaction" && (e.details as { source?: string })?.source === "server");

	it("adopts the server cut point into a session compaction entry", async () => {
		const model = session.model!;
		expect((model.compat as { serverSideCompaction?: boolean } | undefined)?.serverSideCompaction).toBe(true);
		const firstAnswerEntryId = seedSession();

		await runPrepareRequest(model);

		// prepareRequest set the threshold and captured the request-time snapshot.
		expect(session.agent.contextManagement?.compactThreshold).toBe(
			model.contextWindow - settingsManager.getCompactionSettings(model).reserveTokens,
		);

		// The adapter callback arrives with the request's authoritative per-group
		// item counts: [system, user, assistant, user] → [1, 1, 1, 1]. The
		// server compacted the first two groups (system + "first question"); the
		// cut lands at "first answer".
		const callback = session.agent.onServerCompaction!;
		const compaction: ServerCompaction = {
			id: "cmpct_test",
			summary: "## Goal\nAnswer follow-up questions.",
			inputTokens: 1200,
			itemsCompacted: 2,
			itemsRetained: 2,
			inputItemCounts: [1, 1, 1, 1],
		};
		await callback(compaction, model as Model<any>);

		const entry = getServerCompactionEntry();
		expect(entry).toBeDefined();
		if (!entry || entry.type !== "compaction") return;
		expect(entry.summary).toBe(compaction.summary);
		// Entry-boundary retention: the first retained message ("first answer")
		// starts in the entry right before the kept user message, so the cut
		// keeps from the assistant message's entry onward.
		expect(entry.firstKeptEntryId).toBe(firstAnswerEntryId);
		expect((entry.details as { source: string }).source).toBe("server");
		expect((entry.details as { compactionItemId: string }).compactionItemId).toBe("cmpct_test");

		const projection = sessionManager.buildSessionProjection();
		const projectionTexts = projection.messages.map((m) => {
			if (m.role === "compactionSummary" || m.role === "branchSummary") return m.summary as string;
			if (m.role === "user" || m.role === "assistant" || m.role === "system") {
				if (typeof m.content === "string") return m.content;
				if (Array.isArray(m.content)) {
					return m.content.map((c) => ("text" in c && c.type === "text" ? c.text : "")).join("");
				}
				return "";
			}
			return "";
		});
		// The pre-compaction messages are gone from the projection.
		expect(projectionTexts.filter((t) => t === "first question")).toHaveLength(0);
		// The kept tail survives; a compaction summary message replaces the
		// compacted prefix (its raw text carries no framing prefix; that is
		// added only when converting to the LLM transcript).
		expect(projectionTexts.some((t) => t === "second question")).toBe(true);
		expect(projectionTexts.some((t) => t === compaction.summary)).toBe(true);

		const compactionEnd = events.find((e) => e.type === "compaction_end");
		expect(compactionEnd).toBeDefined();
		if (compactionEnd && compactionEnd.type === "compaction_end") {
			expect(compactionEnd.aborted).toBe(false);
			expect(compactionEnd.result?.summary).toBe(compaction.summary);
		}
	});

	it("does not adopt when the provider omitted the adoption metadata", async () => {
		const model = session.model!;
		seedSession();
		await runPrepareRequest(model);

		const callback = session.agent.onServerCompaction!;
		await callback(
			{ id: "cmpct_opaque", summary: "opaque-checkpoint", inputItemCounts: [1, 1, 1, 1] },
			model as Model<any>,
		);

		expect(getServerCompactionEntry()).toBeUndefined();
		// The session is untouched.
		expect(sessionManager.buildSessionProjection().messages.length).toBe(4);
	});

	it("does not set context_management for models that do not opt in", async () => {
		const model = session.model!;
		seedSession();
		// Simulate a model without the compat flag.
		(session.agent as { state: { model: Model<any> } }).state.model = { ...model, compat: undefined } as Model<any>;
		await runPrepareRequest(session.agent.state.model);
		expect(session.agent.contextManagement).toBeUndefined();
	});
});
