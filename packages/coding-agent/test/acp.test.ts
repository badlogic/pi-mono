import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import { AcpAgent } from "../src/modes/acp/acp-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * ACP mode tests.
 *
 * These tests verify basic ACP protocol functionality:
 * - Initialize handshake
 * - Session creation
 */
describe("ACP mode", () => {
	let process: ChildProcess;
	let rl: readline.Interface;
	let pendingResponses: Map<
		number | string,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void; expectError: boolean }
	>;
	let requestId = 0;
	let agentDir: string;
	let notifications: unknown[];

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
				hasAnthropic: Boolean(parsed.anthropic),
				raw,
			};
		} catch {
			return { hasCopilot: false, hasAnthropic: false };
		}
	}

	function findJsonlFiles(root: string): string[] {
		if (!existsSync(root)) return [];
		const entries = readdirSync(root, { withFileTypes: true });
		const results: string[] = [];
		for (const entry of entries) {
			const fullPath = join(root, entry.name);
			if (entry.isDirectory()) {
				results.push(...findJsonlFiles(fullPath));
			} else if (entry.isFile() && fullPath.endsWith(".jsonl")) {
				results.push(fullPath);
			} else if (entry.isSymbolicLink()) {
			} else if (!entry.isFile() && !entry.isDirectory()) {
				// Fallback for unusual dirents
				try {
					if (statSync(fullPath).isDirectory()) {
						results.push(...findJsonlFiles(fullPath));
					}
				} catch {
					// ignore
				}
			}
		}
		return results;
	}

	async function sendRequest(
		method: string,
		params: Record<string, unknown> = {},
		options: { expectError?: boolean } = {},
	): Promise<unknown> {
		const id = ++requestId;
		const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });

		return new Promise((resolve, reject) => {
			pendingResponses.set(id, { resolve, reject, expectError: options.expectError ?? false });
			process.stdin!.write(request + "\n");

			// Timeout after 10 seconds
			setTimeout(() => {
				if (pendingResponses.has(id)) {
					pendingResponses.delete(id);
					reject(new Error(`Request ${method} timed out`));
				}
			}, 10000);
		});
	}

	function sendNotification(method: string, params: Record<string, unknown> = {}): void {
		const notification = JSON.stringify({ jsonrpc: "2.0", method, params });
		process.stdin!.write(notification + "\n");
	}

	interface JsonRpcError {
		code: number;
		message?: string;
		data?: unknown;
	}

	beforeEach(() => {
		pendingResponses = new Map();
		notifications = [];

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
				// isolate config/state so tests don't depend on local machine setup
				PI_CODING_AGENT_DIR: agentDir,
				// Prefer Copilot as the only available provider for these tests
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

		rl = readline.createInterface({
			input: process.stdout!,
			crlfDelay: Infinity,
		});

		rl.on("line", (line) => {
			try {
				const msg = JSON.parse(line) as { id?: number | string; result?: unknown; error?: JsonRpcError };

				if (msg.id !== undefined && pendingResponses.has(msg.id)) {
					const handler = pendingResponses.get(msg.id)!;
					pendingResponses.delete(msg.id);
					if (msg.error) {
						if (handler.expectError) {
							handler.resolve(msg.error);
						} else {
							const err = new Error(msg.error.message || JSON.stringify(msg.error)) as Error & {
								code?: number;
								data?: unknown;
							};
							err.code = msg.error.code;
							err.data = msg.error.data;
							handler.reject(err);
						}
					} else {
						handler.resolve(msg.result ?? msg);
					}
					return;
				}

				// Capture JSON-RPC notifications like session/update
				if (msg.id === undefined) {
					notifications.push(msg);
				}
			} catch {
				// Ignore non-JSON lines
			}
		});
	});

	afterEach(async () => {
		rl.close();
		process.kill();
		await new Promise((resolve) => process.on("close", resolve));
		try {
			rmSync(agentDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test("should respond to initialize", async () => {
		const result = (await sendRequest("initialize", { protocolVersion: 1 })) as {
			protocolVersion: number;
			agentCapabilities?: { loadSession?: boolean };
		};

		expect(result).toBeDefined();
		expect(result.protocolVersion).toBe(1);
		expect(result.agentCapabilities).toBeDefined();
		expect(result.agentCapabilities!.loadSession).toBe(true);
	}, 15000);

	test("should return invalid params for bad initialize", async () => {
		const error = (await sendRequest("initialize", { protocolVersion: "oops" }, { expectError: true })) as {
			code: number;
		};

		expect(error.code).toBe(-32602);
	});

	test("should return method not found for unknown method", async () => {
		const error = (await sendRequest("unknown/method", {}, { expectError: true })) as { code: number };
		expect(error.code).toBe(-32601);
	});

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

	async function waitForAgentMessageChunk(sessionId: string, timeoutMs = 20000): Promise<string> {
		const deadline = Date.now() + timeoutMs;
		let searchFrom = 0;

		while (Date.now() < deadline) {
			for (let i = searchFrom; i < notifications.length; i++) {
				const msg = notifications[i] as {
					method?: string;
					params?: {
						sessionId?: string;
						update?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
					};
				};

				if (
					msg.method === "session/update" &&
					msg.params?.sessionId === sessionId &&
					msg.params.update?.sessionUpdate === "agent_message_chunk" &&
					msg.params.update.content?.type === "text" &&
					typeof msg.params.update.content.text === "string" &&
					msg.params.update.content.text.length > 0
				) {
					return msg.params.update.content.text;
				}
			}

			searchFrom = notifications.length;
			await new Promise((r) => setTimeout(r, 50));
		}

		throw new Error("Timed out waiting for agent_message_chunk");
	}

	test.skipIf(!hasCopilotToken && !hasAnthropicToken)(
		"should create new session",
		async () => {
			// First initialize
			await sendRequest("initialize", { protocolVersion: 1 });

			// Then create session
			const result = (await sendRequest("session/new", { cwd: join(__dirname, ".."), mcpServers: [] })) as {
				sessionId: string;
				modes?: { currentModeId: string };
			};

			expect(result).toBeDefined();
			expect(result.sessionId).toBeDefined();
			expect(typeof result.sessionId).toBe("string");
			expect(result.sessionId.length).toBeGreaterThan(0);
			expect(result.modes).toBeDefined();
			expect(result.modes!.currentModeId).toBe("default");
		},
		30000,
	);

	test.skipIf(!hasCopilotToken)(
		"should stream a completion via session/update (GitHub Copilot)",
		async () => {
			await sendRequest("initialize", { protocolVersion: 1 });
			const session = (await sendRequest("session/new", { cwd: join(__dirname, ".."), mcpServers: [] })) as {
				sessionId: string;
			};

			await sendRequest("session/prompt", {
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Reply with a single short sentence." }],
			});

			const chunk = await waitForAgentMessageChunk(session.sessionId, 30000);
			expect(chunk.length).toBeGreaterThan(0);

			// Give the agent a moment to finish the turn and (if enabled) write the session file.
			await new Promise((r) => setTimeout(r, 1500));

			// ACP sessions are in-memory only: no session files should be written.
			const sessionFiles = findJsonlFiles(join(agentDir, "sessions"));
			expect(sessionFiles).toHaveLength(0);
		},
		45000,
	);

	test.skipIf(!hasCopilotToken && !hasAnthropicToken)(
		"should handle cancel notifications during prompt",
		async () => {
			await sendRequest("initialize", { protocolVersion: 1 });
			const session = (await sendRequest("session/new", { cwd: join(__dirname, ".."), mcpServers: [] })) as {
				sessionId: string;
			};

			const promptResponse = (await sendRequest("session/prompt", {
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Write a short response." }],
			})) as { stopReason?: string };

			sendNotification("session/cancel", { sessionId: session.sessionId });

			expect(promptResponse.stopReason).toBeDefined();
		},
		45000,
	);
});

describe("AcpAgent ACP output completeness", () => {
	test("emits agent_message_chunk on message_end when no text deltas were streamed", async () => {
		const sessionId = "s1";
		const connection = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });

		// Start + end an assistant message without any streaming deltas.
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "message_start",
			message: { role: "assistant", content: "" },
		});
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "message_end",
			message: { role: "assistant", content: "Hello from non-streaming" },
		});

		expect(connection.sessionUpdate).toHaveBeenCalledTimes(1);
		const arg = (connection.sessionUpdate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as any;
		expect(arg).toMatchObject({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello from non-streaming" },
			},
		});
	});

	test("does not duplicate streamed content on message_end", async () => {
		const sessionId = "s2";
		const connection = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });

		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "message_start",
			message: { role: "assistant", content: "" },
		});
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "message_update",
			message: { role: "assistant", content: "" },
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "Hello",
				partial: { role: "assistant", content: "Hello" },
			},
		});
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "message_end",
			message: { role: "assistant", content: "Hello" },
		});

		expect(connection.sessionUpdate).toHaveBeenCalledTimes(1);
		const arg = (connection.sessionUpdate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as any;
		expect(arg.update).toMatchObject({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Hello" },
		});
	});
});

describe("ACP tool content + locations mapping (unit)", () => {
	test("maps read(image) result content blocks to ACP ToolCallContent[]", async () => {
		const updates: unknown[] = [];
		const connection = {
			sessionUpdate: vi.fn().mockImplementation(async (payload: unknown) => {
				updates.push(payload);
			}),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });
		const sessionId = "s-tool-1";

		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "read",
			args: { path: "image.png" },
		});
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "tool_execution_end",
			toolCallId: "t1",
			toolName: "read",
			result: {
				content: [
					{ type: "text", text: "Read image file [image/png]" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				],
				details: undefined,
			},
			isError: false,
		});

		expect(updates).toHaveLength(2);
		const msg = updates[1] as any;
		expect(msg).toMatchObject({
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				status: "completed",
				kind: "read",
				locations: [{ path: "image.png" }],
			},
		});

		expect(msg.update.content).toEqual([
			{ type: "content", content: { type: "text", text: "Read image file [image/png]" } },
			{ type: "content", content: { type: "image", data: "AAAA", mimeType: "image/png" } },
		]);
	});

	test("maps edit result to ACP diff content and uses args.path for locations", async () => {
		const updates: unknown[] = [];
		const connection = {
			sessionUpdate: vi.fn().mockImplementation(async (payload: unknown) => {
				updates.push(payload);
			}),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });
		const sessionId = "s-tool-2";

		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "tool_execution_start",
			toolCallId: "t2",
			toolName: "edit",
			args: { path: "file.txt", oldText: "before", newText: "after" },
		});
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "tool_execution_end",
			toolCallId: "t2",
			toolName: "edit",
			result: {
				content: [{ type: "text", text: "ok" }],
				details: { diff: "-1 before\n+1 after" },
			},
			isError: false,
		});

		expect(updates).toHaveLength(2);
		const msg = updates[1] as any;
		expect(msg.update.locations).toEqual([{ path: "file.txt" }]);

		const diff = (msg.update.content as any[]).find((c) => c.type === "diff");
		expect(diff).toMatchObject({
			type: "diff",
			path: "file.txt",
			oldText: "before",
			newText: "after",
		});
		expect(diff._meta?.unifiedDiff).toBe("-1 before\n+1 after");
	});

	test("preserves partial tool content blocks on tool_execution_update", async () => {
		const updates: unknown[] = [];
		const connection = {
			sessionUpdate: vi.fn().mockImplementation(async (payload: unknown) => {
				updates.push(payload);
			}),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });
		const sessionId = "s-tool-3";

		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, {
			type: "tool_execution_update",
			toolCallId: "t3",
			toolName: "bash",
			args: { command: "echo hi" },
			partialResult: { content: [{ type: "text", text: "partial" }] },
		});

		expect(updates).toHaveLength(1);
		const msg = updates[0] as any;
		expect(msg.update).toMatchObject({
			sessionUpdate: "tool_call_update",
			toolCallId: "t3",
			status: "in_progress",
		});
		expect(msg.update.content).toEqual([{ type: "content", content: { type: "text", text: "partial" } }]);
	});
});
