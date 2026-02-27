import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, getModel, type Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { createExtensionRuntime } from "../src/core/extensions/loader.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import type { Skill } from "../src/core/skills.js";

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

function createAssistantMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
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
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AgentSession skill model selection", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-skill-model-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		writeFileSync(
			join(tempDir, "models.json"),
			JSON.stringify({
				providers: {
					anthropic: {
						modelOverrides: {
							"claude-opus-4-1": { size: "medium" },
							"claude-sonnet-4-5": { size: "small" },
						},
					},
					openai: {
						modelOverrides: {
							"gpt-5.1-codex": { size: "large" },
						},
					},
				},
			}),
		);
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createSession(skills: Skill[]) {
		const selectedModels: string[] = [];
		const initialModel = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model: initialModel,
				systemPrompt: "Test",
				tools: [],
			},
			streamFn: (model) => {
				selectedModels.push(`${model.provider}/${model.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage(model) });
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage(model) });
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("openai", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, join(tempDir, "models.json"));

		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: {
				getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
				getSkills: () => ({ skills, diagnostics: [] }),
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getThemes: () => ({ themes: [], diagnostics: [] }),
				getAgentsFiles: () => ({ agentsFiles: [] }),
				getSystemPrompt: () => undefined,
				getAppendSystemPrompt: () => [],
				getPathMetadata: () => new Map(),
				extendResources: () => {},
				reload: async () => {},
			},
		});

		return { session, selectedModels };
	}

	it("uses a model matching skill model_size for that turn and restores afterwards", async () => {
		const skillPath = join(tempDir, "skills", "size-skill", "SKILL.md");
		mkdirSync(join(tempDir, "skills", "size-skill"), { recursive: true });
		writeFileSync(
			skillPath,
			`---
name: size-skill
description: Skill that chooses a large model.
model_size: large
---
Use a large model.`,
		);

		const { session, selectedModels } = createSession([
			{
				name: "size-skill",
				description: "Skill that chooses a large model.",
				filePath: skillPath,
				baseDir: join(tempDir, "skills", "size-skill"),
				source: "test",
				disableModelInvocation: false,
				modelSize: "large",
			},
		]);

		await session.prompt("/skill:size-skill");
		await session.prompt("plain turn");

		expect(selectedModels[0]).toBe("openai/gpt-5.1-codex");
		expect(selectedModels[1]).toBe("anthropic/claude-sonnet-4-5");
	});

	it("prefers skill model over skill model_size", async () => {
		const skillPath = join(tempDir, "skills", "specific-model-skill", "SKILL.md");
		mkdirSync(join(tempDir, "skills", "specific-model-skill"), { recursive: true });
		writeFileSync(
			skillPath,
			`---
name: specific-model-skill
description: Skill with explicit model and model_size.
model: anthropic/claude-opus-4-1
model_size: large
---
Prefer explicit model.`,
		);

		const { session, selectedModels } = createSession([
			{
				name: "specific-model-skill",
				description: "Skill with explicit model and model_size.",
				filePath: skillPath,
				baseDir: join(tempDir, "skills", "specific-model-skill"),
				source: "test",
				disableModelInvocation: false,
				model: "anthropic/claude-opus-4-1",
				modelSize: "large",
			},
		]);

		await session.prompt("/skill:specific-model-skill");

		expect(selectedModels[0]).toBe("anthropic/claude-opus-4-1");
	});
});
