/**
 * Tests for compaction hook events (before_compact / compact).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { HookRunner, type LoadedHook, type SessionEvent } from "../src/core/hooks/index.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";

const API_KEY = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

describe.skipIf(!API_KEY)("Compaction hooks", () => {
	let session: AgentSession;
	let tempDir: string;
	let hookRunner: HookRunner;
	let capturedEvents: SessionEvent[];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-compaction-hooks-test-${Date.now()}`);
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
		onBeforeCompact?: (event: SessionEvent) => { cancel?: boolean; compactionEntry?: any } | undefined,
		onCompact?: (event: SessionEvent) => void,
	): LoadedHook {
		const handlers = new Map<string, ((event: any, ctx: any) => Promise<any>)[]>();

		handlers.set("session", [
			async (event: SessionEvent) => {
				capturedEvents.push(event);

				if (event.reason === "before_compact" && onBeforeCompact) {
					return onBeforeCompact(event);
				}
				if (event.reason === "compact" && onCompact) {
					onCompact(event);
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

		const transport = new ProviderTransport({
			getApiKey: () => API_KEY,
		});

		const agent = new Agent({
			transport,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: codingTools,
			},
		});

		const sessionManager = SessionManager.create(tempDir);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		const modelRegistry = new ModelRegistry(authStorage);

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
		hookRunner.setSessionFile(sessionManager.getSessionFile());

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			hookRunner,
			modelRegistry,
		});

		return session;
	}

	it("should emit before_compact and compact events", async () => {
		const hook = createHook();
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		const beforeCompactEvents = capturedEvents.filter((e) => e.reason === "before_compact");
		const compactEvents = capturedEvents.filter((e) => e.reason === "compact");

		expect(beforeCompactEvents.length).toBe(1);
		expect(compactEvents.length).toBe(1);

		const beforeEvent = beforeCompactEvents[0];
		if (beforeEvent.reason === "before_compact") {
			expect(beforeEvent.cutPoint).toBeDefined();
			expect(beforeEvent.cutPoint.firstKeptEntryIndex).toBeGreaterThanOrEqual(0);
			expect(beforeEvent.messagesToSummarize).toBeDefined();
			expect(beforeEvent.messagesToKeep).toBeDefined();
			expect(beforeEvent.tokensBefore).toBeGreaterThanOrEqual(0);
			expect(beforeEvent.model).toBeDefined();
			expect(beforeEvent.resolveApiKey).toBeDefined();
		}

		const afterEvent = compactEvents[0];
		if (afterEvent.reason === "compact") {
			expect(afterEvent.compactionEntry).toBeDefined();
			expect(afterEvent.compactionEntry.summary.length).toBeGreaterThan(0);
			expect(afterEvent.tokensBefore).toBeGreaterThanOrEqual(0);
			expect(afterEvent.fromHook).toBe(false);
		}
	}, 120000);

	it("should allow hooks to cancel compaction", async () => {
		const hook = createHook(() => ({ cancel: true }));
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await expect(session.compact()).rejects.toThrow("Compaction cancelled");

		const compactEvents = capturedEvents.filter((e) => e.reason === "compact");
		expect(compactEvents.length).toBe(0);
	}, 120000);

	it("should allow hooks to provide custom compactionEntry", async () => {
		const customSummary = "Custom summary from hook";

		const hook = createHook((event) => {
			if (event.reason === "before_compact") {
				return {
					compactionEntry: {
						type: "compaction" as const,
						timestamp: new Date().toISOString(),
						summary: customSummary,
						firstKeptEntryIndex: event.cutPoint.firstKeptEntryIndex,
						tokensBefore: event.tokensBefore,
					},
				};
			}
			return undefined;
		});
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBe(customSummary);

		const compactEvents = capturedEvents.filter((e) => e.reason === "compact");
		expect(compactEvents.length).toBe(1);

		const afterEvent = compactEvents[0];
		if (afterEvent.reason === "compact") {
			expect(afterEvent.compactionEntry.summary).toBe(customSummary);
			expect(afterEvent.fromHook).toBe(true);
		}
	}, 120000);

	it("should include entries in compact event after compaction is saved", async () => {
		const hook = createHook();
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		const compactEvents = capturedEvents.filter((e) => e.reason === "compact");
		expect(compactEvents.length).toBe(1);

		const afterEvent = compactEvents[0];
		if (afterEvent.reason === "compact") {
			const hasCompactionEntry = afterEvent.entries.some((e) => e.type === "compaction");
			expect(hasCompactionEntry).toBe(true);
		}
	}, 120000);

	it("should continue with default compaction if hook throws error", async () => {
		const throwingHook: LoadedHook = {
			path: "throwing-hook",
			resolvedPath: "/test/throwing-hook.ts",
			handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
				[
					"session",
					[
						async (event: SessionEvent) => {
							capturedEvents.push(event);
							if (event.reason === "before_compact") {
								throw new Error("Hook intentionally failed");
							}
							return undefined;
						},
					],
				],
			]),
			setSendHandler: () => {},
		};

		createSession([throwingHook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBeDefined();
		expect(result.summary.length).toBeGreaterThan(0);

		const compactEvents = capturedEvents.filter((e) => e.reason === "compact");
		expect(compactEvents.length).toBe(1);

		if (compactEvents[0].reason === "compact") {
			expect(compactEvents[0].fromHook).toBe(false);
		}
	}, 120000);

	it("should call multiple hooks in order", async () => {
		const callOrder: string[] = [];

		const hook1: LoadedHook = {
			path: "hook1",
			resolvedPath: "/test/hook1.ts",
			handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
				[
					"session",
					[
						async (event: SessionEvent) => {
							if (event.reason === "before_compact") {
								callOrder.push("hook1-before");
							}
							if (event.reason === "compact") {
								callOrder.push("hook1-after");
							}
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
					"session",
					[
						async (event: SessionEvent) => {
							if (event.reason === "before_compact") {
								callOrder.push("hook2-before");
							}
							if (event.reason === "compact") {
								callOrder.push("hook2-after");
							}
							return undefined;
						},
					],
				],
			]),
			setSendHandler: () => {},
		};

		createSession([hook1, hook2]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		expect(callOrder).toEqual(["hook1-before", "hook2-before", "hook1-after", "hook2-after"]);
	}, 120000);

	it("should pass correct data in before_compact event", async () => {
		let capturedBeforeEvent: (SessionEvent & { reason: "before_compact" }) | null = null;

		const hook = createHook((event) => {
			if (event.reason === "before_compact") {
				capturedBeforeEvent = event;
			}
			return undefined;
		});
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		expect(capturedBeforeEvent).not.toBeNull();
		const event = capturedBeforeEvent!;
		expect(event.cutPoint).toHaveProperty("firstKeptEntryIndex");
		expect(event.cutPoint).toHaveProperty("isSplitTurn");
		expect(event.cutPoint).toHaveProperty("turnStartIndex");

		expect(Array.isArray(event.messagesToSummarize)).toBe(true);
		expect(Array.isArray(event.messagesToKeep)).toBe(true);

		expect(typeof event.tokensBefore).toBe("number");

		expect(event.model).toHaveProperty("provider");
		expect(event.model).toHaveProperty("id");

		expect(typeof event.resolveApiKey).toBe("function");

		expect(Array.isArray(event.entries)).toBe(true);
		expect(event.entries.length).toBeGreaterThan(0);
	}, 120000);

	it("should use hook compactionEntry even with different firstKeptEntryIndex", async () => {
		const customSummary = "Custom summary with modified index";

		const hook = createHook((event) => {
			if (event.reason === "before_compact") {
				return {
					compactionEntry: {
						type: "compaction" as const,
						timestamp: new Date().toISOString(),
						summary: customSummary,
						firstKeptEntryIndex: 0,
						tokensBefore: 999,
					},
				};
			}
			return undefined;
		});
		createSession([hook]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBe(customSummary);
		expect(result.tokensBefore).toBe(999);
	}, 120000);
});
