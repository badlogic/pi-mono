import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
/// <reference lib="dom" />
import { fileURLToPath } from "node:url";
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

class TestClient implements Client {
	readonly updates: SessionNotification[] = [];

	async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		const optionId = params.options[0]?.optionId ?? "allow";
		return {
			outcome: {
				outcome: "selected",
				optionId,
			},
		};
	}

	async sessionUpdate(params: SessionNotification): Promise<void> {
		this.updates.push(params);
	}
}

function loadOAuthCredentialsFromDisk(): { hasCopilot: boolean; hasAnthropic: boolean; raw?: string } {
	const oauthPath = join(homedir(), CONFIG_DIR_NAME, "agent", "oauth.json");
	if (!existsSync(oauthPath)) {
		return { hasCopilot: false, hasAnthropic: false };
	}

	try {
		const raw = readFileSync(oauthPath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			hasCopilot: Boolean(parsed["github-copilot"]),
			hasAnthropic: Boolean(parsed["anthropic"]),
			raw,
		};
	} catch {
		return { hasCopilot: false, hasAnthropic: false };
	}
}

describe("ACP mode (SDK client)", () => {
	let process: ChildProcess;
	let connection: ClientSideConnection;
	let testClient: TestClient;
	let agentDir: string;

	beforeEach(() => {
		agentDir = join(tmpdir(), `pi-acp-test-${crypto.randomUUID()}`);
		const oauth = loadOAuthCredentialsFromDisk();
		if (oauth.raw) {
			mkdirSync(agentDir, { recursive: true, mode: 0o700 });
			writeFileSync(join(agentDir, "oauth.json"), oauth.raw, "utf-8");
		}

		const cliPath = join(__dirname, "..", "dist", "cli.js");
		process = spawn("node", [cliPath, "--mode", "acp", "--no-session"], {
			cwd: join(__dirname, ".."),
			env: {
				...global.process.env,
				PI_CODING_AGENT_DIR: agentDir,
				ANTHROPIC_API_KEY: "",
				ANTHROPIC_OAUTH_TOKEN: "",
				OPENAI_API_KEY: "",
				GEMINI_API_KEY: "",
				GROQ_API_KEY: "",
				CEREBRAS_API_KEY: "",
				XAI_API_KEY: "",
				OPENROUTER_API_KEY: "",
				ZAI_API_KEY: "",
			},
			stdio: ["pipe", "pipe", "inherit"],
		});

		const input = new WritableStream<Uint8Array>({
			write(chunk) {
				return new Promise<void>((resolve, reject) => {
					process.stdin!.write(chunk, (err) => {
						if (err) reject(err);
						else resolve();
					});
				});
			},
		});

		const output = new ReadableStream<Uint8Array>({
			start(controller) {
				process.stdout!.on("data", (chunk: Buffer) => {
					controller.enqueue(new Uint8Array(chunk));
				});
				process.stdout!.on("end", () => controller.close());
				process.stdout!.on("error", (err) => controller.error(err));
			},
		});

		const stream = ndJsonStream(input, output);
		testClient = new TestClient();
		connection = new ClientSideConnection(() => testClient, stream);
	});

	afterEach(async () => {
		process.kill();
		await new Promise((resolve) => process.on("close", resolve));
		try {
			rmSync(agentDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test("should initialize via SDK client connection", async () => {
		const result = await connection.initialize({ protocolVersion: 1 });
		expect(result.protocolVersion).toBe(1);
	}, 15000);

	const oauthInfo = loadOAuthCredentialsFromDisk();
	const hasCopilotToken = !!(
		oauthInfo.hasCopilot ||
		global.process.env.COPILOT_GITHUB_TOKEN ||
		global.process.env.GH_TOKEN ||
		global.process.env.GITHUB_TOKEN
	);
	const hasAnthropicToken = !!(
		oauthInfo.hasAnthropic ||
		global.process.env.ANTHROPIC_API_KEY ||
		global.process.env.ANTHROPIC_OAUTH_TOKEN
	);

	test.skipIf(!hasCopilotToken && !hasAnthropicToken)(
		"should create a session via SDK client connection",
		async () => {
			await connection.initialize({ protocolVersion: 1 });
			const result = await connection.newSession({
				cwd: join(__dirname, ".."),
				mcpServers: [],
			});
			expect(result.sessionId.length).toBeGreaterThan(0);
		},
		30000,
	);

	test.skipIf(!hasCopilotToken && !hasAnthropicToken)(
		"should receive agent_message_chunk updates for a prompt",
		async () => {
			await connection.initialize({ protocolVersion: 1 });
			const session = await connection.newSession({
				cwd: join(__dirname, ".."),
				mcpServers: [],
			});

			// Send a simple prompt that should elicit a text response
			const promptResult = await connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Say hello in exactly one word." }],
			});

			// Prompt should complete with end_turn stop reason
			expect(promptResult.stopReason).toBe("end_turn");

			// Wait for agent_message_chunk updates to arrive (prompt returns before events are emitted)
			const startTime = Date.now();
			const timeout = 30000;
			while (Date.now() - startTime < timeout) {
				const agentMessageChunks = testClient.updates.filter(
					(update) => update.update.sessionUpdate === "agent_message_chunk",
				);
				if (agentMessageChunks.length > 0) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Check that we received at least one agent_message_chunk update
			const agentMessageChunks = testClient.updates.filter(
				(update) => update.update.sessionUpdate === "agent_message_chunk",
			);
			expect(agentMessageChunks.length).toBeGreaterThan(0);

			// Verify the session ID matches
			for (const chunk of agentMessageChunks) {
				expect(chunk.sessionId).toBe(session.sessionId);
			}

			// Verify chunk content has text type
			for (const chunk of agentMessageChunks) {
				if (chunk.update.sessionUpdate === "agent_message_chunk") {
					expect(chunk.update.content.type).toBe("text");
				}
			}
		},
		60000,
	);
});
