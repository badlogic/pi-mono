import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { createAgentSession } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("createAgentSession getApiKey", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("uses the provider argument after model switches", async () => {
		const authStorage = new AuthStorage(join(agentDir, "auth.json"));
		authStorage.set("anthropic", { type: "api_key", key: "anthropic-key" });
		authStorage.set("openai-codex", { type: "api_key", key: "codex-key" });

		const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
		const settingsManager = SettingsManager.create(projectDir, agentDir);
		const sessionManager = SessionManager.inMemory(projectDir);

		const anthropicModel = getModel("anthropic", "claude-opus-4-5");
		const codexModel = getModel("openai-codex", "gpt-5.2-codex");

		const { session } = await createAgentSession({
			cwd: projectDir,
			agentDir,
			authStorage,
			modelRegistry,
			settingsManager,
			sessionManager,
			model: anthropicModel,
		});

		await session.setModel(codexModel);

		const key = await session.agent.getApiKey?.("anthropic");
		expect(key).toBe("anthropic-key");
	});
});
