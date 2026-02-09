import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.js";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");

describe.skipIf(!existsSync(cliPath))("RPC model commands", () => {
	let client: RpcClient;
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-rpc-models-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });

		// Configure deterministic google-antigravity models without OAuth/network dependency.
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify(
				{
					providers: {
						"google-antigravity": {
							baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
							apiKey: "test-antigravity-key",
							api: "anthropic-messages",
							models: [
								{
									id: "claude-sonnet-4-5",
									name: "Claude Sonnet 4.5",
									reasoning: true,
									input: ["text", "image"],
									cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
									contextWindow: 200000,
									maxTokens: 8192,
								},
								{
									id: "gemini-3-flash",
									name: "Gemini 3 Flash",
									reasoning: true,
									input: ["text", "image"],
									cost: { input: 1.25, output: 5, cacheRead: 0.125, cacheWrite: 1.25 },
									contextWindow: 1000000,
									maxTokens: 65536,
								},
							],
						},
					},
				},
				null,
				2,
			),
		);

		client = new RpcClient({
			cliPath,
			cwd: projectDir,
			env: { [ENV_AGENT_DIR]: agentDir },
			provider: "google-antigravity",
			model: "claude-sonnet-4-5",
		});
	});

	afterEach(async () => {
		await client.stop();
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("returns configured antigravity models and switches with set_model", async () => {
		await client.start();

		const availableModels = await client.getAvailableModels();
		const antigravityIds = availableModels.filter((m) => m.provider === "google-antigravity").map((m) => m.id);

		expect(antigravityIds).toContain("claude-sonnet-4-5");
		expect(antigravityIds).toContain("gemini-3-flash");

		const updated = await client.setModel("google-antigravity", "gemini-3-flash");
		expect(updated.provider).toBe("google-antigravity");
		expect(updated.id).toBe("gemini-3-flash");

		const state = await client.getState();
		expect(state.model?.provider).toBe("google-antigravity");
		expect(state.model?.id).toBe("gemini-3-flash");
	}, 60000);

	test("rejects set_model for unavailable antigravity model IDs", async () => {
		await client.start();

		await expect(client.setModel("google-antigravity", "does-not-exist")).rejects.toThrow(
			"Model not found: google-antigravity/does-not-exist",
		);
	}, 60000);
});
