import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeSimpleMock } = vi.hoisted(() => ({
	completeSimpleMock: vi.fn(),
}));

// Mock completeSimple in pi-ai
vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		completeSimple: completeSimpleMock,
	};
});

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { ClassifierRoutingStrategy } from "@mariozechner/pi-ai";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("AgentSession Auto Routing", () => {
	let tempDir: string;
	let agent: Agent;
	let modelRegistry: ModelRegistry;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;

	const flashModel = {
		id: "gemini-2.0-flash",
		provider: "google",
		name: "Flash",
		api: "google-generative-ai",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
	const proModel = {
		id: "gemini-1.5-pro",
		provider: "google",
		name: "Pro",
		api: "google-generative-ai",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
	const autoModel = {
		id: "auto",
		provider: "google",
		name: "Auto",
		api: "google-generative-ai",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};

	const cliFlashModel = {
		id: "gemini-2.0-flash",
		provider: "google-gemini-cli",
		name: "Flash (CLI)",
		api: "google-gemini-cli",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
	const cliAutoModel = {
		id: "auto",
		provider: "google-gemini-cli",
		name: "Auto (CLI)",
		api: "google-gemini-cli",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};

	beforeEach(() => {
		completeSimpleMock.mockReset();
		tempDir = join(tmpdir(), `pi-test-routing-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		agent = new Agent({
			initialState: {
				model: autoModel as any,
				systemPrompt: "test",
				tools: [],
			},
			streamFn: vi.fn().mockReturnValue({
				subscribe: vi.fn(),
				result: vi.fn().mockResolvedValue({
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					stopReason: "stop",
				}),
			}),
		});

		Object.defineProperty(agent, "model", {
			get: () => (agent as any).state.model,
		});

		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		modelRegistry = new ModelRegistry(authStorage, tempDir);

		sessionManager = SessionManager.inMemory();
		settingsManager = SettingsManager.create(tempDir, tempDir);

		vi.spyOn(agent, "setModel");
		vi.spyOn(agent, "prompt");
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	const setupTestSession = (config: {
		authenticatedProviders?: string[];
		useClassifier?: boolean;
		initialModel?: any;
	}) => {
		const { authenticatedProviders = ["google"], useClassifier = true, initialModel = autoModel } = config;

		agent.setModel(initialModel);
		vi.mocked(agent.setModel).mockClear();

		vi.spyOn(modelRegistry, "find").mockImplementation((provider, id) => {
			if (!authenticatedProviders.includes(provider)) return null;
			if (provider === "google") {
				if (id === "gemini-2.0-flash") return flashModel as any;
				if (id === "gemini-1.5-pro") return proModel as any;
				if (id === "auto") return autoModel as any;
			}
			if (provider === "google-gemini-cli") {
				if (id === "gemini-2.0-flash") return cliFlashModel as any;
				if (id === "auto") return cliAutoModel as any;
			}
			return null;
		});

		vi.spyOn(modelRegistry, "getAll").mockReturnValue([
			flashModel,
			proModel,
			autoModel,
			cliFlashModel,
			cliAutoModel,
		] as any);

		vi.spyOn(modelRegistry, "getApiKey").mockImplementation(async (model) => {
			if (model.provider === "openrouter") return "openrouter-key";
			return authenticatedProviders.includes(model.provider) ? "test-key" : undefined;
		});

		const s = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			modelRegistry,
			cwd: tempDir,
			initialActiveToolNames: [],
			resourceLoader: {
				getExtensions: () => ({ extensions: [], errors: [], runtime: {} as any }),
				getSkills: () => ({ skills: [], diagnostics: [] }),
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getThemes: () => ({ themes: [], diagnostics: [] }),
				getAgentsFiles: () => ({ agentsFiles: [] }),
				getSystemPrompt: () => undefined,
				getAppendSystemPrompt: () => [],
				getPathMetadata: () => new Map(),
				extendResources: () => {},
				reload: async () => {},
			} as any,
		});

		if (useClassifier) {
			const classifierModel = (s as any)._classifierModel;
			if (classifierModel) {
				(s as any)._modelRouter.strategies = [
					new ClassifierRoutingStrategy(classifierModel as any, completeSimpleMock),
				];
			}
		} else {
			(s as any)._modelRouter.strategies = [];
		}

		return s;
	};

	it("should use heuristic fallback to Flash for simple requests", async () => {
		const session = setupTestSession({ useClassifier: false });
		await session.prompt("hello");
		expect(agent.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gemini-2.0-flash" }));
		expect(agent.setModel).toHaveBeenLastCalledWith(autoModel);
	});

	it("should use heuristic fallback to Pro for complex requests (with tools)", async () => {
		const session = setupTestSession({ useClassifier: false });
		agent.setTools([{ name: "test-tool" }] as any);
		await session.prompt("complex task");
		expect(agent.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gemini-1.5-pro" }));
		expect(agent.setModel).toHaveBeenLastCalledWith(autoModel);
	});

	it("should use Classifier strategy to route to Pro", async () => {
		const session = setupTestSession({ useClassifier: true });
		completeSimpleMock.mockResolvedValue({
			role: "assistant",
			content: [{ type: "text", text: JSON.stringify({ reasoning: "it is complex", classification: "pro" }) }],
			stopReason: "stop",
		});

		await session.prompt("classify this");

		// The dynamic update might happen DURING prompt, so we check that it EVENTUALLY
		// called setModel with the Pro model.
		expect(agent.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gemini-1.5-pro" }));
		expect(agent.setModel).toHaveBeenLastCalledWith(autoModel);
		expect(completeSimpleMock).toHaveBeenCalled();
	});

	it("should use Classifier strategy to route to Flash", async () => {
		const session = setupTestSession({ useClassifier: true });
		completeSimpleMock.mockResolvedValue({
			role: "assistant",
			content: [{ type: "text", text: JSON.stringify({ reasoning: "it is simple", classification: "flash" }) }],
			stopReason: "stop",
		});

		await session.prompt("classify this");

		expect(agent.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "gemini-2.0-flash" }));
		expect(agent.setModel).toHaveBeenLastCalledWith(autoModel);
		expect(completeSimpleMock).toHaveBeenCalled();
	});

	it("should prioritize models from requested provider (google-gemini-cli)", async () => {
		const session = setupTestSession({
			authenticatedProviders: ["google-gemini-cli"],
			initialModel: cliAutoModel,
			useClassifier: true,
		});

		completeSimpleMock.mockResolvedValue({
			role: "assistant",
			content: [{ type: "text", text: JSON.stringify({ reasoning: "it is simple", classification: "flash" }) }],
			stopReason: "stop",
		});

		await session.prompt("hello");

		expect(agent.setModel).toHaveBeenCalledWith(
			expect.objectContaining({ id: "gemini-2.0-flash", provider: "google-gemini-cli" }),
		);
		expect(agent.setModel).toHaveBeenLastCalledWith(cliAutoModel);
	});

	it("should NOT route for non-google auto models", async () => {
		const otherAuto = { id: "auto", provider: "openrouter", name: "Other Auto", api: "test-api" };
		const session = setupTestSession({ initialModel: otherAuto });

		// Ensure registry returns SAME object for the non-google auto
		vi.spyOn(modelRegistry, "find").mockReturnValue(otherAuto as any);
		vi.mocked(agent.setModel).mockClear();

		await session.prompt("hello");
		expect(agent.setModel).not.toHaveBeenCalled();
	});
});
