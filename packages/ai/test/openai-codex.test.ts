import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCodexInstructions } from "../src/providers/openai-codex/prompts/codex.js";
import { CODEX_PI_BRIDGE } from "../src/providers/openai-codex/prompts/pi-codex-bridge.js";
import {
	normalizeModel,
	type RequestBody,
	transformRequestBody,
} from "../src/providers/openai-codex/request-transformer.js";
import { parseCodexError } from "../src/providers/openai-codex/response-handler.js";

const DEFAULT_PROMPT_PREFIX =
	"You are an expert coding assistant. You help users with coding tasks by reading files, executing commands";
const FALLBACK_PROMPT = readFileSync(
	new URL("../src/providers/openai-codex/prompts/codex-instructions.md", import.meta.url),
	"utf8",
);

describe("openai-codex request transformer", () => {
	it("filters item_reference, strips ids, and inserts bridge message", async () => {
		const body: RequestBody = {
			model: "gpt-5.1-codex",
			input: [
				{
					type: "message",
					role: "developer",
					id: "sys-1",
					content: [{ type: "input_text", text: `${DEFAULT_PROMPT_PREFIX}...` }],
				},
				{
					type: "message",
					role: "user",
					id: "user-1",
					content: [{ type: "input_text", text: "hello" }],
				},
				{ type: "item_reference", id: "ref-1" },
				{ type: "function_call_output", call_id: "missing", name: "tool", output: "result" },
			],
			tools: [{ type: "function", name: "tool", description: "", parameters: {} }],
		};

		const transformed = await transformRequestBody(body, "CODEX_INSTRUCTIONS", {}, true);

		expect(transformed.store).toBe(false);
		expect(transformed.stream).toBe(true);
		expect(transformed.instructions).toBe("CODEX_INSTRUCTIONS");
		expect(transformed.include).toEqual(["reasoning.encrypted_content"]);

		const input = transformed.input || [];
		expect(input.some((item) => item.type === "item_reference")).toBe(false);
		expect(input.some((item) => "id" in item)).toBe(false);
		expect(input[0]?.type).toBe("message");
		expect(input[0]?.content).toEqual([{ type: "input_text", text: CODEX_PI_BRIDGE }]);

		const orphaned = input.find((item) => item.type === "message" && item.role === "assistant");
		expect(orphaned?.content).toMatch(/Previous tool result/);
	});
});

describe("openai-codex model normalization", () => {
	it("maps space-separated codex-mini names to codex-mini-latest", () => {
		expect(normalizeModel("gpt 5 codex mini")).toBe("codex-mini-latest");
	});
});

describe("openai-codex error parsing", () => {
	it("produces friendly usage-limit messages and rate limits", async () => {
		const resetAt = Math.floor(Date.now() / 1000) + 600;
		const response = new Response(
			JSON.stringify({
				error: { code: "usage_limit_reached", plan_type: "Plus", resets_at: resetAt },
			}),
			{
				status: 429,
				headers: {
					"x-codex-primary-used-percent": "99",
					"x-codex-primary-window-minutes": "60",
					"x-codex-primary-reset-at": String(resetAt),
				},
			},
		);

		const info = await parseCodexError(response);
		expect(info.friendlyMessage?.toLowerCase()).toContain("usage limit");
		expect(info.rateLimits?.primary?.used_percent).toBe(99);
	});
});

describe("openai-codex prompt caching", () => {
	const originalFetch = global.fetch;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
		if (originalAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		}
	});

	it("caches prompts with etag and reuses cache", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-codex-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;

		const tag = "rust-v0.0.0";
		const promptText = "PROMPT_CONTENT";
		const etag = '"etag-123"';

		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
				return new Response(JSON.stringify({ tag_name: tag }), { status: 200 });
			}
			if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
				const headerValue =
					init?.headers && typeof init.headers === "object" && "If-None-Match" in init.headers
						? String((init.headers as Record<string, string>)["If-None-Match"])
						: undefined;
				if (headerValue === etag) {
					return new Response("", { status: 304, headers: { etag } });
				}
				return new Response(promptText, { status: 200, headers: { etag } });
			}
			return new Response("not found", { status: 404 });
		});

		global.fetch = fetchMock as typeof fetch;

		const first = await getCodexInstructions("gpt-5.1-codex");
		expect(first).toBe(promptText);

		const metaPath = join(tempDir, "cache", "openai-codex", "codex-instructions-meta.json");
		const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { etag: string; tag: string; lastChecked: number };
		writeFileSync(metaPath, JSON.stringify({ ...meta, lastChecked: 0 }), "utf8");

		const second = await getCodexInstructions("gpt-5.1-codex");
		expect(second).toBe(promptText);
		expect(fetchMock).toHaveBeenCalled();
		const rawCalls = fetchMock.mock.calls.filter((call) =>
			String(call[0]).startsWith("https://raw.githubusercontent.com/openai/codex/"),
		);
		expect(rawCalls.length).toBeGreaterThan(0);
	});

	it("falls back to bundled instructions when cache and network are unavailable", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-codex-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;

		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});

		global.fetch = fetchMock as typeof fetch;

		const instructions = await getCodexInstructions("gpt-5.1-codex");
		expect(instructions).toBe(FALLBACK_PROMPT);
	});
});
